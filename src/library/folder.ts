// Node only: choosing and reading the library folder (adopted H4, R1 H4/H8). Disk is the authority; every
// read re-reads it. A path is read only when it stays inside the folder's real path and is a regular file,
// never a symlink, so an index entry cannot reach outside the library.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { error, loadSourceGraph, parseJson, type Diagnostic, type ProjectDocument } from '../contracts';
import { sha256Hex } from './digest';
import { BACKUP_FOLDER, KIND_FOLDERS, checkIndex } from './layout';
import { DOCUMENT_LIMIT, PROJECT_INDEX, type DocumentKind, type LibraryEntry, type LibrarySnapshot } from './protocol';

export const PLACEHOLDER_FOLDER = 'placeholder-library';

export interface LibraryFolder {
  /** The folder's real path. */
  readonly dir: string;
  /** Home-relative name for the toolbar, or "placeholder library". */
  readonly label: string;
  readonly placeholder: boolean;
}

export class LibraryError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const real = (path: string): string => realpathSync(path);

/**
 * R1 H4 resolution: `MAPLAB_LIBRARY` (an absolute folder holding `maplab.project.json`), else
 * `~/Documents/MapLab/` when it holds one, else the repository's read-only placeholder library.
 */
export function chooseLibrary(options: { readonly repoRoot: string; readonly env?: string | undefined; readonly home?: string }): LibraryFolder {
  const home = options.home ?? homedir();
  const placeholderDir = real(resolve(options.repoRoot, PLACEHOLDER_FOLDER));
  const label = (dir: string): string => {
    if (dir === placeholderDir) return 'placeholder library';
    const homeReal = existsSync(home) ? real(home) : home;
    return dir === homeReal || dir.startsWith(homeReal + sep) ? `~/${relative(homeReal, dir)}` : dir;
  };
  const folder = (dir: string): LibraryFolder => ({ dir, label: label(dir), placeholder: dir === placeholderDir });
  if (options.env !== undefined && options.env !== '') {
    if (!isAbsolute(options.env)) throw new LibraryError('library.env', `MAPLAB_LIBRARY must be an absolute path; received ${JSON.stringify(options.env)}`);
    if (!existsSync(join(options.env, PROJECT_INDEX))) throw new LibraryError('library.env', `MAPLAB_LIBRARY ${options.env} holds no ${PROJECT_INDEX}`);
    return folder(real(options.env));
  }
  const documents = join(home, 'Documents', 'MapLab');
  if (existsSync(join(documents, PROJECT_INDEX))) return folder(real(documents));
  return folder(placeholderDir);
}

/** The absolute path of library-relative `path`, refused when it is a symlink or its real path leaves the folder. */
export function insidePath(folder: LibraryFolder, path: string): string {
  const full = join(folder.dir, ...path.split('/'));
  let probe = folder.dir;
  for (const part of path.split('/')) {
    probe = join(probe, part);
    if (!existsSync(probe)) break;
    if (lstatSync(probe).isSymbolicLink()) throw new LibraryError('library.symlink', `${path} goes through a symbolic link`);
  }
  if (existsSync(full) && !(real(full) === folder.dir || real(full).startsWith(folder.dir + sep))) throw new LibraryError('library.escape', `${path} leaves the library`);
  return full;
}

/** Bytes of a library file, or null when absent. Refuses links, non-files and files over the document bound. */
export function readLibraryFile(folder: LibraryFolder, path: string, limit = DOCUMENT_LIMIT): Uint8Array | null {
  const full = insidePath(folder, path);
  if (!existsSync(full)) return null;
  const stat = lstatSync(full);
  if (!stat.isFile()) throw new LibraryError('library.not-file', `${path} is not a regular file`);
  if (stat.size > limit) throw new LibraryError('library.too-large', `${path} is larger than ${limit} bytes`);
  return new Uint8Array(readFileSync(full));
}

export interface ReadDocument {
  readonly id: string;
  readonly kind: DocumentKind;
  readonly path: string;
  readonly indexed: string;
  readonly bytes: Uint8Array | null;
  readonly digest: string | null;
}
export interface LibraryRead {
  readonly folder: LibraryFolder;
  readonly index: ProjectDocument;
  readonly indexBytes: Uint8Array;
  readonly documents: readonly ReadDocument[];
  readonly unindexed: readonly string[];
}

