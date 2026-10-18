// Per-document history and save state (adopted H2, R1 H2/H3). Pure and immutable: every function returns
// a new state and never writes its input. History stores one transaction per entry, never a model
// snapshot; undo applies the exact inverse. Selection, view and caches are never entries.
import { applyTransaction, invertTransaction, pruneTransaction, sealTransaction, transactionBytes, type Transaction, type TransactionProblem } from '../domain/transaction';
import type { MapModel } from '../domain/model';

/** R1 H3 default history budget per open document. */
export const DEFAULT_HISTORY_BUDGET = 64 * 1024 * 1024;
/** Most recent drop notices kept; `dropped` counts every dropped entry. */
export const NOTICE_LIMIT = 64;

export interface HistoryEntry {
  readonly label: string;
  readonly tx: Transaction;
  readonly bytes: number;
  /** Content identities before and after the forward transaction. */
  readonly before: number;
  readonly after: number;
}
/** A visible record that undo depth was given up to stay within budget. Authored content is never dropped. */
export interface HistoryNotice { readonly code: 'history.dropped'; readonly revision: number; readonly entries: number; readonly bytes: number }
export interface DocumentState {
  readonly documentId: string;
  /** Identifies this open: content identities and save tickets mean nothing outside the open that issued them. */
  readonly session: symbol;
  readonly model: MapModel;
  /** Increments on every recorded edit, undo, redo and revert. Never reused within a session. */
  readonly revision: number;
  /** Identity of the current content: undo and redo restore the identities they return to. */
  readonly contentId: number;
  readonly nextContentId: number;
  /** Undo stack, oldest first. */
  readonly past: readonly HistoryEntry[];
  /** Redo stack, next first. */
  readonly future: readonly HistoryEntry[];
  /** Accounted bytes of `past` and `future`; never above `budget` after an operation returns. */
  readonly bytes: number;
  readonly budget: number;
  readonly dropped: number;
  readonly notices: readonly HistoryNotice[];
  /**
   * The content last opened from or written to disk, with the digest of its library form (`savedDigest`,
   * R1 H2), or null for a document never saved.
   */
  readonly saved: Readonly<{ contentId: number; digest: string }> | null;
  /** SHA-256 of the file bytes on disk that the next save must replace (`baseDigest`, R1 H2), or null before the first save. */
  readonly baseDigest: string | null;
  /** The most recent digest computed for a content identity (`noteDigest`); dirty compares it with `saved` (R1 H3). */
  readonly checked: Readonly<{ contentId: number; digest: string }> | null;
}

export type CommitResult =
  | { readonly outcome: 'recorded'; readonly state: DocumentState }
  | { readonly outcome: 'noop'; readonly state: DocumentState }
  | { readonly outcome: 'refused'; readonly state: DocumentState; readonly problem: TransactionProblem };

/**
 * `savedDigest` is the digest of the opened content's library form; `baseDigest` is that of the file bytes it
 * came from, which differ when the file is not yet in library form (it defaults to `savedDigest`).
 */
export interface OpenOptions { readonly savedDigest?: string | null; readonly baseDigest?: string | null; readonly budget?: number }

/** A document opened from disk (`savedDigest`) starts clean; a new one stays dirty until its first save. */
export function openDocument(model: MapModel, options: OpenOptions = {}): DocumentState {
  const budget = options.budget ?? DEFAULT_HISTORY_BUDGET;
  if (!Number.isSafeInteger(budget) || budget < 0) throw new RangeError('History budget must be a non-negative safe integer');
  const digest = options.savedDigest ?? null;
  const base = options.baseDigest === undefined ? digest : options.baseDigest;
  if (digest === null && base !== null) throw new RangeError('A document with a file on disk needs its saved digest');
  return { documentId: model.id, session: Symbol(model.id), model, revision: 0, contentId: 1, nextContentId: 2, past: [], future: [], bytes: 0, budget, dropped: 0,
    notices: [], saved: digest === null ? null : { contentId: 1, digest }, baseDigest: base, checked: digest === null ? null : { contentId: 1, digest } };
}

/**
 * R1 H3: dirty means digest(model) ≠ savedDigest. Equal content identity proves equal content, so undo or redo back
 * to the saved state is clean at once. Any other content is dirty until `noteDigest` records its digest; a different
 * edit that recreates the saved content is clean from then on.
 */
export function isDirty(s: DocumentState): boolean {
  if (!s.saved) return true;
  if (s.saved.contentId === s.contentId) return false;
  return !(s.checked?.contentId === s.contentId && s.checked.digest === s.saved.digest);
}
/** Whether the current content's digest is known, so `isDirty` is final rather than pending. */
export const digestKnown = (s: DocumentState): boolean => s.saved?.contentId === s.contentId || s.checked?.contentId === s.contentId;

/** Records the digest of the content identity `contentId`; ignored once the document has moved on to other content. */
export function noteDigest(s: DocumentState, contentId: number, digest: string): DocumentState {
  if (contentId !== s.contentId || (s.checked?.contentId === contentId && s.checked.digest === digest)) return s;
  return { ...s, checked: { contentId, digest } };
}
export const canUndo = (s: DocumentState): boolean => s.past.length > 0;
export const canRedo = (s: DocumentState): boolean => s.future.length > 0;

/** Drops the oldest undo entries, then the furthest redo entries, until the history fits its budget. */
function enforceBudget(s: DocumentState): DocumentState {
  if (s.bytes <= s.budget) return s;
  const past = [...s.past], future = [...s.future];
  let bytes = s.bytes, entries = 0, freed = 0;
  while (bytes > s.budget && (past.length || future.length)) {
    const gone = (past.length ? past.shift() : future.pop()) as HistoryEntry;
    bytes -= gone.bytes; freed += gone.bytes; entries++;
  }
  const notice: HistoryNotice = { code: 'history.dropped', revision: s.revision, entries, bytes: freed };
  return { ...s, past, future, bytes, dropped: s.dropped + entries, notices: [...s.notices, notice].slice(-NOTICE_LIMIT) };
}

