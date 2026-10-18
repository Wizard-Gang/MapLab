// Node only: the library save algorithm (adopted H4, R1 H4). Re-read the index and files; refuse stale
// bases; validate the merged library across documents; back up every file about to be replaced or
// removed; write each file to a temporary file, fsync and rename; write the index the same way LAST;
// then delete removed files. The index is the commit point, so an interrupted save is detectable later
// as a document whose digest is not the index's (torn) and is never guessed at.
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { canonical, error, loadSourceGraph, parseJson, pathAliasKey, type Diagnostic, type JsonValue, type ProjectDocument } from '../contracts';
import { sha256Hex, utf8Bytes } from './digest';
import { LibraryError, insidePath, newestMatchingBackup, readLibrary, readLibraryFile, type LibraryFolder, type LibraryRead } from './folder';
import { BACKUP_FOLDER, checkIndex, documentPath } from './layout';
import { libraryForm } from './library-form';
import {
  DOCUMENT_LIMIT, PROJECT_INDEX, type Conflict, type DocumentKind, type RecoverRequest, type RecoverResponse, type Refusal, type SaveRequest, type SaveSuccess,
} from './protocol';

/** Every filesystem effect, in order, for tests that prove the ordering and inject failures. */
export type WriteStep =
  | Readonly<{ step: 'backup'; path: string; to: string }>
  | Readonly<{ step: 'write' | 'index'; path: string; temp: string }>
  | Readonly<{ step: 'rename'; path: string }>
  | Readonly<{ step: 'remove'; path: string }>;
export interface WriteHooks { readonly onStep?: (s: WriteStep) => void }

/** A path this write changed and the SHA-256 it now holds, or null for a path it removed. */
export interface Touched { readonly path: string; readonly digest: string | null }
export type WriteOutcome = { readonly ok: true; readonly result: SaveSuccess; readonly touched: readonly Touched[] } | { readonly ok: false; readonly status: number; readonly refusal: Refusal };
const refused = (status: number, code: string, message: string, extra: Partial<Refusal> = {}): WriteOutcome =>
  ({ ok: false, status, refusal: { ok: false, code, message, ...extra } });

const isDigest = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const isKind = (v: unknown): v is DocumentKind => ['map', 'tileset', 'prefab', 'movement', 'catalog', 'palette'].includes(v as string);

/** UTC `YYYYMMDDTHHMMSSmmmZ` plus a save suffix: unique, and sorting by name sorts by time. */
export const backupStamp = (now: Date, saveId: string): string => `${now.toISOString().replace(/[-:.]/g, '')}-${saveId.slice(0, 8)}`;

/** Creates `dir` when needed and fsyncs the parent of every folder it created, so new folders survive a crash too. */
function ensureDir(dir: string): void {
  const first = mkdirSync(dir, { recursive: true });
  if (first === undefined) return;
  for (let d = dir; ; d = dirname(d)) {
    syncDir(dirname(d));
    if (d === first || dirname(d) === d) break;
  }
}

