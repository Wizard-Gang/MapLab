// ML-009: library form (adopted F5, R1 F4), the layout rules and the draft journal's keys.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { canonical, loadSourceGraph, type JsonValue } from '../src/contracts';
import { draftKey, libraryKey, memoryDrafts } from '../src/library/drafts';
import { checkIndex, documentPath, layoutProblem } from '../src/library/layout';
import { libraryForm, libraryValue } from '../src/library/library-form';
import { placeholderDir, repoRoot } from './library-support';

const index = JSON.parse(readFileSync(join(placeholderDir, 'maplab.project.json'), 'utf8')) as { documents: { id: string; path: string }[] };
const source = (path: string): JsonValue => JSON.parse(readFileSync(join(placeholderDir, path), 'utf8'));
type Obj = Record<string, JsonValue>;

describe('library form', () => {
  test.each(index.documents.map((d) => d.path))('%s rewrites to deterministic, idempotent library form that still validates', (path) => {
    const t = libraryForm(source(path));
    expect(libraryForm(JSON.parse(t))).toBe(t);
    expect(t.endsWith('}\n') && !t.includes('\r') && !t.endsWith('\n\n')).toBe(true);
    expect(Object.keys(JSON.parse(t)).slice(0, 3)).toEqual(['format', 'version', 'id']);
    expect(t.split('\n')[1]).toBe('  "format": "maplab.' + (JSON.parse(t) as Obj).format?.toString().slice(7) + '",');
  });

  test('the rewritten forest library validates as a whole and keeps every value', () => {
    const texts = index.documents.map((d) => libraryForm(source(d.path)));
    expect(loadSourceGraph(texts).ok).toBe(true);
    const sortAll = (v: JsonValue): JsonValue => (Array.isArray(v) ? v.map(sortAll).sort((a, b) => (canonical(a) < canonical(b) ? -1 : 1)) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sortAll(x)])) : v);
    for (const d of index.documents) expect(canonical(sortAll(JSON.parse(libraryForm(source(d.path)))))).toBe(canonical(sortAll(source(d.path))));
    expect(libraryForm(source('maplab.project.json'))).toBe(readFileSync(join(placeholderDir, 'maplab.project.json'), 'utf8'));
  });

  test('keys follow the schema properties order, including the oneOf branch a value belongs to; unknown keys sort last', () => {
    const forest = libraryValue(source('maps/forest.map.json')) as Obj;
    const schema = JSON.parse(readFileSync(join(repoRoot, 'schemas/maplab.map.v1.schema.json'), 'utf8')) as Obj & { properties: Obj; $defs: Record<string, { properties: Obj }> };
    expect(Object.keys(forest)).toEqual(Object.keys(schema.properties));
    const shape = (forest.bodies as Obj[]).flatMap((b) => b.shapes as Obj[]).find((s) => s.kind === 'rect') as Obj;
    expect(Object.keys(shape)).toEqual(Object.keys(schema.$defs['rect-shape']?.properties ?? {}));
    const odd = libraryValue({ ...(source('maps/clearing.map.json') as Obj), metadata: { zeta: 1, tags: [], license: 'CC0-1.0', authors: [], description: '', name: 'n', alpha: 2 } }) as Obj;
    expect(Object.keys(odd.metadata as Obj)).toEqual(['name', 'description', 'authors', 'license', 'tags', 'alpha', 'zeta']);
  });

  test('domain order sorts set-like collections and string sets but preserves sequences', () => {
    const clearing = source('maps/clearing.map.json') as Obj;
    const shuffled = {
      ...clearing,
      entities: [...(clearing.entities as Obj[])].reverse(),
      layers: [...(clearing.layers as Obj[])].reverse(),
      materials: [{ ...(clearing.materials as Obj[])[0], tags: ['z', 'a', 'm'] }],
      triggers: [{ id: 't', actions: [{ key: 'b' }, { key: 'a' }], kind: 'x' }],
      bounds: [0, 0, 640, 640],
    } as Obj;
    const out = libraryValue(shuffled) as Obj;
    expect((out.entities as Obj[]).map((e) => e.id)).toEqual(['portal.forest', 'start.arrival']);
    expect((out.layers as Obj[]).map((l) => l.order)).toEqual([0, 1, 2]);
    expect((out.materials as Obj[])[0]?.tags).toEqual(['a', 'm', 'z']);
    expect(((out.triggers as Obj[])[0]?.actions as Obj[]).map((a) => a.key)).toEqual(['b', 'a']);
    expect(out.bounds).toEqual([0, 0, 640, 640]);
  });

  test('a member named __proto__ stays an own member; unknown formats are refused', () => {
    const value = JSON.parse('{"format":"maplab.catalog","version":1,"id":"c","entries":[],"__proto__":{"x":1}}') as JsonValue;
    expect(Object.hasOwn(libraryValue(value) as object, '__proto__')).toBe(true);
    expect(libraryForm(value)).toContain('"__proto__": {');
    expect(() => libraryForm({ format: 'maplab.export' })).toThrow(RangeError);
    expect(() => libraryForm([])).toThrow(RangeError);
  });
});

