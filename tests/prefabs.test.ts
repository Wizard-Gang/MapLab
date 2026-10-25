import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalize, denormalize, type MapModel } from '../src/domain/model';
import { candidate } from '../src/editor/editing';
import { applyPrefab, createPrefab, PREFAB_COLLECTIONS, type PlacementOptions } from '../src/editor/prefabs';
import { commit, openDocument, undo, redo, isDirty } from '../src/editor/history';
import { setOp, transaction } from '../src/domain/commands';
import { canonical, validateSourceGraph, type JsonValue } from '../src/contracts';
import type { PrefabDocument } from '../src/contracts/document-types';
const read = (p: string): any => JSON.parse(readFileSync(`conformance/prefabs/${p}`, 'utf8'));
const prefab = (): PrefabDocument => read('prefabs/tree-marker.prefab.json');
const placements = (): PlacementOptions[] => read('placements.json');
function model(value = read('base.map.json')): MapModel { const r = normalize(value); if (!r.ok) throw Error(JSON.stringify(r.problems)); return r.model; }
const record = (m: MapModel, c: typeof PREFAB_COLLECTIONS[number], id: string): any => m.collections.get(c)!.byId.get(id);
function all(m: MapModel, p = prefab()): JsonValue[] { return [denormalize(m), p as unknown as JsonValue, ...['catalogs/core.catalog.json', 'movement/player.movement.json', 'movement/ground.movement.json'].map(p => JSON.parse(readFileSync(`placeholder-library/${p}`, 'utf8')))]; }
function add(m: MapModel, i: number, p = prefab()): MapModel { return candidate(m, applyPrefab(m, p, placements()[i]!)); }

