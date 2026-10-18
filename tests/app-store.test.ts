// ML-009 review repairs, through the real LibraryStore and the real plugin: an offered draft is consumed only by the
// user's restore or discard (B1); a second Save cannot race the first (N2); a torn open document is locked until
// the user decides (N7); closing a tab journals its last edits.
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import { cpSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LibraryStore, lockReason, type OpenDoc } from '../src/app/store';
import { mapName } from '../src/editor/document';
import { isDirty } from '../src/editor/history';
import { draftKey, libraryKey, memoryDrafts } from '../src/library/drafts';
import { libraryForm } from '../src/library/library-form';
import { writeSave } from '../src/library/writer';
import { FOREST, cleanup, json, placeholderDir, put, renamed, scratchLibrary, startServer, text, type Server } from './library-support';

let server: Server;
const f = scratchLibrary();
const realFetch = globalThis.fetch;
beforeAll(async () => {
  server = await startServer(f.dir);
  const origin = `http://127.0.0.1:${server.port}`;
  // The page's fetch is same-origin; in Node the test supplies the origin the browser would send.
  globalThis.fetch = ((url: string, init: RequestInit = {}) => realFetch(`${origin}${url}`, { ...init, headers: { ...(init.headers as Record<string, string>), Origin: origin } })) as typeof fetch;
});
afterAll(async () => { globalThis.fetch = realFetch; await server.close(); cleanup(); });
beforeEach(() => { for (const n of readdirSync(f.dir)) rmSync(join(f.dir, n), { recursive: true, force: true }); cpSync(placeholderDir, f.dir, { recursive: true }); });

let drafts = memoryDrafts();
afterEach(() => { drafts = memoryDrafts(); });
async function started(): Promise<LibraryStore> {
  const store = new LibraryStore(async () => drafts);
  await store.start();
  return store;
}
const doc = (store: LibraryStore, id = 'map.forest'): OpenDoc => store.getSnapshot().docs.find((d) => d.id === id) as OpenDoc;
const key = (): string => draftKey(libraryKey(f.dir, 'project.forest-example'), 'map.forest');
const until = async (ok: () => boolean | Promise<boolean>): Promise<void> => {
  for (let i = 0; i < 200; i++) { if (await ok()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('condition not reached');
};
async function draftOf(name: string): Promise<void> {
  const d = json(f, FOREST);
  d.metadata = { ...d.metadata, name };
  await drafts.put({ key: key(), libraryId: libraryKey(f.dir, 'project.forest-example'), documentId: 'map.forest', path: FOREST, baseDigest: renamed(f, FOREST, name).baseDigest,
    text: libraryForm(d as never), updatedAt: '2026-10-18T00:00:00.000Z' });
}

test('an offered draft survives an outside save and locks editing until the user restores it', async () => {
  await draftOf('Draft work');
  const store = await started();
  await store.open('map.forest');
  expect(doc(store).draft?.text).toContain('Draft work');
  expect(lockReason(doc(store))).toBe('restore or discard the unsaved draft first');
  // Edits wait for the choice, so nothing journals over the draft.
  store.rename('Typed before choosing');
  expect(mapName(doc(store).state.model)).toBe('Forest acceptance world');
  // Another MapLab tab saves this map: index and file agree, so the open, clean document reloads.
  const other = await writeSave(f, { documents: [renamed(f, FOREST, 'Saved by another tab')] }, '0123456789abcdef0123456789abcdef', new Date());
  expect(other.ok).toBe(true);
  await store.refresh();
  expect(mapName(doc(store).state.model)).toBe('Saved by another tab');
  expect(doc(store).draft?.text).toContain('Draft work');
  expect((await drafts.get(key()))?.text).toContain('Draft work');
  await store.restoreDraft();
  expect([mapName(doc(store).state.model), isDirty(doc(store).state), doc(store).draft]).toEqual(['Draft work', true, null]);
  // The draft was edited from the earlier file, so saving it is refused rather than overwriting the other tab's save.
  await store.save();
  expect(store.getSnapshot().status).toContain('Save refused');
  expect(JSON.parse(text(f, FOREST)).metadata.name).toBe('Saved by another tab');
  store.dispose();
});

test('discard is the only other way an offered draft leaves the journal', async () => {
  await draftOf('Unwanted');
  const store = await started();
  await store.open('map.forest');
  await store.close('map.forest');
  expect(await drafts.get(key())).not.toBe(null);
  await store.open('map.forest');
  await store.discardDraft();
  expect([await drafts.get(key()), lockReason(doc(store))]).toEqual([null, null]);
  store.dispose();
});

test('two Save calls in a row write once and report the save', async () => {
  const store = await started();
  await store.open('map.forest');
  store.rename('Saved once');
  await Promise.all([store.save(), store.save()]);
  expect(store.getSnapshot().status).toMatch(/^Saved maps\/forest\.map\.json to /);
  expect([doc(store).conflicts, isDirty(doc(store).state), store.getSnapshot().busy]).toEqual([[], false, false]);
  store.dispose();
});

test('an outside edit to a clean open document reloads it locked until the user keeps or restores the file', async () => {
  const store = await started();
  await store.open('map.forest');
  put(f, FOREST, text(f, FOREST).replace('Forest acceptance world', 'Edited outside'));
  await store.refresh();
  expect([mapName(doc(store).state.model), doc(store).torn, lockReason(doc(store))]).toEqual(['Edited outside', true, 'keep the file or restore it from a backup first']);
  await store.recover('map.forest', 'keep');
  expect([doc(store).torn, lockReason(doc(store))]).toEqual([false, null]);
  store.dispose();
});

test('closing a tab journals its last edits as a draft', async () => {
  const store = await started();
  await store.open('map.forest');
  store.rename('Closed quickly');
  await store.close('map.forest');
  expect((await drafts.get(key()))?.text).toContain('Closed quickly');
  await until(async () => store.getSnapshot().docs.length === 0);
  store.dispose();
});