describe('layout', () => {
  test('documents live directly in their kind folder with their kind extension', () => {
    expect([documentPath('map', 'map.meadow'), documentPath('map', 'meadow'), documentPath('tileset', 'tileset.x'), documentPath('map', 'map:x'), documentPath('map', 'Map')])
      .toEqual(['maps/meadow.map.json', 'maps/meadow.map.json', 'tilesets/x.tileset.json', null, null]);
    expect([layoutProblem('map', 'maps/a.map.json'), layoutProblem('map', 'movement/a.map.json'), layoutProblem('map', 'maps/x/a.map.json'), layoutProblem('map', '../a.map.json'), layoutProblem('map', 'maps/.map.json')])
      .toEqual([null, expect.stringContaining('maps/'), expect.stringContaining('maps/'), expect.stringContaining('unsafe'), expect.stringContaining('unsafe')]);
  });
  test('an index with a repeated ID, an aliasing path or a misplaced document is refused', () => {
    const base = source('maplab.project.json') as Obj & { documents: Obj[] };
    const docs = base.documents;
    const bad = (documents: Obj[]): string[] => { const r = checkIndex({ ...base, documents } as JsonValue); return r.ok ? [] : r.diagnostics.map((d) => d.code); };
    expect(bad(docs)).toEqual([]);
    expect(bad([...docs, docs[0] as Obj])).toContain('library.duplicate-id');
    expect(bad([...docs, { ...(docs[1] as Obj), id: 'map.other', path: 'maps/Clearing.map.json' }])).toContain('library.path-alias');
    expect(bad([...docs, { ...(docs[1] as Obj), id: 'map.other', path: 'tilesets/other.map.json' }])).toContain('library.layout');
    expect(checkIndex({ ...base, format: 'maplab.map' } as JsonValue).ok).toBe(false);
  });
});

describe('drafts', () => {
  test('keys separate libraries and documents, and the journal round-trips drafts', async () => {
    expect(libraryKey('~/Documents/MapLab', 'p')).not.toBe(libraryKey('/tmp/copy', 'p'));
    const store = memoryDrafts();
    const lib = libraryKey('L', 'p');
    const draft = { key: draftKey(lib, 'map.a'), libraryId: lib, documentId: 'map.a', path: 'maps/a.map.json', baseDigest: null, text: '{}\n', updatedAt: '2026-10-18T00:00:00.000Z' };
    await store.put(draft);
    await store.put({ ...draft, key: draftKey(libraryKey('M', 'p'), 'map.a'), libraryId: libraryKey('M', 'p') });
    expect(await store.get(draft.key)).toEqual(draft);
    expect((await store.list(lib)).map((d) => d.documentId)).toEqual(['map.a']);
    await store.delete(draft.key);
    expect([await store.get(draft.key), store.size]).toEqual([null, 1]);
  });
});
