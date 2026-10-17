import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { expect, test, vi } from 'vitest';
import { loadMapGeometry, loadPrefab, loadTileset, evaluate, MAP_SCHEMA, TILESET_SCHEMA, PREFAB_SCHEMA,
  validateMapGeometry, validatePrefab, type JsonValue } from '../src/contracts';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const r1 = 'docs/specifications/2026-10-17-maplab-r1/examples/forest/';
const prefab = loadPrefab(read(r1 + 'prefabs/tree.prefab.json'));
const tileset = loadTileset(read(r1 + 'tilesets/forest.tileset.json'));
if (!prefab.ok || !tileset.ok) throw new Error(JSON.stringify({ prefab, tileset }));
const context = { prefabs: [prefab.document], tilesets: [tileset.document] };
const index = JSON.parse(read('conformance/geometry/cases.json')) as { license: string; cases: { file: string; sha256: string; expect: { valid: true } | { code: string; jsonPath: string } }[] };
const loader = (text: string) => {
  const format = (JSON.parse(text) as { format: string }).format;
  return format === 'maplab.map' ? loadMapGeometry(text, context) : format === 'maplab.tileset' ? loadTileset(text) : loadPrefab(text);
};

test('ML-004 golden bytes are exhaustive, owned and pinned, including unchanged R1 examples', () => {
  expect(index.license).toBe('CC0-1.0');
  const listed = index.cases.map((c) => c.file);
  expect(new Set(listed).size).toBe(listed.length);
  const all = ['valid', 'invalid'].flatMap((dir) => readdirSync(join(root, 'conformance/geometry', dir)).map((f) => `conformance/geometry/${dir}/${f}`));
  expect(listed.filter((f) => f.startsWith('conformance/')).sort()).toEqual(all.sort());
  expect(listed.filter((f) => f.includes('/examples/'))).toHaveLength(7);
  for (const c of index.cases) expect(createHash('sha256').update(read(c.file)).digest('hex'), c.file).toBe(c.sha256);
});
test.each(index.cases.map((c) => [c.file, c] as const))('%s', (_name, c) => {
  const result = loader(read(c.file));
  if ('valid' in c.expect) expect(result.ok ? [] : result.diagnostics).toEqual([]);
  else {
    expect(result.ok).toBe(false); expect('document' in result).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => [d.code, d.jsonPath])).toEqual([[c.expect.code, c.expect.jsonPath]]);
  }
});

test('published schemas alone cover closed geometry, tilesets, prefabs and nullable kind unions', () => {
  for (const c of index.cases.filter((c) => 'valid' in c.expect)) {
    const value = JSON.parse(read(c.file)) as JsonValue;
    const format = (value as { format: string }).format;
    expect(evaluate(format === 'maplab.map' ? MAP_SCHEMA : format === 'maplab.tileset' ? TILESET_SCHEMA : PREFAB_SCHEMA, value), c.file).toEqual([]);
  }
  for (const name of ['missing-shape-id', 'legacy-shape-index', 'extra-shape-member', 'shape-kind', 'visual-scale', 'visual-rotation-quantum', 'coordinate-quantum', 'color', 'chunk-length']) {
    const c = index.cases.find((c) => c.file.includes(`/${name}.`));
    if (!c) throw new Error(name);
    const value = JSON.parse(read(c.file)) as JsonValue;
    const schema = c.file.endsWith('.prefab.json') ? PREFAB_SCHEMA : MAP_SCHEMA;
    expect(evaluate(schema, value), name).toHaveLength(1);
  }
});