function durableWrite(full: string, bytes: Uint8Array, temp: string): void {
  ensureDir(dirname(full));
  const fd = openSync(temp, 'wx', 0o644);
  try {
    for (let at = 0; at < bytes.length;) at += writeSync(fd, bytes, at, bytes.length - at);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}
function syncDir(dir: string): void {
  const fd = openSync(dir, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Temp file, fsync, rename, fsync of the folder: a reader sees the old bytes or the new ones, never a mixture. */
function replaceFile(folder: LibraryFolder, path: string, bytes: Uint8Array, saveId: string, kind: 'write' | 'index', hooks: WriteHooks): void {
  const full = insidePath(folder, path);
  const temp = join(dirname(full), `.${path.split('/').at(-1) ?? 'file'}.${saveId}.tmp`);
  hooks.onStep?.({ step: kind, path, temp });
  try {
    durableWrite(full, bytes, temp);
    hooks.onStep?.({ step: 'rename', path });
    renameSync(temp, full);
  } catch (e) {
    rmSync(temp, { force: true });
    throw e;
  }
  syncDir(dirname(full));
}

function backup(folder: LibraryFolder, stamp: string, path: string, bytes: Uint8Array, hooks: WriteHooks): void {
  const to = `${BACKUP_FOLDER}/${stamp}/${path}`;
  hooks.onStep?.({ step: 'backup', path, to });
  const full = insidePath(folder, to);
  ensureDir(dirname(full));
  const fd = openSync(full, 'wx', 0o644);
  try {
    for (let at = 0; at < bytes.length;) at += writeSync(fd, bytes, at, bytes.length - at);
    fsyncSync(fd);
  } finally { closeSync(fd); }
  syncDir(dirname(full));
}

const torn = (read: LibraryRead): readonly Conflict[] => read.documents.filter((d) => d.digest !== d.indexed)
  .map((d) => ({ id: d.id, path: d.path, baseDigest: d.indexed, currentDigest: d.digest }));

/** Plans and writes one save, or refuses it changing nothing. `request` is the parsed request body. */
export async function writeSave(folder: LibraryFolder, request: unknown, saveId: string, now: Date, hooks: WriteHooks = {}): Promise<WriteOutcome> {
  if (folder.placeholder) return refused(403, 'library.read-only', 'The placeholder library is read-only: set MAPLAB_LIBRARY to a library folder, or create ~/Documents/MapLab');
  const body = request as SaveRequest;
  if (typeof request !== 'object' || request === null || !Array.isArray(body.documents) || (body.remove !== undefined && !Array.isArray(body.remove))) {
    return refused(400, 'save.request', 'A save is {documents: [...], remove?: [...]}');
  }
  if (!body.documents.length && !body.remove?.length) return refused(400, 'save.empty', 'A save names at least one document');
  // 1. Re-read the index and every file, so the decision uses what is on disk now.
  let read: LibraryRead;
  try { read = await readLibrary(folder); } catch (e) {
    if (e instanceof LibraryError) return refused(409, e.code, e.message);
    throw e;
  }
  const byId = new Map(read.documents.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const conflicts: Conflict[] = [];
  const problems: Diagnostic[] = [];
  // `previous`: the bytes this write replaces, which are backed up first; null for a new file.
  const incoming: { id: string; kind: DocumentKind; path: string; text: string; value: JsonValue; previous: Uint8Array | null }[] = [];
  for (const [i, d] of body.documents.entries()) {
    const at = ['documents', i];
    if (typeof d !== 'object' || d === null || typeof d.id !== 'string' || !isKind(d.kind) || typeof d.text !== 'string' || !(d.baseDigest === null || isDigest(d.baseDigest))) {
      return refused(400, 'save.request', `documents[${i}] must be {id, kind, text, baseDigest}`);
    }
    if (seen.has(d.id)) return refused(400, 'save.request', `${d.id} is listed twice`);
    seen.add(d.id);
    if (d.kind === 'palette') { problems.push(error('save.palette', at, 'Palettes cannot be saved until their format exists', d.id)); continue; }
    const current = byId.get(d.id);
    // 2. A stale base (an outside edit since open) or a new document that already exists conflicts.
    const path = current?.path ?? documentPath(d.kind, d.id);
    if (path === null) { problems.push(error('save.path', [...at, 'id'], `${d.id} cannot be a library file name`, d.id)); continue; }
    if (current && current.kind !== d.kind) { problems.push(error('save.kind', [...at, 'kind'], `${d.id} is a ${current.kind}`, d.id)); continue; }
    // A file left unindexed by an interrupted save of this same new document may be replaced by a retry with identical bytes.
    const stray = d.baseDigest === null && current === undefined ? readLibraryFile(folder, path) : null;
    const retry = stray !== null && (await sha256Hex(stray)) === (await sha256Hex(d.text));
    if (d.baseDigest === null ? current !== undefined || (stray !== null && !retry) : current?.digest !== d.baseDigest) {
      conflicts.push({ id: d.id, path, baseDigest: d.baseDigest, currentDigest: current?.digest ?? (stray ? await sha256Hex(stray) : null) });
      continue;
    }
    if (utf8Bytes(d.text).length > DOCUMENT_LIMIT) { problems.push(error('save.too-large', at, `${d.id} is larger than 64 MiB`, d.id)); continue; }
    const parsed = parseJson(d.text);
    if (!parsed.ok) { problems.push({ ...parsed.diagnostic, documentId: d.id }); continue; }
    const v = parsed.value as Record<string, JsonValue>;
    if (v.format !== `maplab.${d.kind}` || v.id !== d.id) { problems.push(error('save.identity', at, `${d.id} must be a maplab.${d.kind} document with that ID`, d.id)); continue; }
    if (libraryForm(parsed.value) !== d.text) { problems.push(error('save.form', at, `${d.id} is not in library form`, d.id)); continue; }
    incoming.push({ id: d.id, kind: d.kind, path, text: d.text, value: parsed.value, previous: current ? current.bytes : stray });
  }
  const removing: { id: string; path: string }[] = [];
  for (const [i, r] of (body.remove ?? []).entries()) {
    if (typeof r !== 'object' || r === null || typeof r.id !== 'string' || !isDigest(r.baseDigest)) return refused(400, 'save.request', `remove[${i}] must be {id, baseDigest}`);
    const current = byId.get(r.id);
    if (!current || seen.has(current.id)) { problems.push(error('save.remove', ['remove', i], 'Remove names an indexed document not also saved', current?.id ?? null)); continue; }
    if (current.digest !== r.baseDigest) { conflicts.push({ id: current.id, path: current.path, baseDigest: r.baseDigest, currentDigest: current.digest }); continue; }
    seen.add(current.id);
    removing.push({ id: current.id, path: current.path });
  }
  if (conflicts.length) return refused(409, 'save.stale-base', 'A document changed on disk since it was opened; nothing was written', { conflicts });
  // Any document whose file disagrees with the index, including one in this save, must first be kept, restored or
  // forgotten by the user's explicit choice; a save never resolves it implicitly.
  const tornNow = torn(read);
  if (tornNow.length) return refused(409, 'library.torn', 'An earlier save was interrupted or a file was edited outside MapLab; keep or restore it before saving', { conflicts: tornNow });
  if (problems.length) return refused(422, 'save.invalid', 'The save was refused; nothing was written', { diagnostics: problems.slice(0, 100) });
  // A new path must not alias one already in the library on a case-insensitive file system.
  const aliases = new Map(read.documents.filter((d) => !removing.some((r) => r.id === d.id)).map((d) => [pathAliasKey(d.path), d.id]));
  for (const d of incoming) {
    const owner = aliases.get(pathAliasKey(d.path));
    if (owner !== undefined && owner !== d.id) return refused(422, 'save.path-alias', `${d.path} aliases the file of ${owner}`);
    aliases.set(pathAliasKey(d.path), d.id);
  }
  // 3. Validate the merged library, including references across documents and index paths.
  const merged = new Map<string, { kind: DocumentKind; path: string; value: JsonValue | Uint8Array }>();
  for (const d of read.documents) if (!removing.some((r) => r.id === d.id)) merged.set(d.id, { kind: d.kind, path: d.path, value: d.bytes as Uint8Array });
  for (const d of incoming) merged.set(d.id, { kind: d.kind, path: d.path, value: d.value });
  const sources = [...merged.values()].filter((d) => d.kind !== 'palette');
  if (sources.length) {
    const graph = loadSourceGraph(sources.map((d) => (d.value instanceof Uint8Array ? d.value : canonical(d.value))));
    if (!graph.ok) return refused(422, 'save.invalid', 'The merged library does not validate; nothing was written', { diagnostics: graph.diagnostics });
    for (const doc of graph.documents) for (const [i, dep] of ('dependencies' in doc ? doc.dependencies : []).entries()) {
      const target = merged.get(dep.id);
      if (target && target.path !== dep.path) problems.push(error('save.dependency-path', ['dependencies', i, 'path'], `${dep.id} lives at ${target.path}, not ${dep.path}`, doc.id));
    }
    if (problems.length) return refused(422, 'save.invalid', 'Dependency paths disagree with the project index; nothing was written', { diagnostics: problems.slice(0, 100) });
  }
  const written: { id: string; path: string; digest: string; bytes: Uint8Array; previous: Uint8Array | null }[] = [];
  for (const d of incoming) {
    const bytes = utf8Bytes(d.text);
    written.push({ id: d.id, path: d.path, digest: await sha256Hex(bytes), bytes, previous: d.previous });
  }
  const entries = new Map<string, ProjectDocument['documents'][number]>(read.index.documents.map((d) => [d.id, d]));
  for (const r of removing) entries.delete(r.id);
  for (const w of written) entries.set(w.id, { id: w.id, kind: merged.get(w.id)?.kind as DocumentKind, path: w.path, sha256: w.digest });
  const index = { ...read.index, documents: [...entries.values()] } as unknown as JsonValue;
  const checkedIndex = checkIndex(index);
  if (!checkedIndex.ok) return refused(422, 'save.index', 'The new project index would not validate; nothing was written', { diagnostics: checkedIndex.diagnostics });
  const indexBytes = utf8Bytes(libraryForm(index));

  // 4. Back up everything about to be replaced or removed, the index included.
  const stamp = backupStamp(now, saveId);
  for (const w of written) if (w.previous) backup(folder, stamp, w.path, w.previous, hooks);
  for (const r of removing) backup(folder, stamp, r.path, read.documents.find((d) => d.id === r.id)?.bytes as Uint8Array, hooks);
  backup(folder, stamp, PROJECT_INDEX, read.indexBytes, hooks);
  // 5. Each document: temp, fsync, rename. 6. The index, the commit point, last. 7. Removed files.
  for (const w of written) replaceFile(folder, w.path, w.bytes, saveId, 'write', hooks);
  replaceFile(folder, PROJECT_INDEX, indexBytes, saveId, 'index', hooks);
  for (const r of removing) {
    hooks.onStep?.({ step: 'remove', path: r.path });
    unlinkSync(insidePath(folder, r.path));
  }
  const touched: Touched[] = [...written.map((w) => ({ path: w.path, digest: w.digest })), { path: PROJECT_INDEX, digest: await sha256Hex(indexBytes) },
    ...removing.map((r) => ({ path: r.path, digest: null }))];
  return {
    ok: true, touched,
    result: { ok: true, saveId, label: folder.label, written: written.map(({ id, path, digest }) => ({ id, path, digest })), removed: removing.map((r) => r.path),
      backup: `${BACKUP_FOLDER}/${stamp}` },
  };
}

export type RecoverOutcome = { readonly ok: true; readonly result: RecoverResponse & { ok: true }; readonly touched: readonly Touched[] } | { readonly ok: false; readonly status: number; readonly refusal: Refusal };

/**
 * Resolves one torn or missing document, as the user chose; MapLab never picks. "keep" records the file's
 * current digest in the index. "restore" backs up the current bytes, then puts back the newest backup whose
 * bytes match the index. "forget" removes a document whose file is gone from the index (the old index is backed
 * up), for a file deleted outside MapLab with no backup to restore. `digest` must be the file digest the user saw
 * (null for a missing file), so a later change is not resolved blind.
 */
export async function recoverDocument(folder: LibraryFolder, request: unknown, saveId: string, now: Date, hooks: WriteHooks = {}): Promise<RecoverOutcome> {
  const no = (status: number, code: string, message: string): RecoverOutcome => ({ ok: false, status, refusal: { ok: false, code, message } });
  if (folder.placeholder) return no(403, 'library.read-only', 'The placeholder library is read-only');
  const r = request as RecoverRequest;
  if (typeof request !== 'object' || request === null || typeof r.id !== 'string' || !['keep', 'restore', 'forget'].includes(r.action) || !(r.digest === null || isDigest(r.digest))) {
    return no(400, 'recover.request', 'A recovery is {id, action: "keep" | "restore" | "forget", digest}');
  }
  let read: LibraryRead;
  try { read = await readLibrary(folder); } catch (e) {
    if (e instanceof LibraryError) return no(409, e.code, e.message);
    throw e;
  }
  const doc = read.documents.find((d) => d.id === r.id);
  if (!doc) return no(404, 'recover.unknown', `${r.id} is not in the project index`);
  if (doc.digest === doc.indexed) return no(409, 'recover.not-torn', `${r.id} matches the index; there is nothing to recover`);
  if (doc.digest !== r.digest) return no(409, 'recover.changed', `${r.id} changed again on disk; reload before recovering`);
  const stamp = backupStamp(now, saveId);
  if (r.action === 'forget') {
    if (doc.digest !== null) return no(409, 'recover.present', `${r.id} still has a file; keep or restore it instead`);
    const index = { ...read.index, documents: read.index.documents.filter((d) => d.id !== r.id) } as unknown as JsonValue;
    backup(folder, stamp, PROJECT_INDEX, read.indexBytes, hooks);
    const bytes = utf8Bytes(libraryForm(index));
    replaceFile(folder, PROJECT_INDEX, bytes, saveId, 'index', hooks);
    return { ok: true, touched: [{ path: PROJECT_INDEX, digest: await sha256Hex(bytes) }], result: { ok: true, id: r.id, digest: null, backup: `${BACKUP_FOLDER}/${stamp}` } };
  }
  if (r.action === 'keep') {
    if (!doc.digest) return no(409, 'recover.missing', `${r.id} has no file to keep; restore it from a backup`);
    const index = { ...read.index, documents: read.index.documents.map((d) => (d.id === r.id ? { ...d, sha256: doc.digest as string } : d)) } as unknown as JsonValue;
    backup(folder, stamp, PROJECT_INDEX, read.indexBytes, hooks);
    const bytes = utf8Bytes(libraryForm(index));
    replaceFile(folder, PROJECT_INDEX, bytes, saveId, 'index', hooks);
    return { ok: true, touched: [{ path: PROJECT_INDEX, digest: await sha256Hex(bytes) }], result: { ok: true, id: r.id, digest: doc.digest, backup: `${BACKUP_FOLDER}/${stamp}` } };
  }
  const match = await newestMatchingBackup(folder, doc.path, doc.indexed);
  if (!match) return no(409, 'recover.no-backup', `No backup of ${doc.path} matches the index; keep the file instead`);
  if (doc.bytes) backup(folder, stamp, doc.path, doc.bytes, hooks);
  replaceFile(folder, doc.path, match.bytes, saveId, 'write', hooks);
  return { ok: true, touched: [{ path: doc.path, digest: doc.indexed }], result: { ok: true, id: r.id, digest: doc.indexed, backup: doc.bytes ? `${BACKUP_FOLDER}/${stamp}` : null } };
}
