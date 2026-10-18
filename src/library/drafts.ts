// Unsaved-edit drafts (R1 C2 Recovery, H4). IndexedDB journals drafts only; it is never the authority for a saved
// document, and Safari may evict it (R1 A8). A draft names the file digest it was edited from, so restoring it
// over a file that changed since leads to a stale-base refusal at Save, not an overwrite.

export interface Draft {
  readonly key: string;
  readonly libraryId: string;
  readonly documentId: string;
  readonly path: string;
  /** SHA-256 of the file the edits started from, or null for a document not yet in the library. */
  readonly baseDigest: string | null;
  /** Library-form text of the unsaved content. */
  readonly text: string;
  /** ISO time of the last journaled edit. */
  readonly updatedAt: string;
}

export interface DraftStore {
  get(key: string): Promise<Draft | null>;
  put(draft: Draft): Promise<void>;
  delete(key: string): Promise<void>;
  list(libraryId: string): Promise<readonly Draft[]>;
}

export const draftKey = (libraryId: string, documentId: string): string => `${libraryId}\u0000${documentId}`;
/** Drafts of one library never mix with another's, even when two folders hold the same project. */
export const libraryKey = (label: string, projectId: string): string => `${label}\u0000${projectId}`;

export const DRAFT_DATABASE = 'maplab-drafts';
const STORE = 'drafts';

const done = <T>(request: IDBRequest<T>): Promise<T> => new Promise((ok, fail) => {
  request.onsuccess = () => ok(request.result);
  request.onerror = () => fail(request.error ?? new Error('IndexedDB request failed'));
});

/** IndexedDB drafts, or null where IndexedDB is unavailable (a private window, a blocked origin, a test renderer). */
export async function openIndexedDbDrafts(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<DraftStore | null> {
  if (!factory) return null;
  let db: IDBDatabase;
  try {
    const request = factory.open(DRAFT_DATABASE, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'key' });
      store.createIndex('libraryId', 'libraryId');
    };
    db = await done(request);
  } catch {
    return null;
  }
  const tx = (mode: IDBTransactionMode): IDBObjectStore => db.transaction(STORE, mode).objectStore(STORE);
  return {
    async get(key) { return ((await done(tx('readonly').get(key))) as Draft | undefined) ?? null; },
    async put(draft) { await done(tx('readwrite').put(draft)); },
    async delete(key) { await done(tx('readwrite').delete(key)); },
    async list(libraryId) { return (await done(tx('readonly').index('libraryId').getAll(libraryId))) as Draft[]; },
  };
}

/** An in-memory store with the same behavior, for unit tests. */
export function memoryDrafts(): DraftStore & { readonly size: number } {
  const all = new Map<string, Draft>();
  return {
    get size() { return all.size; },
    async get(key) { return all.get(key) ?? null; },
    async put(draft) { all.set(draft.key, structuredClone(draft)); },
    async delete(key) { all.delete(key); },
    async list(libraryId) { return [...all.values()].filter((d) => d.libraryId === libraryId); },
  };
}
