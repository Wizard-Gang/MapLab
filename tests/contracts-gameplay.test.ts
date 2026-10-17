import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync } from 'node:child_process';
import { expect, test, vi } from 'vitest';
import { DOCUMENT_SCHEMAS, loadSourceGraph, validateSourceGraph, validateDocumentSchema, compileSchema, evaluate,
  type JsonValue, type MapDocument, type CatalogDocument, type SourceDocument } from '../src/contracts';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p: string): string => readFileSync(join(root, p), 'utf8');
const r1 = 'docs/specifications/2026-10-17-maplab-r1/examples/forest/';
const files = ['maps/forest.map.json', 'maps/clearing.map.json', 'catalogs/core.catalog.json', 'movement/player.movement.json', 'movement/ground.movement.json', 'movement/flyer.movement.json', 'tilesets/forest.tileset.json', 'prefabs/tree.prefab.json'];
// Mutable test inputs deliberately model corrupt wire data.
const world = () => files.map((p) => JSON.parse(read(r1 + p)));
const fixture = () => { const docs = world(); docs[0] = JSON.parse(read('conformance/gameplay/all-kinds.map.json')); docs[2] = JSON.parse(read('conformance/gameplay/all-kinds.catalog.json')); return docs; };
const errors = (r: ReturnType<typeof validateSourceGraph>) => r.diagnostics.filter((d) => d.severity === 'error');
const index = JSON.parse(read('conformance/gameplay/cases.json')) as { license: string; fixtures: { file: string; sha256: string }[]; cases: { name: string; document: number; path: (string | number)[]; value: unknown; code: string }[] };

test('full source and exported R1 examples validate without rewriting any source bytes', () => {
  const source = world(), before = JSON.stringify(source), result = loadSourceGraph(files.map((f) => read(r1 + f)));
  expect(errors(result)).toEqual([]); expect(result.ok).toBe(true); expect(JSON.stringify(source)).toBe(before);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  expect(result.documents).toHaveLength(8); expect(Object.isFrozen(result.documents[0])).toBe(true);
  expect(result.diagnostics.some((d) => d.code === 'catalog.planned' && d.message.includes('configured, not simulated'))).toBe(true);
  expect(result.deferred.join(' ')).toContain('controller replay');
  const exported = files.filter((f) => !f.endsWith('.prefab.json')).map((f) => read(r1.replace('/forest/', '/forest-export/') + f));
  expect(errors(loadSourceGraph(exported))).toEqual([]);
});

test('owned fixture bytes cover every entity kind and all six closed parameter field types', () => {
  expect(index.license).toBe('CC0-1.0');
  expect(index.fixtures.map((f) => f.file.split('/').at(-1)).sort()).toEqual(readdirSync(join(root, 'conformance/gameplay')).filter((f) => f.startsWith('all-kinds.')).sort());
  for (const f of index.fixtures) expect(createHash('sha256').update(read(f.file)).digest('hex')).toBe(f.sha256);
  const docs = fixture(), result = validateSourceGraph(docs);
  expect(errors(result)).toEqual([]); expect(result.ok).toBe(true);
  expect([...new Set(docs[0].entities.map((e: { kind: string }) => e.kind))].sort()).toEqual(['playerStart', 'checkpoint', 'enemySpawn', 'npc', 'portal', 'door', 'building', 'chest', 'destructible', 'pickup', 'interactive', 'hazard', 'questMarker', 'objective', 'cutsceneMarker'].sort());
  expect(docs[2].entries.at(-1).fields.map((f: { type: string }) => f.type)).toEqual(['integer', 'number', 'string', 'boolean', 'enum', 'ref']);
});

test.each(index.cases)('$name', (c) => {
  const docs = fixture(); let target = docs[c.document];
  for (const segment of c.path.slice(0, -1)) target = target[segment];
  target[c.path.at(-1) as string | number] = structuredClone(c.value);
  const result = validateSourceGraph(docs);
  expect(result.ok).toBe(false); expect('documents' in result).toBe(false);
  expect(errors(result).map((d) => d.code)).toContain(c.code);
  expect(errors(result).every((d) => d.documentId !== null)).toBe(true);
});

