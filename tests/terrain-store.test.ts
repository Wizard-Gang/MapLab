// ML-013 through the real LibraryStore and the real loopback plugin: a terrain gesture commits one entry after full
// source-graph validation, a cell the tileset forbids is refused at that boundary, and an unchanged library keeps its
// tileset identity across refreshes. tests/browser/terrain.spec.ts covers the read-only library.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { LibraryStore, type OpenDoc } from '../src/app/store';
import { memoryDrafts } from '../src/library/drafts';
import { paintCells } from '../src/editor/terrain';
import { readCell } from '../src/domain/paint';
import { cleanup, scratchLibrary, startServer, type Server } from './library-support';
import { centre, plain } from './terrain-support';

let server: Server;
const f = scratchLibrary();
const realFetch = globalThis.fetch;
beforeAll(async () => {
  server = await startServer(f.dir);
  const origin = `http://127.0.0.1:${server.port}`;
  globalThis.fetch = ((url: string, init: RequestInit = {}) => realFetch(`${origin}${url}`, { ...init, headers: { ...(init.headers as Record<string, string>), Origin: origin } })) as typeof fetch;
});
afterAll(async () => { globalThis.fetch = realFetch; await server.close(); cleanup(); });

const doc = (store: LibraryStore): OpenDoc => store.getSnapshot().docs.find((d) => d.id === 'map.forest') as OpenDoc;

test('terrain gestures commit through full validation; forbidden cells change nothing', async () => {
  const store = new LibraryStore(async () => memoryDrafts());
  await store.start();
  await store.open('map.forest');
  const tilesets = store.getSnapshot().tilesets;
  expect([...tilesets.keys()]).toEqual(['tileset.forest']);
  const terrain = store.terrain('map.forest'), m = doc(store).state.model;
  terrain.choose(plain('tile.grass'));
  terrain.tool('rect');
  expect(terrain.down(centre(m, [-3, -3]))).toBe(true);
  terrain.move(centre(m, [4, 2]));
  expect(terrain.getSnapshot().preview?.count).toBe(48);
  expect(doc(store).state.model).toBe(m);
  terrain.end();
  expect(doc(store).state.past.map((e) => e.label)).toEqual(['Paint terrain rectangle']);
  expect(store.selection('map.forest').getSnapshot().message).toBe('Paint terrain rectangle');
  expect(readCell(doc(store).state.model.terrain!.byLayer.get('layer.tiles')!.cells, -3, -3)).toEqual(plain('tile.grass'));
  // Bypassing the palette: the store's command boundary refuses with the validator's diagnostic.
  const after = doc(store).state;
  expect(store.edit('map.forest', paintCells(after.model, 'layer.tiles', [[0, 5]], { tileId: 'tile.grass', quarterTurns: 2, mirrorX: false, mirrorY: false }, 'forced'))).toBe(false);
  expect(store.selection('map.forest').getSnapshot().message).toContain('Tile transform is forbidden');
  expect(doc(store).state).toBe(after);
  // A refresh with unchanged tilesets keeps their identity, so scenes are not rebuilt for nothing.
  await store.refresh();
  expect(store.getSnapshot().tilesets).toBe(tilesets);
  store.dispose();
});