test('two overlapping local namespaces expand every record, nested ID and reference independently', () => {
  const p = prefab(), m = add(add(model(), 0), 1);
  const graph = validateSourceGraph(all(m)); expect(graph.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  for (const id of ['pp.a', 'pp.b']) {
    const owner = m.collections.get('prefabPlacements')!.byId.get(id)!;
    expect(new Set(owner.expandedIds as string[]).size).toBe(19);
    for (const expanded of owner.expandedIds as string[]) expect(m.owners.has(expanded)).toBe(true);
    expect(record(m, 'bodies', `${id}:body`).shapes[0].id).toBe(`${id}:shape`);
    expect(record(m, 'entities', `${id}:guardian`).groupId).toBe(`${id}:guardians`);
    expect(record(m, 'triggers', `${id}:trigger`).actions[0].params.flag.ref.id).toBe(`${id}:visited`);
    expect(record(m, 'routes', `${id}:route`).conditions[0].term.id).toBe(`${id}:visited`);
    expect(record(m, 'visuals', `${id}:trunk`).source.assetId).toBe(`${id}:image`);
    expect(record(m, 'visuals', `${id}:trunk`).layerId).toBe('layer.world');
    expect(record(m, 'footholds', `${id}:top`).planeId).toBe('layer.actors');
    expect(record(m, 'traversals', `${id}:ladder`).access[1].anchor.footholdId).toBe(`${id}:top`);
    expect(record(m, 'entities', `${id}:chest`).archetype.params.lootTable).toBe('body');
  }
  expect(record(m, 'bodies', 'pp.a:body').position).toEqual([64, 320]);
  expect(record(m, 'bodies', 'pp.b:body').position).toEqual([256, 320]);
  expect(record(m, 'entities', 'pp.b:guardian').anchor.u).toBe(0.75);
  expect(record(m, 'visuals', 'pp.b:trunk').transform.mirrorX).toBe(true);
  expect(p).toEqual(prefab());
  expect(denormalize(m)).toEqual(read('two-placements.expected.map.json'));
});
test('one command adds dependencies, records and provenance; inverse restores exact clean bytes', () => {
  const m = model(), before = canonical(denormalize(m)); let state = openDocument(m, { savedDigest: 'saved' });
  const r = commit(state, applyPrefab(m, prefab(), placements()[0]!)); if (r.outcome !== 'recorded') throw Error(r.outcome);
  state = r.state; expect(state.past).toHaveLength(1); expect(isDirty(state)).toBe(true);
  const after = canonical(denormalize(state.model)); expect(after).not.toBe(before);
  state = undo(state); expect(canonical(denormalize(state.model))).toBe(before); expect(isDirty(state)).toBe(false);
  state = redo(state); expect(canonical(denormalize(state.model))).toBe(after);
});
test('edits to one placement and later template changes do not propagate to existing placements', () => {
  const m = add(add(model(), 0), 1), savedB = canonical(record(m, 'visuals', 'pp.b:trunk'));
  const changed = candidate(m, transaction('Edit expanded name', [setOp(m, 'visuals', 'pp.a:trunk', 'name', 'Edited first instance')]));
  expect(canonical(record(changed, 'visuals', 'pp.b:trunk'))).toBe(savedB);
  const p = prefab(); (p.content.visuals as any[]).push({ ...p.content.visuals[0], id: 'new.source', order: 8 });
  (p as any).layerSlots.push('new.slot');
  expect(validateSourceGraph(all(changed, p)).ok).toBe(true);
  expect(validateSourceGraph(all(changed).filter((v: any) => v.id !== p.id)).ok).toBe(true);
});
test('selection creation follows reference closure and retains explicit layer slots without nesting', () => {
  const m = add(model(), 0), p = createPrefab(m, [{ collection: 'triggers', id: 'pp.a:trigger' }], 'prefab.captured', 'Captured marker', [64, 320]);
  expect(p.layerSlots).toEqual(['layer.actors', 'layer.world']);
  expect(p.content.flags[0]!.id).toBe('pp.a:visited');
  expect(p.content.assets[0]!.id).toBe('pp.a:image');
  expect(p.dependencies.map(d => d.kind)).not.toContain('prefab');
  expect(p.dependencies.some(d => d.id === 'movement.ground')).toBe(true);
  const graph = validateSourceGraph([...all(m).filter((v: any) => v.id !== prefab().id), p as unknown as JsonValue]); expect(graph.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  const options = { ...placements()[0]!, id: 'pp.captured', layerBindings: p.layerSlots.map(slot => ({ slot, layerId: slot })), prefabPath: 'prefabs/captured.prefab.json', position: [400, 320] as const };
  expect(record(candidate(m, applyPrefab(m, p, options)), 'bodies', 'pp.captured:pp.a:body').position).toEqual([400, 320]);
});
test('presentation bindings and art assets remap; foreign dependency identity and rig-local data remain stable', () => {
  const p = prefab() as any;
  p.dependencies.push({ id: 'foreign.rig', kind: 'riglab', path: 'presentations/foreign/manifest.json', required: false });
  p.content.presentations.push({ id: 'rig', kind: 'riglab', bundleDependencyId: 'foreign.rig', expectedExportVersion: 1, rigGroundAnchor: [3, 8], worldUnitsPerRigUnit: { num: 1, den: 1 }, nativeFacing: 'right', rootMotion: 'visualOnly', groundContact: 'supportLine', artSlots: [{ slot: 'body', assetId: 'image', pivot: [8, 16] }], actions: [{ semantic: 'idle', animation: null, fallbackSemantic: null }] });
  p.content.entities[0].presentationId = 'rig'; const m = add(add(model(), 0, p), 1, p);
  expect(validateSourceGraph(all(m, p)).ok).toBe(true);
  for (const id of ['pp.a', 'pp.b']) { const r = record(m, 'presentations', `${id}:rig`); expect(r.bundleDependencyId).toBe('foreign.rig'); expect(r.artSlots[0].assetId).toBe(`${id}:image`); expect(r.rigGroundAnchor).toEqual([3, 8]); expect(record(m, 'entities', `${id}:guardian`).presentationId).toBe(`${id}:rig`); }
});
test('placement rejects missing/duplicate/wrong plane slots, collisions, overflow, unresolved refs and recursion without mutation', () => {
  const m = model(), before = canonical(denormalize(m)), base = placements()[0]!;
  for (const change of [{ layerBindings: [] }, { layerBindings: [...base.layerBindings, base.layerBindings[0]!] }, { layerBindings: base.layerBindings.map(b => ({ ...b, layerId: 'layer.world' })) }, { id: 'layer.world' }, { id: 'p'.repeat(96) }, { position: [131072, 131072] as const }, { position: [0.01, 0] as const }]) expect(() => applyPrefab(m, prefab(), { ...base, ...change })).toThrow();
  for (const mutate of [(p: any) => p.dependencies.push({ id: p.id, kind: 'prefab', path: base.prefabPath, required: false }), (p: any) => p.content.visuals[0].source.assetId = 'missing', (p: any) => p.content.bodies[0].shapes[0].id = 'trunk']) { const p = prefab(); mutate(p); expect(() => applyPrefab(m, p, base)).toThrow(); }
  const placed = add(m, 0); expect(() => applyPrefab(placed, prefab(), base)).toThrow();
  expect(canonical(denormalize(m))).toBe(before);
});
test('shared asset file metadata conflicts and path aliases still reject; asset scale stays instance-local', () => {
  const m = add(model(), 0), p = prefab() as any;
  p.content.assets[0].wuPerAssetUnit = 2; expect(record(add(m, 1, p), 'assets', 'pp.b:image').wuPerAssetUnit).toBe(2);
  p.content.assets[0].size = [32, 16]; expect(() => add(m, 1, p)).toThrow('metadata');
  p.content.assets[0].size = [16, 16]; p.content.assets[0].path = p.content.assets[0].path.replace('assets/', 'ASSETS/'); expect(() => add(m, 1, p)).toThrow();
});
test('dependency identity conflicts refuse; required promotions and their inverses are atomic', () => {
  const source = read('base.map.json'); source.dependencies.push({ id: 'movement.ground', kind: 'movement', path: 'movement/ground.movement.json', required: false });
  const m = model(source), tx = applyPrefab(m, prefab(), placements()[0]!), state = commit(openDocument(m), tx);
  if (state.outcome !== 'recorded') throw Error(state.outcome);
  expect(state.state.model.collections.get('dependencies')!.byId.get('movement.ground')!.required).toBe(true);
  expect(denormalize(undo(state.state).model)).toEqual(source);
  source.dependencies.at(-1).path = 'movement/wrong.movement.json'; expect(() => applyPrefab(model(source), prefab(), placements()[0]!)).toThrow('Conflicting dependency');
});
test('mirror transforms polygon edges, weld endpoints, directions, conveyor and all anchor frames', () => {
  const p = prefab() as any, c = p.content;
  c.bodies[0].shapes[0] = { id: 'shape', kind: 'polygon', points: [[-16, 0], [16, 0], [16, 16], [-16, 16]] };
  c.materials[0].conveyorSu = 12; c.footholds[0].direction = 'aToB';
  c.bodies[0].shapes.push({ id: 'shape.next', kind: 'rect', rect: [16, 0, 16, 16] });
  c.footholds.push({ ...c.footholds[0], id: 'next', mode: 'solid', ownerBodyId: 'body', a: [16, 0], b: [32, 0], solidEdge: { bodyId: 'body', shapeId: 'shape.next', edgeIndex: 0 }, connections: { a: [{ footholdId: 'top', endpoint: 'b' }], b: [] } });
  c.footholds[0].connections.b = [{ footholdId: 'next', endpoint: 'a' }];
  c.entities[0].anchor = { kind: 'surface', footholdId: 'top', u: 0.25, normalOffset: 2 };
  const m = add(model(), 1, p), body = record(m, 'bodies', 'pp.b:body'), top = record(m, 'footholds', 'pp.b:top');
  expect(body.shapes[0].points).toEqual([[16, 16], [-16, 16], [-16, 0], [16, 0]]);
  expect(top.solidEdge.edgeIndex).toBe(2); expect(top.connections.a).toEqual([{ footholdId: 'pp.b:next', endpoint: 'b' }]); expect(top.direction).toBe('bToA');
  expect(record(m, 'materials', 'pp.b:earth').conveyorSu).toBe(-12);
  expect(record(m, 'waypoints', 'pp.b:wp.a').anchor.point).toEqual([264, 320]);
  expect(record(m, 'waypoints', 'pp.b:wp.b').anchor.point).toEqual([-8, 0]);
  expect(record(m, 'entities', 'pp.b:guardian').ai.guard.point).toEqual([-4, 0]);
});
test('explicit local map refs remap but external destinations and scalar IDs keep their identities', () => {
  const p = prefab() as any;
  p.content.triggers[0].actions[0].params.flag.ref.mapId = p.id;
  p.content.triggers[0].actions[0].params.id = 'visited';
  p.content.triggers[0].actions[0].params.bodyId = 'body';
  p.content.triggers[0].actions[0].params['some.assetId'] = 'image';
  p.content.triggers[0].actions[0].params.groupId = 'guardians';
  p.content.triggers[0].actions[0].params.mapId = p.id;
  p.content.entities.push({ id: 'portal', name: 'Local portal', kind: 'portal', anchor: { kind: 'world', point: [0, -32] }, enabled: true, facing: 'right', visualId: null, presentationId: null, regionId: 'area', activation: 'interact', destination: { mapId: p.id, entityId: 'guardian' }, delayTicks: 0, conditions: [] });
  const m = add(model(), 0, p), params = record(m, 'triggers', 'pp.a:trigger').actions[0].params;
  expect(params.flag.ref).toEqual({ kind: 'flag', id: 'pp.a:visited', mapId: m.id }); expect(params.id).toBe('visited'); expect(params.bodyId).toBe('body'); expect(params['some.assetId']).toBe('image'); expect(params.groupId).toBe('guardians'); expect(params.mapId).toBe(p.id);
  expect(record(m, 'entities', 'pp.a:portal').destination).toEqual({ mapId: m.id, entityId: 'pp.a:guardian' });
  p.content.entities.at(-1).destination = { mapId: 'map.other', entityId: 'guardian' };
  expect(record(add(model(), 0, p), 'entities', 'pp.a:portal').destination).toEqual({ mapId: 'map.other', entityId: 'guardian' });
});
test('typed layer-slot refs resolve separately from same-named content IDs; explicit local references validate', () => {
  const p = prefab() as any; p.layerSlots.push('body');
  p.content.triggers[0].actions.push({ key: 'fixture.layer', version: 1, params: { target: { ref: { kind: 'layer', id: 'body', mapId: p.id } } } });
  const options = { ...placements()[0]!, layerBindings: [...placements()[0]!.layerBindings, { slot: 'body', layerId: 'layer.actors' }] };
  const m = candidate(model(), applyPrefab(model(), p, options));
  expect(record(m, 'triggers', 'pp.a:trigger').actions.at(-1).params.target.ref).toEqual({ kind: 'layer', id: 'layer.actors', mapId: m.id });
  const docs = all(m, p) as any[], catalog = docs.find(d => d.id === 'catalog.core'); catalog.entries.push({ key: 'fixture.layer', version: 1, kind: 'action', stage: 'planned', fields: [{ name: 'target', type: 'ref', target: 'layer', required: true }], stateNames: [] });
  const result = validateSourceGraph(docs); expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
});
test('scalar mapId parameters cannot hide typed reference remapping or capture closure', () => {
  const p = prefab() as any; p.content.triggers[0].conditions = []; p.content.routes[0].conditions = []; p.content.encounters[0].onComplete = [];
  p.content.triggers[0].actions[0].params.mapId = 'literal-string';
  const m = add(add(model(), 0, p), 1, p), docs = all(m, p) as any[];
  docs.find(d => d.id === 'catalog.core').entries.find((e: any) => e.key === 'core.flag.set').fields.push({ name: 'mapId', type: 'string', maxLength: 96, required: false });
  expect(validateSourceGraph(docs).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  for (const id of ['pp.a', 'pp.b']) { const params = record(m, 'triggers', `${id}:trigger`).actions[0].params; expect(params.mapId).toBe('literal-string'); expect(params.flag.ref.id).toBe(`${id}:visited`); }
  const captured = createPrefab(m, [{ collection: 'triggers', id: 'pp.a:trigger' }], 'prefab.scalar', 'Scalar capture', [64, 320], docs);
  expect(captured.content.flags.map(f => f.id)).toEqual(['pp.a:visited']);
  expect(validateSourceGraph([...docs, captured as unknown as JsonValue]).ok).toBe(true);
});
test('capture resolves movement and catalogs through transitive map roots without importing map cycles', () => {
  const source = read('two-placements.expected.map.json'), bridge = read('base.map.json'); bridge.id = 'map.bridge';
  source.dependencies = [{ id: bridge.id, kind: 'map', path: 'maps/bridge.map.json', required: true }];
  bridge.dependencies.push({ id: 'movement.ground', kind: 'movement', path: 'movement/ground.movement.json', required: true }, { id: source.id, kind: 'map', path: 'maps/two-placements.map.json', required: true });
  const m = model(source), docs = [source, bridge, ...all(model()).filter((d: any) => !['map.two-placements', 'prefab.tree-marker'].includes(d.id))];
  expect(validateSourceGraph(docs).ok).toBe(true);
  const captured = createPrefab(m, [{ collection: 'triggers', id: 'pp.a:trigger' }], 'prefab.transitive', 'Transitive', [64, 320], docs);
  expect(captured.dependencies.map(d => d.id).sort()).toEqual(['catalog.core', 'movement.ground']);
  const placed = candidate(m, applyPrefab(m, captured, { ...placements()[0]!, id: 'pp.transitive', position: [400, 320], prefabPath: 'prefabs/transitive.prefab.json', layerBindings: captured.layerSlots.map(slot => ({ slot, layerId: slot })) }));
  expect(validateSourceGraph([denormalize(placed), ...docs.slice(1), captured as unknown as JsonValue]).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  // A pure caller without the source graph conservatively retains non-template roots.
  const fallback = createPrefab(m, [{ collection: 'triggers', id: 'pp.a:trigger' }], 'prefab.rooted', 'Rooted', [64, 320]);
  expect(fallback.dependencies.map(d => d.id)).toContain('map.bridge'); expect(validateSourceGraph([...docs, fallback as unknown as JsonValue]).ok).toBe(true);
});