/**
 * Records one transaction as one entry and clears redo. A transaction whose operations each change
 * nothing records nothing. The entry keeps a sealed private copy, so later caller edits cannot alter it.
 */
export function commit(s: DocumentState, tx: Transaction): CommitResult {
  const pruned = pruneTransaction(tx);
  if (pruned.ops.length === 0) return { outcome: 'noop', state: s };
  const sealed = sealTransaction(pruned);
  const applied = applyTransaction(s.model, sealed);
  if (!applied.ok) return { outcome: 'refused', state: s, problem: applied.problem };
  const entry: HistoryEntry = Object.freeze({ label: sealed.label, tx: sealed, bytes: transactionBytes(sealed), before: s.contentId, after: s.nextContentId });
  const cleared = s.future.reduce((n, e) => n + e.bytes, 0);
  return { outcome: 'recorded', state: enforceBudget({ ...s, model: applied.model, revision: s.revision + 1, contentId: entry.after,
    nextContentId: s.nextContentId + 1, past: [...s.past, entry], future: [], bytes: s.bytes - cleared + entry.bytes }) };
}

const replay = (s: DocumentState, tx: Transaction): MapModel => {
  const applied = applyTransaction(s.model, tx);
  // Entries are exact inverses of states this history produced; a refusal means the state was forged.
  if (!applied.ok) throw new Error(`History replay refused: ${applied.problem.code} (${applied.problem.message})`);
  return applied.model;
};

export function undo(s: DocumentState): DocumentState {
  const entry = s.past.at(-1);
  if (!entry) return s;
  return { ...s, model: replay(s, invertTransaction(entry.tx)), revision: s.revision + 1, contentId: entry.before, past: s.past.slice(0, -1), future: [entry, ...s.future] };
}

export function redo(s: DocumentState): DocumentState {
  const entry = s.future[0];
  if (!entry) return s;
  return { ...s, model: replay(s, entry.tx), revision: s.revision + 1, contentId: entry.after, past: [...s.past, entry], future: s.future.slice(1) };
}

/** What a writer serializes and the base it must replace. The model is immutable, so no copy is taken. */
export interface SaveTicket { readonly documentId: string; readonly session: symbol; readonly revision: number; readonly contentId: number; readonly model: MapModel; readonly baseDigest: string | null }
export const beginSave = (s: DocumentState): SaveTicket =>
  Object.freeze({ documentId: s.documentId, session: s.session, revision: s.revision, contentId: s.contentId, model: s.model, baseDigest: s.baseDigest });

export type SaveResult = { readonly ok: true; readonly state: DocumentState }
  | { readonly ok: false; readonly state: DocumentState; readonly code: 'save.document' | 'save.session' | 'save.stale-base'; readonly message: string };

/**
 * Records that `ticket`'s content was written as library-form bytes with `digest`, which is then both the saved
 * digest and the new base. Refused, changing nothing, when the ticket belongs to another document or another open
 * of this one, or its base is no longer the document's base (another save completed after it was issued). Edits
 * made while saving keep the document dirty unless their digest equals the written one.
 */
export function completeSave(s: DocumentState, ticket: SaveTicket, digest: string): SaveResult {
  if (ticket.documentId !== s.documentId) return { ok: false, state: s, code: 'save.document', message: `Ticket for ${ticket.documentId} cannot save ${s.documentId}` };
  if (ticket.session !== s.session) return { ok: false, state: s, code: 'save.session', message: 'The ticket was issued by another open of this document' };
  if (ticket.baseDigest !== s.baseDigest) return { ok: false, state: s, code: 'save.stale-base', message: `Ticket base ${ticket.baseDigest} is not the current base ${s.baseDigest}` };
  const checked = ticket.contentId === s.contentId ? { contentId: s.contentId, digest } : s.checked;
  return { ok: true, state: { ...s, saved: { contentId: ticket.contentId, digest }, baseDigest: digest, checked } };
}

/** Restores the last saved content with a fresh history (RigLab RL-049 semantics, R1 C). The base on disk is unchanged. */
export function revert(s: DocumentState, savedModel: MapModel): DocumentState {
  if (!s.saved || s.baseDigest === null) throw new RangeError('A document never saved cannot revert');
  if (savedModel.id !== s.documentId) throw new RangeError('The saved model belongs to another document');
  const saved = { contentId: s.nextContentId, digest: s.saved.digest };
  return { ...openDocument(savedModel, { savedDigest: s.saved.digest, baseDigest: s.baseDigest, budget: s.budget }), session: s.session, revision: s.revision + 1,
    contentId: s.nextContentId, nextContentId: s.nextContentId + 1, saved, checked: saved };
}

/**
 * Replaces the content with a recovered draft as a fresh history (R1 C2 Recovery). The saved state is unchanged,
 * so the draft is dirty; `baseDigest` is the file the draft was edited from, so saving it over a file that changed
 * since is refused as stale rather than overwriting the change.
 */
export function restoreDraft(s: DocumentState, draft: MapModel, baseDigest: string | null): DocumentState {
  if (draft.id !== s.documentId) throw new RangeError('The draft belongs to another document');
  return { ...openDocument(draft, { budget: s.budget }), session: s.session, revision: s.revision + 1, contentId: s.nextContentId,
    nextContentId: s.nextContentId + 1, saved: s.saved, baseDigest, checked: null };
}
