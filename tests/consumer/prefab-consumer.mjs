// Independent final-byte proof. This program uses only Node and the separate bundle reader.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBundle } from './reader/read-bundle.mjs';
export function consumePrefabs(dir, schemas) {
  const read = readBundle(dir, schemas); assert.equal(read.ok, true, JSON.stringify(read.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json')));
  assert.equal(manifest.files.some(f => f.path.includes('prefab')), false, 'Expanded bundle excludes templates');
  const map = JSON.parse(readFileSync(join(dir, 'maps/two-placements.map.json')));
  const collections = ['assets', 'presentations', 'flags', 'visuals', 'materials', 'bodies', 'footholds', 'traversals', 'regions', 'entities', 'waypoints', 'routes', 'triggers', 'encounters'];
  const lookup = (c, id) => { const v = map[c].find(v => v.id === id); assert.ok(v, `Missing ${id}`); return v; };
  const ids = new Map();
  for (const c of collections) for (const r of map[c]) {
    assert.equal(ids.has(r.id), false); ids.set(r.id, c);
    for (const child of [...(c === 'bodies' ? r.shapes : []), ...(c === 'traversals' ? r.access ?? [] : [])]) { assert.equal(ids.has(child.id), false); ids.set(child.id, c); }
  }
  const placements = [];
  for (const [id, x, mirror] of [['pp.a', 64, false], ['pp.b', 256, true]]) {
    const p = lookup('prefabPlacements', id), key = v => `${id}:${v}`;
    assert.equal(p.prefabId, 'prefab.tree-marker'); assert.deepEqual(p.position, [x, 320]); assert.equal(p.mirrorX, mirror);
    assert.equal(p.expandedIds.length, 19); assert.equal(new Set(p.expandedIds).size, 19);
    const expected = [...ids.keys()].filter(v => v.startsWith(`${id}:`)).sort(); assert.deepEqual([...p.expandedIds].sort(), expected);
    for (const r of p.layerBindings) assert.equal(r.layerId, r.slot === 'actors' ? 'layer.actors' : 'layer.world');
    const body = lookup('bodies', key('body')), top = lookup('footholds', key('top')), ladder = lookup('traversals', key('ladder'));
    assert.deepEqual(body.position, [x, 320]); assert.equal(body.shapes[0].id, key('shape')); assert.deepEqual(body.shapes[0].rect, [-16, 0, 32, 16]);
    assert.deepEqual(top.solidEdge, { bodyId: key('body'), shapeId: key('shape'), edgeIndex: 0 }); assert.equal(top.planeId, 'layer.actors');
    const floor = [top.a[0] + body.position[0], top.a[1] + body.position[1], top.b[0] + body.position[0], top.b[1] + body.position[1]];
    assert.deepEqual(floor, [x - 16, 320, x + 16, 320]);
    assert.deepEqual(ladder.points, [[x, 256], [x, 320]]); assert.ok(ladder.access.find(a => a.id === key('access.top'))); assert.equal(ladder.access.find(a => a.id === key('access.bottom')).anchor.footholdId, key('top'));
    const visual = lookup('visuals', key('trunk')), asset = lookup('assets', key('image')), entity = lookup('entities', key('guardian'));
    assert.equal(visual.layerId, 'layer.world'); assert.equal(visual.source.assetId, asset.id); assert.equal(asset.path, 'assets/22347f62eb64/22347f62eb6490be9371fe3d9f92a98684bbdef8e2b2f0bba1d096580419d3a1.svg'); assert.equal(visual.transform.mirrorX, mirror);
    assert.equal(lookup('visuals', key('canopy')).parentId, visual.id); assert.equal(entity.visualId, visual.id); assert.equal(entity.groupId, key('guardians'));
    assert.equal(entity.anchor.footholdId, top.id); assert.equal(entity.anchor.u, mirror ? 0.75 : 0.25); assert.equal(entity.ai.routeId, key('route'));
    assert.deepEqual(lookup('routes', key('route')).waypointIds, [key('wp.a'), key('wp.b')]);
    assert.equal(lookup('routes', key('route')).conditions[0].term.id, key('visited'));
    const trigger = lookup('triggers', key('trigger')), encounter = lookup('encounters', key('encounter'));
    assert.equal(trigger.conditions[0].id, key('visited')); assert.equal(trigger.actions[0].params.flag.ref.id, key('visited'));
    assert.equal(trigger.actions[1].params.target.ref.id, encounter.id); assert.equal(trigger.actions[2].params.target.ref.id, body.id);
    assert.deepEqual(encounter.spawnIds, [entity.id]); assert.equal(encounter.onComplete[0].params.flag.ref.id, key('visited'));
    assert.equal(lookup('entities', key('chest')).archetype.params.lootTable, 'body');
    placements.push({ id, floor, ladder: ladder.points, flag: key('visited'), expanded: expected.length });
  }
  assert.deepEqual(map.dependencies.map(d => d.id).sort(), ['catalog.core', 'movement.ground', 'movement.player', 'prefab.tree-marker']);
  assert.deepEqual(manifest.documents.map(d => d.id).sort(), ['catalog.core', 'map.two-placements', 'movement.ground', 'movement.player']);
  return { verified: true, placements, assetFiles: manifest.files.filter(f => f.role === 'asset').map(f => f.path) };
}
if (process.argv[1]?.endsWith('prefab-consumer.mjs')) console.log(JSON.stringify(consumePrefabs(process.argv[2], process.argv[3])));