test('shape order is irrelevant; art, visual transforms and trace suggestions never create physics', () => {
  const world = JSON.parse(read(r1 + 'maps/forest.map.json'));
  const before = loadMapGeometry(JSON.stringify(world), context);
  if (!before.ok) throw new Error(JSON.stringify(before.diagnostics));
  world.visuals = []; world.prefabPlacements = []; world.traversals.forEach((t: { visualId: string | null }) => { t.visualId = null; });
  world.bodies.reverse(); world.bodies.forEach((b: { shapes: object[] }) => b.shapes.reverse());
  const after = loadMapGeometry(JSON.stringify(world), context);
  expect(after.ok ? [...after.document.bodies].sort((a, b) => a.id.localeCompare(b.id)) : after.diagnostics)
    .toEqual([...before.document.bodies].sort((a, b) => a.id.localeCompare(b.id)));
  expect(after.ok ? after.document.footholds : after.diagnostics).toEqual(before.document.footholds);
  expect(before.unresolved).toEqual([]);
});

test('detached immutable output names deferred behavior and unresolved external documents', () => {
  const world = JSON.parse(read(r1 + 'maps/forest.map.json')) as JsonValue;
  const before = JSON.stringify(world); const result = validateMapGeometry(world);
  expect(JSON.stringify(world)).toBe(before);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.unresolved).toEqual(['prefab.tree', 'tileset.forest']);
  expect(result.deferred).toContain('profile support/clearance');
  expect(result.document).not.toBe(world);
  expect(Object.isFrozen(result.document.bodies[0]?.shapes)).toBe(true);
  expect(Object.isFrozen(result.document.bodies[0])).toBe(true);
  const fetch = vi.fn(() => { throw new Error('network'); }); vi.stubGlobal('fetch', fetch);
  try { expect(validateMapGeometry(world, context).ok).toBe(true); expect(fetch).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); }
});

test('terrain cells enforce tile permissions, sparse chunks and range without reading art', () => {
  const world = JSON.parse(read(r1 + 'maps/forest.map.json'));
  world.terrain[0].chunks = [{ column: -1, row: 0, cells: Array(1024).fill(null) }];
  world.terrain[0].chunks[0].cells[0] = { tileId: 'tile.grass', quarterTurns: 0, mirrorX: true, mirrorY: false };
  expect(loadMapGeometry(JSON.stringify(world), context).ok).toBe(true);
  world.terrain[0].chunks[0].cells[0].quarterTurns = 1;
  const forbidden = loadMapGeometry(JSON.stringify(world), context);
  expect(forbidden.ok ? [] : forbidden.diagnostics.map((d) => d.code)).toEqual(['cell.transform']);
  world.terrain[0].chunks[0].cells[0].quarterTurns = 0; world.terrain[0].chunks[0].column = Number.MAX_SAFE_INTEGER;
  const range = loadMapGeometry(JSON.stringify(world), context);
  expect(range.ok ? [] : range.diagnostics.map((d) => d.code)).toEqual(['cell.range']);
});

test('exact polygon predicates accept collinear continuation and reject adjacent overlap at range extremes', () => {
  const source = JSON.parse(read(r1 + 'prefabs/tree.prefab.json'));
  source.content.visuals[0].source = { kind: 'shape', fill: '#000000', shape: { kind: 'polygon', points: [[-131072,-131072],[0,-131072],[131072,-131072],[131072,131072],[-131072,131072]] } };
  expect(validatePrefab(source).ok).toBe(true);
  source.content.visuals[0].source.shape.points = [[0,0],[16,0],[8,0],[16,16],[0,16]];
  const bad = validatePrefab(source);
  expect(bad.ok ? [] : bad.diagnostics.map((d) => d.code)).toEqual(['polygon-shape.geometry']);
});

test.each(['group', 'actors', 'tile'])('visuals cannot paint into a %s layer', (kind) => {
  const world = JSON.parse(read(r1 + 'maps/clearing.map.json'));
  world.layers.push({ id: 'layer.invalid-visual', name: 'Invalid visual layer', parentId: null, order: 10,
    visible: true, opacity: 1, kind, ...(kind === 'tile' ? { occlusionFade: null } : {}) });
  world.visuals[0].layerId = 'layer.invalid-visual';
  const result = validateMapGeometry(world);
  expect(result.ok ? [] : result.diagnostics.map((d) => [d.code, d.jsonPath])).toEqual([['visual.reference', '$.visuals[0].layerId']]);
});