test('catalog required fields, duplicate fields, ranges, quanta and entry versions fail closed', () => {
  for (const change of [
    (d: ReturnType<typeof fixture>) => { delete d[0].triggers[0].actions[2].params.count; },
    (d: ReturnType<typeof fixture>) => { d[2].entries.at(-1).fields.push(d[2].entries.at(-1).fields[0]); },
    (d: ReturnType<typeof fixture>) => { d[2].entries.at(-1).fields[1].quantum = 0; },
    (d: ReturnType<typeof fixture>) => { d[0].triggers[0].actions[2].version = 2; },
  ]) { const docs = fixture(); change(docs); expect(validateSourceGraph(docs).ok).toBe(false); }
});

test('all ObjectRef kinds bind to their actual kind, including cross-map and movement references', () => {
  const targets: Record<string, string> = { layer: 'layer.actors', visual: 'visual.ground-west', body: 'body.gate', shape: 'shape.gate', foothold: 'fh.west', traversal: 'traversal.ladder', region: 'region.boss', entity: 'spawn.boss', waypoint: 'wp.ground-a', route: 'route.ground', trigger: 'trigger.boss', encounter: 'encounter.boss', asset: 'asset.audio', movement: 'movement.player', flag: 'flag.boss-defeated', group: 'group.boss', presentation: 'fixture.presentation', material: 'mat.ground' };
  // Derive fixture object IDs, while the expected target kind remains independently explicit.
  const docs = fixture(), m = docs[0];
  Object.assign(targets, { visual: m.visuals[0].id, shape: m.bodies[0].shapes[0].id, traversal: m.traversals[0].id, waypoint: m.waypoints[0].id, trigger: m.triggers[0].id, material: m.materials[0].id });
  m.dependencies.push({ id: 'foreign.rig', kind: 'riglab', path: 'presentations/foreign/manifest.json', required: false });
  m.assets.push({ id: 'fixture.image', path: 'assets/fixture.png', mediaType: 'image/png', wuPerAssetUnit: 1, size: [1, 1] });
  m.presentations = [{ id: 'fixture.presentation', kind: 'riglab', bundleDependencyId: 'foreign.rig', expectedExportVersion: 1, rigGroundAnchor: [0, 0], worldUnitsPerRigUnit: { num: 1, den: 1 }, nativeFacing: 'right', rootMotion: 'visualOnly', groundContact: 'supportLine', artSlots: [{ slot: 'body', assetId: 'fixture.image', pivot: [0, 0] }], actions: [{ semantic: 'idle', animation: null, fallbackSemantic: null }] }];
  for (const [kind, id] of Object.entries(targets)) {
    const data = structuredClone(docs), field = data[2].entries.at(-1).fields.at(-1);
    field.target = kind; data[0].triggers[0].actions[2].params.target = { ref: { kind, id } };
    expect(errors(validateSourceGraph(data)), kind).toEqual([]);
    data[0].triggers[0].actions[2].params.target.ref.id = 'missing'; expect(validateSourceGraph(data).ok, kind).toBe(false);
  }
  const data = fixture(); data[2].entries.at(-1).fields.at(-1).target = 'entity';
  data[0].triggers[0].actions[2].params.target = { ref: { kind: 'entity', id: 'start.arrival', mapId: 'map.clearing' } };
  expect(errors(validateSourceGraph(data))).toEqual([]);
  data[0].triggers[0].actions[2].params.target.ref.mapId = 'map.unknown'; expect(validateSourceGraph(data).ok).toBe(false);
});

test('map cycles are legal; missing, undeclared, duplicate and wrong-format dependencies reject', () => {
  expect(validateSourceGraph(world()).ok).toBe(true);
  const missing = world(); missing.splice(1, 1); expect(errors(validateSourceGraph(missing)).some((d) => d.code === 'dependency.missing')).toBe(true);
  const wrong = world(); wrong[1].id = wrong[3].id; expect(validateSourceGraph(wrong).ok).toBe(false);
  const undeclared = world(); undeclared[0].dependencies = undeclared[0].dependencies.filter((d: { id: string }) => d.id !== 'map.clearing'); expect(validateSourceGraph(undeclared).ok).toBe(false);
  const catalog = world(); catalog[0].dependencies = catalog[0].dependencies.filter((d: { kind: string }) => d.kind !== 'catalog'); catalog[1].dependencies = catalog[1].dependencies.filter((d: { kind: string }) => d.kind !== 'catalog'); expect(validateSourceGraph(catalog).ok).toBe(false);
});

