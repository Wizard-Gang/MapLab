// Library folder layout (adopted H4, R1 H4): where each document kind lives and what a project index
// may name. Paths are library-relative, one file per document directly inside its kind's folder. Pure.
import { checkSafePath, error, isId, pathAliasKey, validateDocumentSchema, type Diagnostic, type JsonValue, type ProjectDocument } from '../contracts';
import type { DocumentKind } from './protocol';

export const KIND_FOLDERS: Readonly<Record<DocumentKind, string>> = Object.freeze({
  map: 'maps', movement: 'movement', catalog: 'catalogs', tileset: 'tilesets', prefab: 'prefabs', palette: 'palettes',
});
export const KINDS = Object.keys(KIND_FOLDERS) as readonly DocumentKind[];
/** Folders the writer owns besides the documents: backups and derived caches are never indexed. */
export const BACKUP_FOLDER = 'backups';

const isKind = (v: unknown): v is DocumentKind => typeof v === 'string' && Object.hasOwn(KIND_FOLDERS, v);

/** Why `path` cannot hold a `kind` document, or null: `<folder>/<name>.<kind>.json` with a safe name. */
export function layoutProblem(kind: DocumentKind, path: string): string | null {
  const unsafe = checkSafePath(path);
  if (unsafe) return `unsafe path (${unsafe})`;
  const folder = KIND_FOLDERS[kind], ext = `.${kind}.json`;
  const parts = path.split('/');
  if (parts.length !== 2 || parts[0] !== folder || !parts[1]?.endsWith(ext) || parts[1].length === ext.length) return `a ${kind} must be ${folder}/<name>${ext}`;
  return null;
}

/** The path a new document gets: its ID without the `<kind>.` prefix, in its kind's folder. Null when the ID cannot be a file name. */
export function documentPath(kind: DocumentKind, id: string): string | null {
  if (!isId(id)) return null;
  const name = id.startsWith(`${kind}.`) && id.length > kind.length + 1 ? id.slice(kind.length + 1) : id;
  const path = `${KIND_FOLDERS[kind]}/${name}.${kind}.json`;
  return layoutProblem(kind, path) === null ? path : null;
}

export type IndexResult = { readonly ok: true; readonly index: ProjectDocument } | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** A project index that validates against its schema and names unique IDs and non-aliasing, well-placed paths. */
export function checkIndex(value: JsonValue): IndexResult {
  const schema = validateDocumentSchema(value);
  if (schema.length) return { ok: false, diagnostics: schema };
  const index = value as unknown as ProjectDocument;
  if (index.format !== 'maplab.project') return { ok: false, diagnostics: [error('library.index-format', ['format'], 'The project index must be a maplab.project document')] };
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<string>(), paths = new Map<string, string>();
  index.documents.forEach((d, i) => {
    if (ids.has(d.id)) diagnostics.push(error('library.duplicate-id', ['documents', i, 'id'], `Document ${d.id} is indexed twice`, index.id));
    ids.add(d.id);
    const alias = pathAliasKey(d.path), owner = paths.get(alias);
    if (owner !== undefined) diagnostics.push(error('library.path-alias', ['documents', i, 'path'], `${d.path} aliases the path of ${owner}`, index.id));
    paths.set(alias, d.id);
    const problem = isKind(d.kind) ? layoutProblem(d.kind, d.path) : 'unknown kind';
    if (problem) diagnostics.push(error('library.layout', ['documents', i, 'path'], `${d.path}: ${problem}`, index.id));
  });
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, index };
}
