// The editor's library session (R1 C2, H2): open documents, their histories and the library mirror. React reads it
// through useSyncExternalStore; large models never live in component state. Disk is the authority, so every
// library operation re-reads the server's snapshot afterwards.
import { duplicateMap, mapName, modelDigest, modelText, newMapDocument, openFromFile, renameMap, stageMap, type NewMapOptions } from '../editor/document';
import { beginSave, completeSave, isDirty, noteDigest, openDocument, redo, restoreDraft, revert, undo, type DocumentState } from '../editor/history';
import { normalize, type MapModel } from '../domain/model';
import { fetchLibrary, onLibraryEvents, readDocuments, recoverDocument, saveDocuments } from '../library/client';
import { draftKey, libraryKey, openIndexedDbDrafts, type Draft, type DraftStore } from '../library/drafts';
import { documentPath } from '../library/layout';
import type { Conflict, LibrarySnapshot, Refusal, SaveDocument } from '../library/protocol';

export interface OpenDoc {
  readonly id: string;
  readonly path: string;
  readonly state: DocumentState;
  /** The content last opened or saved, for Revert; null for a document not yet in the library. */
  readonly savedModel: MapModel | null;
  /** Why the document cannot be edited or saved, or null. */
  readonly readOnly: string | null;
  /** A journaled draft offered on open, until restored or discarded. */
  readonly draft: Draft | null;
  /** The draft journal holds this document's current unsaved content. */
  readonly drafted: boolean;
  readonly conflicts: readonly Conflict[];
  readonly changedOnDisk: boolean;
  readonly confirmRevert: boolean;
}
export interface AppView {
  readonly phase: 'loading' | 'offline' | 'ready' | 'failed';
  readonly library: LibrarySnapshot | null;
  readonly docs: readonly OpenDoc[];
  readonly activeId: string | null;
  readonly status: string;
  readonly problems: readonly string[];
  readonly busy: boolean;
  readonly drafts: 'unknown' | 'available' | 'unavailable';
  /** Drafts of documents that are not in the library (new maps never saved). */
  readonly orphanDrafts: readonly Draft[];
}

const initial: AppView = { phase: 'loading', library: null, docs: [], activeId: null, status: 'Connecting to the library…', problems: [], busy: false, drafts: 'unknown', orphanDrafts: [] };
const DRAFT_DELAY_MS = 250;

const describe = (r: Refusal): string[] => [
  ...(r.conflicts ?? []).map((c) => `${c.path}: changed on disk since it was opened`),
  ...(r.diagnostics ?? []).filter((d) => d.severity === 'error').slice(0, 8).map((d) => `${d.documentId ?? 'library'} ${d.jsonPath}: ${d.message}`),
];

export class LibraryStore {
  private view: AppView = initial;
  private readonly listeners = new Set<() => void>();
  private drafts: DraftStore | null = null;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Draft journal writes run one at a time per document, in order, so a late write never resurrects a saved draft. */
  private readonly journals = new Map<string, Promise<void>>();
  private stop: (() => void) | null = null;

  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  readonly getSnapshot = (): AppView => this.view;