test('condition depth/leaf budgets and diagnostic saturation cannot hide invalid flags', () => {
  const docs = fixture(); let term: unknown = { kind: 'flag', id: 'flag.boss-defeated', equals: true };
  for (let i = 0; i < 8; i++) term = { kind: 'not', term };
  docs[0].triggers[0].conditions = [term]; expect(errors(validateSourceGraph(docs)).map((d) => d.code)).toContain('condition.depth');
  docs[0].triggers[0].conditions = [{ kind: 'all', terms: Array.from({ length: 2 }, () => ({ kind: 'all', terms: Array.from({ length: 256 }, () => ({ kind: 'ability', tag: 'jump' })) })) }];
  expect(errors(validateSourceGraph(docs)).map((d) => d.code)).toContain('condition.leaves');
  docs[0].triggers[0].conditions = [];
  docs[0].environment.effects = Array.from({ length: 256 }, () => ({ key: 'core.env.fireflies', version: 1, params: { density: 1 } }));
  docs[0].navigation.links[0].conditions = [{ kind: 'flag', id: 'missing', equals: true }];
  expect(errors(validateSourceGraph(docs)).map((d) => d.code)).toContain('reference.kind');
});

test('exactly one default start, encounter ownership, visual ownership and regions are semantic gates', () => {
  const cases = [
    (d: ReturnType<typeof fixture>) => { d[0].entities[0].default = false; },
    (d: ReturnType<typeof fixture>) => { d[0].encounters.push({ ...d[0].encounters[0], id: 'encounter.two' }); },
    (d: ReturnType<typeof fixture>) => { d[0].entities[0].visualId = d[0].visuals[0].id; d[0].entities[1].visualId = d[0].visuals[0].id; },
    (d: ReturnType<typeof fixture>) => { d[0].regions[0].shape = { kind: 'polygon', points: [[0, 0], [0, 10], [10, 10], [10, 0]] }; },
  ];
  for (const change of cases) { const docs = fixture(); change(docs); expect(validateSourceGraph(docs).ok).toBe(false); }
});

test('camera warning policy preserves visible-rectangle bounds and stable priority ties', () => {
  const docs = fixture(); docs[0].camera.defaults.bounds = [0, 0, 1, 1];
  docs[0].camera.zones.push({ ...docs[0].camera.zones[0], id: 'camera.overlap' });
  const r = validateSourceGraph(docs); expect(r.ok).toBe(true);
  expect(r.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['camera.letterbox', 'zone.priority-overlap']));
  docs[0].camera.model.version = 2; expect(validateSourceGraph(docs).ok).toBe(false);
});

