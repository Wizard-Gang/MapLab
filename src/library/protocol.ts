// The loopback library protocol (adopted H4, R1 H4) shared by the Vite plugin and the browser client.
// Every endpoint is a guarded POST under /__maplab/ on the dev server; the static build has none. Pure types.
import type { Diagnostic } from '../contracts';

export const ROUTE_PREFIX = '/__maplab/';
export const ROUTES = Object.freeze({
  assetImport: '/__maplab/asset-import', assetRead: '/__maplab/asset-read', identity: '/__maplab/identity', library: '/__maplab/library', read: '/__maplab/read', save: '/__maplab/save', recover: '/__maplab/recover',
});
/** HMR events: a save this server wrote, and outside changes the watcher saw. */
export const SAVED_EVENT = 'maplab:library-saved';
export const CHANGED_EVENT = 'maplab:library-changed';

const MiB = 1024 * 1024;
/** R1 H4 body bounds: 64 MiB per document and 128 MiB per save. Other requests are small. */
export const DOCUMENT_LIMIT = 64 * MiB;
export const SAVE_LIMIT = 128 * MiB;
export const REQUEST_LIMIT = MiB;
export const PROJECT_INDEX = 'maplab.project.json';

export type DocumentKind = 'map' | 'tileset' | 'prefab' | 'movement' | 'catalog' | 'palette';

export interface Identity { readonly app: 'maplab'; readonly pid: number; readonly root: string; readonly library: string }

/** One project-index entry with what is on disk. `torn`: the file's digest is not the index's; `missing`: no file. */
export interface LibraryEntry {
  readonly id: string;
  readonly kind: DocumentKind;
  readonly path: string;
  readonly indexed: string;
  readonly digest: string | null;
  readonly state: 'ok' | 'torn' | 'missing';
  /** Error diagnostics for this document from validating the whole library; empty when it validates. */
  readonly errors: number;
  readonly warnings: number;
  /** A torn or missing document has a backup whose bytes match the index, so it can be restored. */
  readonly restorable: boolean;
}
export interface LibrarySnapshot {
  readonly ok: true;
  readonly label: string;
  readonly readOnly: boolean;
  readonly placeholder: boolean;
  readonly projectId: string;
  readonly name: string;
  readonly defaults: Readonly<{ tileSize: readonly [number, number]; snap: readonly [number, number]; movementId: string | null }>;
  readonly documents: readonly LibraryEntry[];
  /** Library files no index entry names (for example a new document from an interrupted save). */
  readonly unindexed: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
}
export interface ReadResponse { readonly ok: true; readonly documents: readonly Readonly<{ id: string; path: string; digest: string; text: string }>[] }

export interface SaveDocument {
  readonly id: string;
  readonly kind: DocumentKind;
  /** Library-form text; the server refuses any other form. */
  readonly text: string;
  /** SHA-256 of the file bytes this edit was based on, or null for a document that is new to the library. */
  readonly baseDigest: string | null;
}
export interface SaveRequest { readonly documents: readonly SaveDocument[]; readonly remove?: readonly Readonly<{ id: string; baseDigest: string }>[] }
export interface Conflict { readonly id: string; readonly path: string; readonly baseDigest: string | null; readonly currentDigest: string | null }
export interface SaveSuccess {
  readonly ok: true;
  readonly saveId: string;
  readonly label: string;
  readonly written: readonly Readonly<{ id: string; path: string; digest: string }>[];
  readonly removed: readonly string[];
  /** Library-relative backup folder; every save backs up at least the old index there. */
  readonly backup: string;
}
export interface Refusal {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
  readonly conflicts?: readonly Conflict[];
  readonly diagnostics?: readonly Diagnostic[];
}
export type SaveResponse = SaveSuccess | Refusal;

/**
 * "keep": accept the file as it is and record its digest. "restore": put back the newest backup that matches the
 * index. "forget": drop a document whose file is gone from the index.
 */
export interface RecoverRequest { readonly id: string; readonly action: 'keep' | 'restore' | 'forget'; readonly digest: string | null }
export type RecoverResponse = { readonly ok: true; readonly id: string; readonly digest: string | null; readonly backup: string | null } | Refusal;

export interface SavedEvent { readonly saveId: string; readonly paths: readonly string[] }
export interface ChangedEvent { readonly paths: readonly string[] }