test('prefab provenance preserves expanded object kinds', () => {
  const world = JSON.parse(read(r1 + 'maps/forest.map.json'));
  const id = world.visuals.find((v: { id: string }) => v.id === 'pp.tree1:trunk').id;
  world.visuals = world.visuals.filter((v: { id: string }) => v.id !== id);
  world.materials.push({ ...world.materials[0], id });
  const result = validateMapGeometry(world, context);
  expect(result.ok ? [] : result.diagnostics.map((d) => d.code)).toEqual(['prefab-placement.kind']);
});

test('prefab foothold and climb plane slots bind to their expanded actor planes', () => {
  const world = JSON.parse(read(r1 + 'maps/clearing.map.json'));
  const template = JSON.parse(read(r1 + 'prefabs/tree.prefab.json'));
  template.id = 'prefab.platform'; template.layerSlots = ['plane']; template.content.visuals = [];
  template.content.materials = [{ ...world.materials[0], id: 'material' }];
  template.content.footholds = [{ ...world.footholds[0], id: 'platform', ownerBodyId: null, solidEdge: null,
    mode: 'oneWay', a: [0, 0], b: [16, 0], materialId: 'material', planeId: 'plane' }];
  template.content.traversals = [{ id: 'rope', kind: 'rope', points: [[8, 0], [8, 16]], grabRadius: 12,
    direction: 'both', access: [{ id: 'access', pathU: 0, anchor: { kind: 'world', point: [8, 0] },
      entry: 'airborne', exit: 'airborne', conditions: [] }], requiredAbilities: [], visualId: null, planeId: 'plane' }];
  const checked = validatePrefab(template);
  if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
  world.materials.push({ ...template.content.materials[0], id: 'pp.platform:material' });
  world.footholds.push({ ...template.content.footholds[0], id: 'pp.platform:platform', a: [0, -256], b: [16, -256],
    materialId: 'pp.platform:material', planeId: 'layer.actors' });
  world.traversals.push({ ...template.content.traversals[0], id: 'pp.platform:rope', points: [[8, -256], [8, -240]],
    access: [{ ...template.content.traversals[0].access[0], id: 'pp.platform:access', anchor: { kind: 'world', point: [8, -256] } }], planeId: 'layer.actors' });
  world.prefabPlacements = [{ id: 'pp.platform', prefabId: template.id, position: [0, -256], mirrorX: false,
    layerBindings: [{ slot: 'plane', layerId: 'layer.actors' }],
    expandedIds: ['pp.platform:material', 'pp.platform:platform', 'pp.platform:rope', 'pp.platform:access'] }];
  const options = { prefabs: [checked.document] };
  expect(validateMapGeometry(world, options).ok).toBe(true);
  world.footholds.at(-1).planeId = null;
  const foothold = validateMapGeometry(world, options);
  expect(foothold.ok ? [] : foothold.diagnostics.map((d) => d.code)).toEqual(['prefab-placement.plane-binding']);
  world.footholds.at(-1).planeId = 'layer.actors'; world.traversals[0].planeId = null;
  const climb = validateMapGeometry(world, options);
  expect(climb.ok ? [] : climb.diagnostics.map((d) => d.code)).toEqual(['prefab-placement.plane-binding']);
});