test('all eight F contract sketches have closed local schemas; reserved names and versions reject', () => {
  expect([...DOCUMENT_SCHEMAS.keys()].sort()).toEqual(['maplab.map', 'maplab.tileset', 'maplab.prefab', 'maplab.movement', 'maplab.catalog', 'maplab.project', 'maplab.export', 'maplab.navigation'].sort());
  for (const name of readdirSync(join(root, 'schemas'))) {
    const text = read('schemas/' + name), data = JSON.parse(text); expect(text).toBe(JSON.stringify(data, null, 2) + '\n');
    const schema = compileSchema(data, 'fixture');
    const walk = (v: unknown): void => { if (!v || typeof v !== 'object') return; const n = v as Record<string, unknown>;
      if (n.type === 'object' && n.properties) expect(n.additionalProperties).toBe(false);
      if (n.$ref) expect(n.$ref).toMatch(/^#\/\$defs\/[a-z-]+$/);
      Object.values(n).forEach(walk);
    }; walk(data); expect(evaluate(schema, {})).not.toEqual([]);
  }
  expect(validateDocumentSchema(JSON.parse(read(r1 + 'maplab.project.json')))).toEqual([]);
  expect(validateDocumentSchema(JSON.parse(read(r1.replace('/forest/', '/forest-export/') + 'manifest.json')))).toEqual([]);
  for (const format of ['maplab.world', 'maplab.palette', 'code']) expect(validateDocumentSchema({ format, version: 1 })).not.toEqual([]);
  for (const format of DOCUMENT_SCHEMAS.keys()) expect(validateDocumentSchema({ format, version: 2 })[0]?.code).toBe('format.unsupported-version');
  const nav = { format: 'maplab.navigation', version: 1, mapId: 'map.forest', profileId: 'movement.player', identity: { sourceSha256: '0'.repeat(64), profileSha256: '1'.repeat(64), controller: { key: 'maplab.reference-controller', version: 1 }, settingsSha256: '2'.repeat(64), solvers: [] }, settings: { cellSizeWU: 256, maxFallTicks: 300, maxDurationTicks: 300, maxActionDepth: 4, maxCandidatesPerPair: 9, jumpHoldTicks: [0, 10], airControlDelays: [0], flightCellWU: 8, checkpointEveryTicks: 15 }, nodes: [], edges: [], witnesses: [] };
  expect(validateDocumentSchema(nav)).toEqual([]); nav.identity.sourceSha256 = 'bad'; expect(validateDocumentSchema(nav)).not.toEqual([]);
});

test('bounded parsing, immutable outputs and pure validation require no runtime or network', () => {
  const fetch = vi.fn(() => { throw Error('No network'); }); vi.stubGlobal('fetch', fetch);
  try {
    const docs = fixture(), before = JSON.stringify(docs), result = loadSourceGraph(docs.map((d) => JSON.stringify(d)));
    expect(result.ok).toBe(true); expect(JSON.stringify(docs)).toBe(before); expect(fetch).not.toHaveBeenCalled();
    expect(loadSourceGraph(['{"format":"maplab.map","format":"maplab.map"}']).ok).toBe(false);
    expect(validateSourceGraph([]).ok).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});

test('an independent process compiles final catalog bytes with no editor imports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maplab-catalog-consumer-'));
  try {
    mkdirSync(join(dir, 'src/contracts'), { recursive: true }); cpSync(join(root, 'schemas'), join(dir, 'schemas'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    for (const f of ['schema.ts', 'diagnostics.ts', 'json.ts']) writeFileSync(join(dir, 'src/contracts', f.replace('.ts', '.js')), stripTypeScriptTypes(read('src/contracts/' + f)).replace(/(from\s+['"])(\.\/[a-z-]+)(['"])/g, '$1$2.js$3'));
    writeFileSync(join(dir, 'consumer.mjs'), `import{readFileSync as r}from'node:fs';import{compileSchema,evaluate}from'./src/contracts/schema.js';const s=compileSchema(JSON.parse(r('./schemas/maplab.catalog.v1.schema.json')),'catalog');const d=JSON.parse(r(${JSON.stringify(join(root, 'conformance/gameplay/all-kinds.catalog.json'))}));if(evaluate(s,d).length)throw Error('catalog');d.entries[0].script='never executed';if(!evaluate(s,d).length)throw Error('open grammar');console.log('closed-catalog-ok');`);
    expect(execFileSync(process.execPath, [join(dir, 'consumer.mjs')], { cwd: dir, encoding: 'utf8' }).trim()).toBe('closed-catalog-ok');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Compile-time proofs of the consumer surface, without editor-specific types.
const consumer = (d: SourceDocument): string => d.id;
const mapConsumer = (d: MapDocument): string => d.entities.map((e) => e.kind).join(',');
const catalogConsumer = (d: CatalogDocument): number => d.entries.length;
void consumer; void mapConsumer; void catalogConsumer;

test('review regressions cover decimal quanta, every movement scope, resolved nav anchors and template namespaces', () => {
  const decimal = fixture(); decimal[2].entries.at(-1).fields[1].quantum = 0.1; decimal[0].triggers[0].actions[2].params.weight = 0.3;
  expect(errors(validateSourceGraph(decimal))).toEqual([]);
  decimal[0].triggers[0].actions[2].params.weight = 0.30000000000000004; expect(validateSourceGraph(decimal).ok).toBe(false);
  const profiles = world(), unused = JSON.parse(read('conformance/movement/valid/registered.movement.json')); unused.id = 'movement.unused';
  profiles.push(unused); expect(errors(validateSourceGraph(profiles)).map((d) => d.code)).toContain('catalog.missing');
  expect(errors(validateSourceGraph([unused])).map((d) => d.code)).toContain('catalog.missing');
  profiles[0].dependencies.push({ id: unused.id, kind: 'movement', path: 'movement/unused.movement.json', required: true });
  expect(errors(validateSourceGraph(profiles)).map((d) => d.code)).toContain('catalog.missing');
  const nav = fixture(), b = structuredClone(nav[0].bodies[0]); b.id = 'body.nav'; b.position = [131000, 0]; b.shapes = [{ id: 'shape.nav', kind: 'rect', rect: [0, 0, 1, 1] }];
  nav[0].bodies.push(b); nav[0].navigation.links[0].from = { kind: 'body', bodyId: b.id, point: [1000, 0] };
  expect(errors(validateSourceGraph(nav)).map((d) => d.code)).toContain('anchor.range');
  const template = fixture(); template[2].entries.at(-1).fields.at(-1).target = 'visual';
  template[0].triggers[0].actions[2].params.target = { ref: { kind: 'visual', id: 'trunk', mapId: 'prefab.tree' } };
  expect(errors(validateSourceGraph(template)).map((d) => d.code)).toContain('reference.kind');
  const cyclic = world(), second = structuredClone(cyclic[7]); second.id = 'prefab.second';
  second.dependencies = [{ id: 'prefab.tree', kind: 'prefab', path: 'prefabs/tree.prefab.json', required: true }];
  cyclic[7].dependencies = [{ id: second.id, kind: 'prefab', path: 'prefabs/second.prefab.json', required: true }]; cyclic.push(second);
  expect(errors(validateSourceGraph(cyclic)).map((d) => d.code)).toContain('dependency.cycle');
});

test('full graph preserves controller compatibility separately from source validity and runtime support', () => {
  const docs = world(); docs[3].controller = { key: 'not.registered', version: 99 };
  const r = validateSourceGraph(docs); expect(r.ok).toBe(true);
  if (!r.ok) throw Error(JSON.stringify(r.diagnostics));
  expect(r.runtimeImplemented).toBe(false); expect(r.canCertify).toBe(false); expect(r.contractSupported).toBe(false);
  expect(r.movement.find((p) => p.profileId === 'movement.player')?.compatibility.diagnostics.map((d) => d.code)).toContain('movement.unsupported-controller');
  expect(Object.isFrozen(r.movement[0]?.compatibility)).toBe(true);
});

test('dependency identity has one unaliased file path throughout the closure', () => {
  const docs = world(); docs[1].dependencies.find((d: { id: string }) => d.id === 'movement.player').path = 'movement/other.movement.json';
  expect(errors(validateSourceGraph(docs)).map((d) => d.code)).toContain('dependency.path-identity');
});

const documentOrders = Array.from({ length: files.length }, (_, start) => [
  ...Array.from({ length: files.length }, (_, offset) => (start + offset) % files.length),
]);
test.each(documentOrders.flatMap((order) => [order, [...order].reverse()]).map((order, i) => [i, order] as const))(
  'mixed cycle rejection is independent of document/dependency visitation order %s', (_i, order) => {
    for (const reverseDependencies of [false, true]) {
      const docs = world();
      docs[7].dependencies = [{ id: 'map.clearing', kind: 'map', path: 'maps/clearing.map.json', required: true }];
      if (reverseDependencies) docs.forEach((d) => d.dependencies?.reverse());
      const result = validateSourceGraph(order.map((i) => docs[i]));
      expect(result.ok).toBe(false);
      expect(errors(result)).toEqual([expect.objectContaining({ code: 'dependency.cycle', documentId: 'prefab.tree', jsonPath: '$.dependencies[0]' })]);
      // Without the forest→template edge the same prefab→map edge is acyclic.
      docs[0].dependencies = docs[0].dependencies.filter((d: { id: string }) => d.id !== 'prefab.tree');
      expect(errors(validateSourceGraph(order.map((i) => docs[i])))).toEqual([]);
      // Preserve the original, legal forest↔clearing map-only cycle.
      const legal = world(); if (reverseDependencies) legal.forEach((d) => d.dependencies?.reverse());
      expect(errors(validateSourceGraph(order.map((i) => legal[i])))).toEqual([]);
    }
  },
);