  private set(patch: Partial<AppView>): void { this.view = { ...this.view, ...patch }; for (const l of this.listeners) l(); }
  private doc(id: string): OpenDoc | undefined { return this.view.docs.find((d) => d.id === id); }
  private patchDoc(id: string, patch: Partial<OpenDoc>): void { this.set({ docs: this.view.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)) }); }
  private get libraryId(): string | null { const l = this.view.library; return l ? libraryKey(l.label, l.projectId) : null; }
  active(): OpenDoc | undefined { return this.view.activeId ? this.doc(this.view.activeId) : undefined; }

  async start(): Promise<void> {
    this.stop ??= onLibraryEvents({ saved: () => void this.refresh(), changed: () => void this.refresh() });
    this.drafts = await openIndexedDbDrafts();
    this.set({ drafts: this.drafts ? 'available' : 'unavailable' });
    await this.load();
  }
  dispose(): void { this.stop?.(); this.stop = null; for (const t of this.timers.values()) clearTimeout(t); }

  async load(): Promise<void> {
    const library = await fetchLibrary();
    if (!library.ok) {
      this.set({ phase: library.code === 'client.offline' ? 'offline' : 'failed', status: library.message });
      return;
    }
    this.set({ phase: 'ready', library, status: this.view.phase === 'ready' ? this.view.status : `Library: ${library.label}${library.readOnly ? ' (read-only)' : ''}` });
    await this.listOrphanDrafts();
  }

  /** Re-reads the library after a save or an outside edit. A clean open document whose file changed reloads; a dirty one is flagged. */
  async refresh(): Promise<void> {
    await this.load();
    const entries = new Map(this.view.library?.documents.map((e) => [e.id, e]));
    for (const d of this.view.docs) {
      const e = entries.get(d.id);
      if (!e || d.state.baseDigest === null || e.digest === d.state.baseDigest) continue;
      if (isDirty(d.state)) this.patchDoc(d.id, { changedOnDisk: true });
      else if (e.digest !== null) await this.reload(d.id, `${d.path} changed on disk and was reloaded`);
    }
  }

  private async listOrphanDrafts(): Promise<void> {
    const lib = this.libraryId;
    if (!this.drafts || !lib) return;
    const indexed = new Set(this.view.library?.documents.map((e) => e.id));
    const open = new Set(this.view.docs.map((d) => d.id));
    this.set({ orphanDrafts: (await this.drafts.list(lib)).filter((d) => !indexed.has(d.documentId) && !open.has(d.documentId)) });
  }

  activate(id: string): void { if (this.doc(id)) this.set({ activeId: id }); }

  async open(id: string): Promise<void> {
    if (this.doc(id)) return this.activate(id);
    const entry = this.view.library?.documents.find((e) => e.id === id);
    if (!entry || entry.kind !== 'map') return;
    if (entry.state !== 'ok') { this.set({ status: `${entry.path} is torn: keep the file or restore it from a backup first`, problems: [] }); return; }
    const read = await readDocuments([id]);
    if (!read.ok) { this.set({ status: read.message, problems: describe(read) }); return; }
    const file = read.documents[0];
    if (!file) return;
    const staged = stageMap(file.text);
    if (!staged.ok) { this.set({ status: `${file.path} cannot be opened`, problems: staged.problems.map((p) => `${p.path}: ${p.message}`) }); return; }
    const state = await openFromFile(staged.model, file.digest);
    const library = this.view.library as LibrarySnapshot;
    const readOnly = library.readOnly ? `${library.label} is read-only` : entry.errors ? `${entry.errors} validation error(s): opened read-only and never rewritten` : null;
    const draft = this.drafts && this.libraryId ? await this.drafts.get(draftKey(this.libraryId, id)) : null;
    const offered = draft && draft.text !== modelText(staged.model) ? draft : null;
    const doc: OpenDoc = { id, path: file.path, state, savedModel: staged.model, readOnly, draft: offered, drafted: false, conflicts: [], changedOnDisk: false, confirmRevert: false };
    this.set({ docs: [...this.view.docs, doc], activeId: id, status: `Opened ${file.path}`, problems: [] });
  }

  close(id: string): void {
    const docs = this.view.docs.filter((d) => d.id !== id);
    this.set({ docs, activeId: this.view.activeId === id ? (docs.at(-1)?.id ?? null) : this.view.activeId });
  }

  private async reload(id: string, status: string): Promise<void> {
    const d = this.doc(id);
    if (!d) return;
    const read = await readDocuments([id]);
    const file = read.ok ? read.documents[0] : undefined;
    const staged = file ? stageMap(file.text) : null;
    if (!file || !staged?.ok) { this.set({ status: `${d.path} could not be reloaded` }); return; }
    const state = await openFromFile(staged.model, file.digest);
    this.patchDoc(id, { state, savedModel: staged.model, conflicts: [], changedOnDisk: false, confirmRevert: false, draft: null });
    await this.journal(id);
    this.set({ status });
  }

  /** Discards unsaved edits and reopens the file as it is on disk now. */
  async reloadFromDisk(id: string): Promise<void> { await this.reload(id, 'Reloaded from disk; unsaved edits were discarded'); }

  private edited(id: string, state: DocumentState): void {
    this.patchDoc(id, { state, confirmRevert: false });
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.set(id, setTimeout(() => { this.timers.delete(id); void this.journal(id); }, DRAFT_DELAY_MS));
  }

  /** Decides dirty state by digest, then journals the draft while dirty and drops it once clean. */
  private journal(id: string): Promise<void> {
    const t = this.timers.get(id);
    if (t) { clearTimeout(t); this.timers.delete(id); }
    const next = (this.journals.get(id) ?? Promise.resolve()).then(() => this.journalNow(id));
    this.journals.set(id, next.catch(() => undefined));
    return next;
  }

  private async journalNow(id: string): Promise<void> {
    const d = this.doc(id);
    if (!d) return;
    const digest = await modelDigest(d.state.model);
    const now = this.doc(id);
    if (!now) return;
    const state = noteDigest(now.state, d.state.contentId, digest);
    if (state !== now.state) this.patchDoc(id, { state });
    const lib = this.libraryId;
    if (!this.drafts || !lib || now.readOnly) return;
    const key = draftKey(lib, id);
    if (isDirty(state)) {
      await this.drafts.put({ key, libraryId: lib, documentId: id, path: now.path, baseDigest: state.baseDigest, text: modelText(state.model), updatedAt: new Date().toISOString() });
      this.patchDoc(id, { drafted: true });
    } else {
      await this.drafts.delete(key);
      this.patchDoc(id, { drafted: false });
    }
  }

  rename(name: string): void {
    const d = this.active();
    if (!d || d.readOnly || !name.trim()) return;
    const r = renameMap(d.state, name.trim());
    if (r.outcome === 'recorded') this.edited(d.id, r.state);
  }
  undo(): void { const d = this.active(); if (d && !d.readOnly && d.state.past.length) this.edited(d.id, undo(d.state)); }
  redo(): void { const d = this.active(); if (d && !d.readOnly && d.state.future.length) this.edited(d.id, redo(d.state)); }

  /** Saves every dirty open document in one request (R1 C2 Save). Content whose digest equals the saved digest is not sent. */
  async save(only?: readonly string[]): Promise<void> {
    if (this.view.busy) return;
    const library = this.view.library;
    if (!library) return;
    const candidates = this.view.docs.filter((d) => !d.readOnly && (!only || only.includes(d.id)));
    const tickets = new Map<string, { ticket: ReturnType<typeof beginSave>; digest: string; text: string }>();
    for (const d of candidates) {
      if (!isDirty(d.state)) continue;
      const ticket = beginSave(d.state);
      const text = modelText(ticket.model);
      const digest = await modelDigest(ticket.model);
      const now = this.doc(d.id) as OpenDoc;
      const state = noteDigest(now.state, ticket.contentId, digest);
      if (state !== now.state) this.patchDoc(d.id, { state });
      if (isDirty(state)) tickets.set(d.id, { ticket, digest, text });
    }
    if (library.readOnly && candidates.length === 0 && this.view.docs.some((d) => isDirty(d.state))) {
      this.set({ status: `${library.label} is read-only: nothing can be saved here`, problems: [] });
      return;
    }
    if (!tickets.size) { this.set({ status: 'Nothing to save', problems: [] }); return; }
    this.set({ busy: true, status: 'Saving…', problems: [] });
    const documents: SaveDocument[] = [...tickets].map(([id, t]) => ({ id, kind: 'map', text: t.text, baseDigest: t.ticket.baseDigest }));
    const result = await saveDocuments({ documents });
    if (!result.ok) {
      for (const c of result.conflicts ?? []) this.patchDoc(c.id, { conflicts: [c] });
      this.set({ busy: false, status: result.code === 'save.stale-base' ? 'Save refused: a file changed on disk since it was opened. Nothing was written.' : `Save refused: ${result.message}`, problems: describe(result) });
      await this.load();
      return;
    }
    for (const w of result.written) {
      const t = tickets.get(w.id), d = this.doc(w.id);
      if (!t || !d) continue;
      if (w.digest !== t.digest) { this.set({ status: `The server wrote different bytes for ${w.path}` }); continue; }
      const done = completeSave(d.state, t.ticket, w.digest);
      if (done.ok) this.patchDoc(w.id, { state: done.state, savedModel: t.ticket.model, path: w.path, conflicts: [], changedOnDisk: false });
      await this.journal(w.id);
    }
    this.set({ busy: false, status: `Saved ${result.written.map((w) => w.path).join(', ')} to ${result.label}; backup in ${result.backup}` });
    await this.load();
  }

  private taken(id: string): boolean {
    return (this.view.library?.documents.some((e) => e.id === id) ?? false) || this.view.docs.some((d) => d.id === id);
  }

  private addNew(model: MapModel, path: string, status: string): void {
    const doc: OpenDoc = { id: model.id, path, state: openDocument(model), savedModel: null, readOnly: null, draft: null, drafted: false, conflicts: [], changedOnDisk: false, confirmRevert: false };
    this.set({ docs: [...this.view.docs, doc], activeId: model.id, status, problems: [] });
    void this.journal(model.id);
  }

  /** Save As / Duplicate (R1 C2): a new map identity, written at once. */
  async saveAs(id: string, name: string): Promise<void> {
    const d = this.active();
    if (!d || !this.view.library || this.view.library.readOnly) { this.set({ status: 'Save As needs a writable library' }); return; }
    const dup = duplicateMap(d.state.model, id.trim(), name.trim() || `${mapName(d.state.model)} copy`, (x) => this.taken(x));
    if (!dup.ok) { this.set({ status: dup.message, problems: [] }); return; }
    this.addNew(dup.model, dup.path, `Created ${dup.path}`);
    await this.save([dup.model.id]);
  }

  /** New map (R1 C2): an unsaved document; Save writes it. */
  newMap(options: Omit<NewMapOptions, 'movement' | 'tiles'> & { readonly movementId: string; readonly tileSize: number | null }): void {
    const library = this.view.library;
    if (!library) return;
    const path = documentPath('map', options.id);
    if (path === null || this.taken(options.id)) { this.set({ status: `${options.id} is not a free map ID that can be a file name` }); return; }
    const movement = library.documents.find((e) => e.id === options.movementId && e.kind === 'movement');
    if (!movement) { this.set({ status: 'Choose a movement profile from this library' }); return; }
    const tileset = library.documents.find((e) => e.kind === 'tileset');
    const doc = newMapDocument({ id: options.id, name: options.name, width: options.width, height: options.height, movement: { id: movement.id, path: movement.path },
      ...(tileset && options.tileSize ? { tiles: { tilesetId: tileset.id, path: tileset.path, size: options.tileSize } } : {}) });
    const n = normalize(doc);
    if (!n.ok) { this.set({ status: 'The new map could not be created', problems: n.problems.map((p) => p.message) }); return; }
    this.addNew(n.model, path, `New map ${options.id}: Save writes ${path}`);
  }

  askRevert(): void { const d = this.active(); if (d && d.savedModel && isDirty(d.state)) this.patchDoc(d.id, { confirmRevert: true }); }
  cancelRevert(): void { const d = this.active(); if (d) this.patchDoc(d.id, { confirmRevert: false }); }
  confirmRevert(): void {
    const d = this.active();
    if (!d?.savedModel || !d.confirmRevert) return;
    this.edited(d.id, revert(d.state, d.savedModel));
    this.set({ status: `Reverted ${d.path} to its saved content` });
  }

  async restoreDraft(): Promise<void> {
    const d = this.active();
    if (!d?.draft) return;
    const staged = stageMap(d.draft.text);
    if (!staged.ok || staged.model.id !== d.id) { this.patchDoc(d.id, { draft: null }); this.set({ status: 'The draft could not be read and was not restored' }); return; }
    const stale = d.draft.baseDigest !== d.state.baseDigest;
    this.edited(d.id, restoreDraft(d.state, staged.model, d.draft.baseDigest));
    this.patchDoc(d.id, { draft: null });
    this.set({ status: stale ? 'Draft restored; the file changed on disk since, so Save will refuse until you reload or Save As' : 'Draft restored; it is not saved yet' });
  }
  async discardDraft(): Promise<void> {
    const d = this.active(), lib = this.libraryId;
    if (!d?.draft || !lib) return;
    await this.drafts?.delete(draftKey(lib, d.id));
    this.patchDoc(d.id, { draft: null });
    this.set({ status: 'Draft discarded' });
  }
  /** Reopens an orphan draft (a new map never saved) as an unsaved document. */
  async restoreOrphan(documentId: string): Promise<void> {
    const draft = this.view.orphanDrafts.find((d) => d.documentId === documentId);
    const staged = draft ? stageMap(draft.text) : null;
    if (!draft || !staged?.ok) return;
    this.addNew(staged.model, draft.path, `Restored the unsaved draft of ${draft.path}`);
    this.set({ orphanDrafts: this.view.orphanDrafts.filter((d) => d !== draft) });
  }
  async discardOrphan(documentId: string): Promise<void> {
    const draft = this.view.orphanDrafts.find((d) => d.documentId === documentId);
    if (!draft) return;
    await this.drafts?.delete(draft.key);
    this.set({ orphanDrafts: this.view.orphanDrafts.filter((d) => d !== draft) });
  }

  /** Torn-save recovery (R1 H4): the user chooses keep or restore; MapLab never guesses. */
  async recover(id: string, action: 'keep' | 'restore'): Promise<void> {
    const entry = this.view.library?.documents.find((e) => e.id === id);
    if (!entry) return;
    const r = await recoverDocument({ id, action, digest: entry.digest });
    this.set({ status: r.ok ? `${entry.path}: ${action === 'keep' ? 'kept the file and updated the index' : 'restored from the newest matching backup'}` : `Recovery refused: ${r.message}`, problems: r.ok ? [] : describe(r) });
    await this.load();
  }
}
