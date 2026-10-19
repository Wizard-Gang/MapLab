// ML-008: the normalized map model is lossless, immutable and refuses duplicate persistent IDs.
import { describe, expect, test } from 'vitest';
import { canonical, type JsonValue } from '../src/contracts';
import { encode, normalize, type JsonObject } from '../src/domain/model';
import { CHUNK_CELLS, PaintBuffer, chunkKey, locate, readCell, storeFromChunks, storeToChunks } from '../src/domain/paint';
import { R1_MAPS, cell, forestDocument, modelOf, readDocument } from './history-support';

const edited = (edit: (doc: Record<string, any>) => void): JsonValue => { const doc = forestDocument() as Record<string, any>; edit(doc); return doc as JsonValue; };
const problems = (doc: JsonValue) => { const r = normalize(doc); return r.ok ? [] : r.problems.map(({ code, path }) => ({ code, path })); };

describe('normalize/denormalize', () => {
  test.each(['forest', 'clearing'])('the R1 %s source map round-trips to identical canonical bytes', (name) => {
    const doc = readDocument(`${R1_MAPS}/${name}.map.json`);
    expect(encode(modelOf(doc))).toBe(canonical(doc));
  });

  test('records are keyed by persistent ID with their source order, and the namespace includes nested IDs', () => {
    const m = modelOf(forestDocument());
    expect(m.collections.get('entities')?.order[0]).toBe('start.player');
    expect(m.collections.get('bodies')?.byId.get('body.west')?.name).toBe('West solid ground');
    expect(m.owners.get('body.west')).toBe('bodies');
    expect(m.owners.get('shape.west')).toBe('bodies/body.west');
    expect(m.owners.has('map.clearing')).toBe(false);
    expect(m.terrain?.order).toEqual(['layer.tiles']);
  });

  test('the model is deeply frozen and normalizing never writes its input', () => {
    const doc = forestDocument() as Record<string, any>;
    const before = canonical(doc as JsonValue);
    const m = modelOf(doc as JsonValue);
    expect(Object.isFrozen(doc)).toBe(false);
    expect(canonical(doc as JsonValue)).toBe(before);
    const body = m.collections.get('bodies')?.byId.get('body.west') as JsonObject;
    expect(Object.isFrozen(body) && Object.isFrozen(body.shapes) && Object.isFrozen((body.shapes as JsonObject[])[0])).toBe(true);
    expect(Object.isFrozen(m.fields.get('camera'))).toBe(true);
  });

  test('an absent collection stays absent', () => {
    const doc = edited((d) => { delete d.prefabPlacements; });
    const m = modelOf(doc);
    expect(m.collections.has('prefabPlacements')).toBe(false);
    expect(encode(m)).toBe(canonical(doc));
  });
});

describe('duplicate persistent IDs', () => {
  test('across top-level collections', () => {
    expect(problems(edited((d) => { d.flags[0].id = 'region.pit'; }))).toEqual([{ code: 'model.duplicate-id', path: '$.flags[0].id' }]);
  });
  test('between nested shapes, and between a record and an earlier nested shape', () => {
    expect(problems(edited((d) => { d.bodies[1].shapes[0].id = 'shape.west'; }))).toEqual([{ code: 'model.duplicate-id', path: '$.bodies[1].shapes[0].id' }]);
    expect(problems(edited((d) => { d.footholds[0].id = 'shape.west'; }))).toEqual([{ code: 'model.duplicate-id', path: '$.footholds[0].id' }]);
  });
  test('in a document member such as camera zones', () => {
    expect(problems(edited((d) => { d.camera.zones[0].id = 'body.gate'; }))).toEqual([{ code: 'model.duplicate-id', path: '$.camera.zones[0].id' }]);
  });
  test('within dependencies, which are a separate document namespace', () => {
    expect(problems(edited((d) => { d.dependencies.push({ ...d.dependencies[0] }); }))).toEqual([{ code: 'model.duplicate-dependency', path: '$.dependencies[7].id' }]);
    expect(problems(edited((d) => { d.flags[0].id = 'catalog.core'; }))).toEqual([]);
  });
  test('invalid IDs, repeated chunks and the wrong format', () => {
    expect(problems(edited((d) => { d.flags[0].id = 'Flag!'; }))).toEqual([{ code: 'model.id', path: '$.flags[0].id' }]);
    const chunk = { column: -1, row: 0, cells: Array.from({ length: CHUNK_CELLS }, (_, i) => (i === 0 ? cell('tile.grass') : null)) };
    expect(problems(edited((d) => { d.terrain[0].chunks = [chunk, chunk]; }))).toEqual([{ code: 'model.chunk', path: '$.terrain[0].chunks[1]' }]);
    expect(problems(edited((d) => { d.format = 'maplab.tileset'; }))).toEqual([{ code: 'model.format', path: '$' }]);
  });
});

describe('packed sparse chunks', () => {
  test('signed cell coordinates locate by floor division', () => {
    expect(locate(-1, -1)).toEqual({ column: -1, row: -1, index: 1023 });
    expect(locate(-32, 31)).toEqual({ column: -1, row: 0, index: 31 * 32 });
    expect(locate(32, 0)).toEqual({ column: 1, row: 0, index: 0 });
  });

  test('transforms and negative chunks round-trip; an emptied chunk is omitted but keeps its position', () => {
    const chunks = [
      { column: -3, row: -2, cells: Array.from({ length: CHUNK_CELLS }, (_, i) => (i % 7 === 0 ? cell('tile.dirt', (i % 4) as 0 | 1 | 2 | 3, i % 2 === 0, i % 3 === 0) : null)) },
      { column: 4, row: -1, cells: Array.from({ length: CHUNK_CELLS }, (_, i) => (i === 5 ? cell('tile.slope.up') : null)) },
    ];
    const store = storeFromChunks(chunks);
    expect(storeToChunks(store)).toEqual(chunks);
    expect(readCell(store, -3 * 32 + 7, -2 * 32)).toEqual(cell('tile.dirt', 3, false, false));
    const erase = new PaintBuffer(store);
    erase.write({ column: 4 * 32 + 5, row: -32, cell: null });
    const erased = erase.view();
    expect(storeToChunks(erased)).toEqual([chunks[0]]);
    expect(erased.order).toEqual([chunkKey(-3, -2), chunkKey(4, -1)]);
    expect(storeToChunks(store)).toEqual(chunks);
  });

  test('a painted forest map re-normalizes from its own output', () => {
    const m = modelOf(forestDocument());
    const buffer = new PaintBuffer(m.terrain?.byLayer.get('layer.tiles')?.cells as never);
    for (let c = -40; c < 40; c++) buffer.write({ column: c, row: -c, cell: cell('tile.grass') });
    const layer = m.terrain?.byLayer.get('layer.tiles');
    const painted = { ...m, terrain: { order: ['layer.tiles'], byLayer: new Map([['layer.tiles', { ...layer!, cells: buffer.view() }]]) } };
    const out = JSON.parse(encode(painted)) as JsonValue;
    expect(encode(modelOf(out))).toBe(encode(painted));
    expect((out as any).terrain[0].chunks).toHaveLength(7);
  });
});
