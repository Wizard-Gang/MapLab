// Browser client for the loopback library endpoints (adopted H4, R1 C2/H4). Same-origin JSON POSTs only. When
// no MapLab dev server answers (the static build), every call reports `client.offline` instead of throwing.
import {
  CHANGED_EVENT, ROUTES, SAVED_EVENT, type ChangedEvent, type LibrarySnapshot, type ReadResponse, type RecoverRequest, type RecoverResponse,
  type Refusal, type SaveRequest, type SaveResponse, type SavedEvent,
} from './protocol';

const offline = (message: string): Refusal => ({ ok: false, code: 'client.offline', message });

async function post<T extends { ok: true }>(route: string, body: unknown, signal?: AbortSignal): Promise<T | Refusal> {
  let response: Response;
  try {
    response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', credentials: 'same-origin', ...(signal ? { signal } : {}) });
  } catch (e) {
    return offline(`The library server did not answer (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!(response.headers.get('content-type') ?? '').startsWith('application/json')) {
    await response.body?.cancel();
    return offline('No MapLab library server is running here; start one with npm start');
  }
  try {
    return (await response.json()) as T | Refusal;
  } catch {
    return { ok: false, code: 'client.response', message: `The library server sent an unreadable reply (HTTP ${response.status})` };
  }
}

export const fetchLibrary = (): Promise<LibrarySnapshot | Refusal> => post<LibrarySnapshot>(ROUTES.library, {});
export const readDocuments = (ids: readonly string[]): Promise<ReadResponse | Refusal> => post<ReadResponse>(ROUTES.read, { ids });
export const saveDocuments = (request: SaveRequest): Promise<SaveResponse> => post(ROUTES.save, request);
export const recoverDocument = (request: RecoverRequest): Promise<RecoverResponse> => post(ROUTES.recover, request);

export interface LibraryEvents { readonly saved: (e: SavedEvent) => void; readonly changed: (e: ChangedEvent) => void }

/** Subscribes to the dev server's library events; a no-op in the static build. Returns the unsubscribe. */
export function onLibraryEvents(events: LibraryEvents): () => void {
  const hot = import.meta.hot;
  if (!hot) return () => {};
  const saved = (e: SavedEvent): void => events.saved(e);
  const changed = (e: ChangedEvent): void => events.changed(e);
  hot.on(SAVED_EVENT, saved);
  hot.on(CHANGED_EVENT, changed);
  return () => { hot.off(SAVED_EVENT, saved); hot.off(CHANGED_EVENT, changed); };
}

export interface AssetReply { readonly ok: true; readonly asset: import('../contracts/common-types').Asset; readonly base64: string }
export const importImage = (mediaType: string, base64: string): Promise<AssetReply | Refusal> => post<AssetReply>(ROUTES.assetImport, { mediaType, base64 });
export const readImage = (path: string, signal?: AbortSignal): Promise<AssetReply | Refusal> => post<AssetReply>(ROUTES.assetRead, { path }, signal);