/** Reads the index and every indexed document with its actual digest. Throws LibraryError when the index is unusable. */
export async function readLibrary(folder: LibraryFolder): Promise<LibraryRead> {
  const indexBytes = readLibraryFile(folder, PROJECT_INDEX);
  if (!indexBytes) throw new LibraryError('library.no-index', `${folder.label} has no ${PROJECT_INDEX}`);
  const parsed = parseJson(indexBytes);
  if (!parsed.ok) throw new LibraryError('library.index', `${PROJECT_INDEX}: ${parsed.diagnostic.message}`);
  const checked = checkIndex(parsed.value);
  if (!checked.ok) throw new LibraryError('library.index', `${PROJECT_INDEX}: ${checked.diagnostics.map((d) => `${d.jsonPath} ${d.message}`).join('; ')}`);
  const documents: ReadDocument[] = [];
  for (const d of checked.index.documents) {
    const bytes = readLibraryFile(folder, d.path);
    documents.push({ id: d.id, kind: d.kind, path: d.path, indexed: d.sha256, bytes, digest: bytes ? await sha256Hex(bytes) : null });
  }
  const indexed = new Set(checked.index.documents.map((d) => d.path));
  const unindexed: string[] = [];
  for (const sub of Object.values(KIND_FOLDERS)) {
    const dir = join(folder.dir, sub);
    if (!existsSync(dir) || !lstatSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir).sort()) if (!indexed.has(`${sub}/${name}`) && !name.startsWith('.')) unindexed.push(`${sub}/${name}`);
  }
  return { folder, index: checked.index, indexBytes, documents, unindexed };
}

/** Backup folders, newest first (their names sort by UTC time). */
export function backupStamps(folder: LibraryFolder): string[] {
  const dir = join(folder.dir, BACKUP_FOLDER);
  if (!existsSync(dir) || lstatSync(dir).isSymbolicLink()) return [];
  return readdirSync(dir).filter((n) => !n.startsWith('.')).sort().reverse();
}

/** The newest backup of `path` whose bytes have `digest`, with those bytes; null when none does. */
export async function newestMatchingBackup(folder: LibraryFolder, path: string, digest: string): Promise<{ stamp: string; bytes: Uint8Array } | null> {
  for (const stamp of backupStamps(folder)) {
    let bytes: Uint8Array | null;
    // A backup that is a link, not a file or too large is never restored, and never stops the search.
    try { bytes = readLibraryFile(folder, `${BACKUP_FOLDER}/${stamp}/${path}`); } catch (e) {
      if (e instanceof LibraryError) continue;
      throw e;
    }
    if (bytes && await sha256Hex(bytes) === digest) return { stamp, bytes };
  }
  return null;
}

const stateOf = (d: ReadDocument): LibraryEntry['state'] => (d.digest === null ? 'missing' : d.digest === d.indexed ? 'ok' : 'torn');

/** What the client sees: entries with their state, validation counts per document and library-wide diagnostics. */
export async function snapshot(read: LibraryRead): Promise<LibrarySnapshot> {
  const sources = read.documents.filter((d) => d.bytes && d.kind !== 'palette');
  const graph = sources.length ? loadSourceGraph(sources.map((d) => d.bytes as Uint8Array)) : null;
  const diagnostics: Diagnostic[] = graph ? [...graph.diagnostics] : [];
  if (read.documents.some((d) => d.kind === 'palette')) diagnostics.push(error('library.palette', [], 'Palettes are kept but not validated until their format exists'));
  const documents: LibraryEntry[] = [];
  for (const d of read.documents) {
    const state = stateOf(d);
    const mine = diagnostics.filter((x) => x.documentId === d.id);
    const restorable = state !== 'ok' && (await newestMatchingBackup(read.folder, d.path, d.indexed)) !== null;
    documents.push({ id: d.id, kind: d.kind, path: d.path, indexed: d.indexed, digest: d.digest, state, restorable,
      errors: mine.filter((x) => x.severity === 'error').length, warnings: mine.filter((x) => x.severity === 'warning').length });
  }
  return { ok: true, label: read.folder.label, readOnly: read.folder.placeholder, placeholder: read.folder.placeholder, projectId: read.index.id,
    name: read.index.name, defaults: read.index.defaults, documents, unindexed: read.unindexed, diagnostics: diagnostics.slice(0, 100) };
}