test('entity anchor chains resolve access positions and reject cycles and missing target anchors', () => {
  const world = JSON.parse(read(r1 + 'maps/forest.map.json'));
  world.entities.push({ id: 'entity.anchor', anchor: { kind: 'entity', entityId: 'start.player', point: [244, -144] } });
  world.traversals[0].access[0].anchor = { kind: 'entity', entityId: 'entity.anchor', point: [0, 0] };
  expect(validateMapGeometry(world, context).ok).toBe(true);
  world.traversals[0].access[0].anchor.point = [999, 999];
  const detached = validateMapGeometry(world, context);
  expect(detached.ok ? [] : detached.diagnostics.map((d) => d.code)).toEqual(['access-point.attachment']);
  world.traversals[0].access[0].anchor.point = [0, 0];
  world.entities.at(-1).anchor = { kind: 'entity', entityId: 'entity.anchor', point: [0, 0] };
  const cycle = validateMapGeometry(world, context);
  expect(cycle.ok).toBe(false);
  if (!cycle.ok) expect(cycle.diagnostics.every((d) => d.code === 'anchor.reference-cycle')).toBe(true);
  delete world.entities.at(-1).anchor;
  const missing = validateMapGeometry(world, context);
  expect(missing.ok ? [] : missing.diagnostics.map((d) => d.code)).toEqual(['anchor.unresolved']);
});

test.each(['once', 'loop', 'pingPong'])('motion initial phase respects the %s duration', (mode) => {
  const world = JSON.parse(read(r1 + 'maps/clearing.map.json'));
  world.bodies[0].mobility = 'kinematic';
  const duration = mode === 'once' ? 10 : 20;
  world.bodies[0].motion = { points: mode === 'loop' ? [[0, 0], [16, 0], [0, 0]] : [[0, 0], [16, 0]],
    legTicks: mode === 'loop' ? [10, 10] : [10], mode, initialPhaseTicks: mode === 'once' ? duration : duration - 1,
    easing: 'linear', carry: 'delta', departure: 'none', crushAction: null };
  expect(validateMapGeometry(world).ok).toBe(true);
  world.bodies[0].motion.initialPhaseTicks = mode === 'once' ? duration + 1 : duration;
  const invalid = validateMapGeometry(world);
  expect(invalid.ok ? [] : invalid.diagnostics.map((d) => d.code)).toEqual(['motion.phase']);
});

test('a separate consumer process imports only published contracts and resolves stable source edges', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maplab-geometry-consumer-'));
  try {
    mkdirSync(join(dir, 'src/contracts'), { recursive: true }); cpSync(join(root, 'schemas'), join(dir, 'schemas'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    for (const file of readdirSync(join(root, 'src/contracts')).filter((f) => f.endsWith('.ts'))) {
      const js = stripTypeScriptTypes(read(`src/contracts/${file}`))
        .replace(/(from\s+['"])(\.\/[a-z-]+)(['"])/g, '$1$2.js$3');
      writeFileSync(join(dir, 'src/contracts', file.replace(/\.ts$/, '.js')), js);
    }
    const script = `import{readFileSync}from'node:fs';import{loadMapGeometry}from'./src/contracts/index.js';
      const result=loadMapGeometry(readFileSync(${JSON.stringify(join(root, r1 + 'maps/forest.map.json'))}));
      if(!result.ok)throw Error(JSON.stringify(result.diagnostics));
      for(const f of result.document.footholds.filter(f=>f.mode==='solid')){
        const b=result.document.bodies.find(b=>b.id===f.solidEdge.bodyId);
        const s=b.shapes.find(s=>s.id===f.solidEdge.shapeId);
        const points=s.kind==='rect'?[[s.rect[0],s.rect[1]],[s.rect[0]+s.rect[2],s.rect[1]]]:[s.points[f.solidEdge.edgeIndex],s.points[f.solidEdge.edgeIndex+1]];
        if(JSON.stringify(points)!==JSON.stringify([f.a,f.b]))throw Error('Consumer edge mismatch');
      }console.log('source-edges-ok');`;
    writeFileSync(join(dir, 'consumer.mjs'), script);
    expect(execFileSync(process.execPath, [join(dir, 'consumer.mjs')], { cwd: dir, encoding: 'utf8' }).trim()).toBe('source-edges-ok');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
