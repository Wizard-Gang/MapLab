// G1 step 4 references: every reference in a bundled map, in each movement profile inside that map's
// dependency closure, and in tilesets resolves to its expected kind inside the referencing map's closure.
// Catalog entries are checked for existence only; handler kinds and parameter semantics are not.
import { ASSET_TYPES, pathProblem } from './bundle.mjs';
import { CONTRACT_MEMBERS, closureOf, dependencyEdges, isContractRef, isObject, pathOf, scan } from './references.mjs';

const OBJECT_KINDS = new Set(['layer', 'visual', 'body', 'shape', 'foothold', 'traversal', 'region', 'entity', 'waypoint', 'route',
  'trigger', 'encounter', 'asset', 'movement', 'flag', 'group', 'presentation', 'material']);
/** `{key, version}` members naming catalog entries; `solver` declares a capability the editor reports as unsupported. */
const CATALOG_MEMBERS = new Set(['event', 'waves', 'completionEvent', 'shakeEffects', 'action', 'allowed']);
const SOLVER_MEMBERS = new Set(['solver']);
const COLLECTIONS = { assets: 'asset', presentations: 'presentation', layers: 'layer', visuals: 'visual', materials: 'material', bodies: 'body',
  footholds: 'foothold', traversals: 'traversal', regions: 'region', entities: 'entity', waypoints: 'waypoint', routes: 'route',
  triggers: 'trigger', encounters: 'encounter', flags: 'flag', prefabPlacements: 'prefab-placement' };
const NESTED = { 'camera.zones': 'camera-zone', 'environment.zones': 'environment-zone', 'navigation.modeVolumes': 'nav-volume',
  'navigation.links': 'nav-link', 'navigation.overrides': 'nav-override' };
/** Every `*Id`/`*Ids` member the published v1 schemas define outside typed refs. Anything else fails closed. */
const FIELDS = {
  footholdId: 'foothold', bodyId: 'body', ownerBodyId: 'body', bodyIds: 'body', entityId: 'entity', spawnIds: 'entity',
  assetId: 'asset', assetIds: 'asset', trackAssetId: 'asset', layerId: 'layer', planeId: 'layer', materialId: 'material',
  shapeId: 'shape', visualId: 'visual', regionId: 'region', approachRegionId: 'region', patrolRegionId: 'region',
  pursuitRegionId: 'region', leashRegionId: 'region', aggroRegionId: 'region', waypointIds: 'waypoint', routeId: 'route',
  presentationId: 'presentation', expandedIds: 'any', movementId: 'doc:movement', profileIds: 'doc:movement',
  tilesetId: 'decl:tileset', mapId: 'doc:map', prefabId: 'dep:prefab', bundleDependencyId: 'dep:riglab',
  tileId: 'tile', fallbackTileId: 'tile', outputTileIds: 'tile', terrainId: 'terrain',
  parentId: 'parent', groupId: 'implicit', dropGroupId: 'implicit', suggestedMaterialId: 'advisory',
};
const TILESET_KINDS = new Set(['asset', 'tile', 'terrain', 'advisory']);
const isObjectRef = (v) => typeof v.kind === 'string' && typeof v.id === 'string' && Object.keys(v).every((k) => k === 'kind' || k === 'id' || k === 'mapId') && OBJECT_KINDS.has(v.kind);
const isCall = (v) => typeof v.key === 'string' && Number.isInteger(v.version) && isObject(v.params) && Object.keys(v).length === 3;
const isDestination = (v) => Object.keys(v).sort().join() === 'entityId,mapId';

function namespace(value, report, file) {
  const ids = new Map();
  const add = (id, kind, at) => { if (ids.has(id)) report('object.duplicate', file, at, `Duplicate object ID ${id}`); else ids.set(id, kind); };
  for (const [collection, kind] of Object.entries(COLLECTIONS)) (value[collection] ?? []).forEach((o, i) => add(o.id, kind, `$.${collection}[${i}].id`));
  for (const [dotted, kind] of Object.entries(NESTED)) {
    const [a, b] = dotted.split('.');
    (value[a]?.[b] ?? []).forEach((o, i) => add(o.id, kind, `$.${dotted}[${i}].id`));
  }
  (value.bodies ?? []).forEach((body, i) => body.shapes.forEach((s, j) => add(s.id, 'shape', `$.bodies[${i}].shapes[${j}].id`)));
  (value.traversals ?? []).forEach((t, i) => (t.access ?? []).forEach((a, j) => add(a.id, 'access', `$.traversals[${i}].access[${j}].id`)));
  // Group-kind layers are `group` targets too, and an entity or encounter group may share one's ID (ML-006).
  const groupLayers = new Set((value.layers ?? []).filter((l) => l.kind === 'group').map((l) => l.id));
  const groups = new Set(groupLayers);
  for (const c of ['entities', 'encounters']) (value[c] ?? []).forEach((o, i) => {
    if (typeof o.groupId !== 'string') return;
    if (ids.has(o.groupId) && !groupLayers.has(o.groupId)) report('object.duplicate', file, `$.${c}[${i}].groupId`, `Group ${o.groupId} collides with an object ID`);
    groups.add(o.groupId);
  });
  return { ids, groups };
}

/** Resolves references in every bundled map, the movement documents in each map's closure, and tilesets. Returns resolved portals. */
export function checkReferences(manifest, docs, diagnostics) {
  const seen = new Set();
  const report = (code, file, path, message) => {
    const key = `${code}\u0000${file}\u0000${path}`;
    if (!seen.has(key)) { seen.add(key); diagnostics.push({ code, file, path, message }); }
  };
  const edges = dependencyEdges(docs);
  const scopes = new Map();
  for (const [id, { entry, value }] of docs) {
    if (value.format !== 'maplab.map') continue;
    const closure = closureOf(edges, id);
    const catalogs = new Set([...closure].filter((d) => docs.get(d).value.format === 'maplab.catalog').flatMap((d) => docs.get(d).value.entries.map((e) => `${e.key}@${e.version}`)));
    scopes.set(id, { id, value, closure, catalogs, ...namespace(value, report, entry.path) });
  }
  const tilesetIndex = (t) => ({ tile: new Set(t.tiles.map((x) => x.id)), terrain: new Set(t.terrains.map((x) => x.id)), asset: new Set((t.assets ?? []).map((x) => x.id)) });
  const assetFiles = new Set(manifest.files.filter((f) => f.role === 'asset').map((f) => f.path));
  const portals = [];

  const walk = (value, file, mode, scope) => {
    const fail = (at, message, code = 'reference.dangling') => report(code, file, pathOf(at), message);
    const within = (s, id, at) => { if (s.closure.has(id)) return true; fail(at, `${id} is outside the dependency closure of ${s.id}`, 'reference.undeclared'); return false; };
    const mapScope = (mapId, at) => {
      if (mapId === undefined || mapId === scope.id) return scope;
      if (!scopes.has(mapId)) { fail(at, `Unknown map ${mapId}`); return null; }
      return within(scope, mapId, at) ? scopes.get(mapId) : null;
    };
    const docRef = (s, id, format, at) => { if (docs.get(id)?.value.format !== format) fail(at, `${id} is not a bundled ${format} document`); else within(s, id, at); };
    const catalogRef = (r, at) => { if (!scope.catalogs.has(`${r.key}@${r.version}`)) fail(at, `${r.key}@${r.version} is not declared by a catalog in the closure of ${scope.id}`, 'catalog.missing'); };
    const kindRef = (s, kind, id, at) => {
      const found = s.ids.get(id);
      if (found === undefined) fail(at, `Unknown ${kind} ${id}`);
      else if (found !== kind) fail(at, `${id} is a ${found}, expected ${kind}`, 'reference.kind');
    };
    const objectRef = (r, at) => {
      const s = mapScope(r.mapId, [...at, 'mapId']);
      if (!s) return;
      if (r.kind === 'movement') docRef(s, r.id, 'maplab.movement', [...at, 'id']);
      else if (r.kind === 'group') { if (!s.groups.has(r.id)) fail([...at, 'id'], `Unknown group ${r.id} in ${s.id}`); }
      else kindRef(s, r.kind, r.id, [...at, 'id']);
    };
    const field = (kind, id, at, ctx) => {
      if (mode === 'tileset' && !TILESET_KINDS.has(kind)) { fail(at, `Unclassified tileset reference ${kind}`, 'reference.unclassified'); return; }
      if (kind === 'implicit' || kind === 'advisory') return;
      if (kind === 'tile' || kind === 'terrain' || (mode === 'tileset' && kind === 'asset')) { if (!ctx.tileset?.[kind].has(id)) fail(at, `Unknown tileset ${kind} ${id}`); return; }
      if (kind === 'any') { if (!scope.ids.has(id)) fail(at, `Unknown object ${id}`); return; }
      if (kind.startsWith('doc:')) { docRef(scope, id, `maplab.${kind.slice(4)}`, at); return; }
      // Terrain names its tileset directly (ML-004): transitive reachability is not enough.
      if (kind === 'decl:tileset') {
        if (docs.get(id)?.value.format !== 'maplab.tileset') fail(at, `${id} is not a bundled maplab.tileset document`);
        else if (!scope.value.dependencies.some((d) => d.id === id && d.kind === 'tileset')) fail(at, `Tileset ${id} is not a declared dependency of ${scope.id}`, 'reference.undeclared');
        return;
      }
      if (kind.startsWith('dep:')) { if (!(scope.value.dependencies ?? []).some((d) => d.id === id && d.kind === kind.slice(4))) fail(at, `${id} is not a declared ${kind.slice(4)} dependency`); return; }
      if (kind === 'parent') kind = ctx.collection === 'layers' ? 'layer' : ctx.collection === 'visuals' ? 'visual' : null;
      if (kind === null) { fail(at, 'Unclassified parent reference', 'reference.unclassified'); return; }
      kindRef(scope, kind, id, at);
    };
    scan(value, (v, at, name, ctx) => {
      if (typeof v.tilesetId === 'string' && docs.get(v.tilesetId)?.value.format === 'maplab.tileset') ctx = { ...ctx, tileset: tilesetIndex(docs.get(v.tilesetId).value) };
      if (mode !== 'tileset' && isObjectRef(v)) { objectRef(v, at); return false; }
      if (mode !== 'tileset' && isCall(v)) {
        catalogRef(v, at);
        // Params are closed scalar values or `{ref}` typed references, never further reference members.
        for (const [p, pv] of Object.entries(v.params)) if (isObject(pv) && isObject(pv.ref) && isObjectRef(pv.ref)) objectRef(pv.ref, [...at, 'params', p, 'ref']);
        return false;
      }
      if (isContractRef(v)) {
        if (CATALOG_MEMBERS.has(name)) catalogRef(v, at);
        else if (!CONTRACT_MEMBERS.has(name) && !SOLVER_MEMBERS.has(name)) fail(at, `Unclassified contract reference ${name}`, 'reference.unclassified');
        return false;
      }
      if (mode === 'map' && v.kind === 'flag' && typeof v.id === 'string' && 'equals' in v) kindRef(scope, 'flag', v.id, [...at, 'id']);
      if (mode === 'map' && isDestination(v)) {
        const target = v.mapId === scope.id ? scope : scopes.get(v.mapId);
        if (!target) fail([...at, 'mapId'], `Portal destination map ${v.mapId} is not in the bundle`, 'portal.map');
        else if (target !== scope && !within(scope, v.mapId, [...at, 'mapId'])) return false;
        else if (!target.value.entities.some((e) => e.id === v.entityId)) fail([...at, 'entityId'], `Destination entity ${v.entityId} is not in ${v.mapId}`, 'portal.entity');
        else portals.push({ from: scope.id, path: pathOf(at), to: { mapId: v.mapId, entityId: v.entityId } });
        return false;
      }
      if (mode === 'map' && typeof v.bodyId === 'string' && typeof v.shapeId === 'string' && scope.ids.get(v.bodyId) === 'body'
        && !scope.value.bodies.find((b) => b.id === v.bodyId).shapes.some((s) => s.id === v.shapeId)) {
        fail([...at, 'shapeId'], `${v.shapeId} is not a shape of ${v.bodyId}`, 'reference.owner');
      }
      for (const [k, x] of Object.entries(v)) {
        if (!/(?:Id|Ids)$/.test(k)) continue;
        if (!Object.hasOwn(FIELDS, k) || mode === 'movement') { fail([...at, k], `Unclassified reference member ${k}`, 'reference.unclassified'); continue; }
        const ids = Array.isArray(x) ? x.map((id, i) => [id, [...at, k, i]]) : [[x, [...at, k]]];
        for (const [id, p] of ids) if (typeof id === 'string') field(FIELDS[k], id, p, ctx);
      }
      return ctx;
    }, mode === 'tileset' ? { tileset: tilesetIndex(value) } : {});
  };

  const assetPaths = (value, file) => (value.assets ?? []).forEach((a, i) => {
    const at = `$.assets[${i}].path`;
    const problem = pathProblem(a.path);
    const ext = (a.path.match(/\.[a-z0-9]+$/) ?? [''])[0];
    if (problem) report('asset.path', file, at, `Unsafe asset path: ${problem}`);
    else if (ASSET_TYPES[ext] !== a.mediaType) report('asset.extension', file, at, `${a.path} does not match ${a.mediaType}`);
    else if (!assetFiles.has(a.path)) report('asset.missing', file, at, `Asset ${a.path} is not a listed asset file`);
  });
  for (const { entry, value } of docs.values()) {
    if (value.format === 'maplab.catalog') {
      const keys = new Set();
      value.entries.forEach((e, i) => {
        if (keys.has(`${e.key}@${e.version}`)) report('catalog.duplicate', entry.path, `$.entries[${i}]`, `Duplicate catalog entry ${e.key}@${e.version}`);
        keys.add(`${e.key}@${e.version}`);
        const names = new Set();
        (e.fields ?? []).forEach((f, j) => { if (names.has(f.name)) report('catalog.duplicate-field', entry.path, `$.entries[${i}].fields[${j}].name`, `Duplicate field ${f.name}`); names.add(f.name); });
      });
    }
    if (value.format === 'maplab.tileset') {
      const ids = new Set();
      for (const c of ['assets', 'terrains', 'rules', 'tiles']) (value[c] ?? []).forEach((o, i) => { if (ids.has(o.id)) report('object.duplicate', entry.path, `$.${c}[${i}].id`, `Duplicate tileset object ID ${o.id}`); ids.add(o.id); });
      value.tiles.forEach((t, i) => { const local = new Set(); (t.traceShapes ?? []).forEach((s, j) => { if (local.has(s.id)) report('object.duplicate', entry.path, `$.tiles[${i}].traceShapes[${j}].id`, `Duplicate trace ID ${s.id}`); local.add(s.id); }); });
      walk(value, entry.path, 'tileset', null);
      assetPaths(value, entry.path);
    }
  }
  for (const scope of scopes.values()) {
    const file = docs.get(scope.id).entry.path;
    walk(scope.value, file, 'map', scope);
    assetPaths(scope.value, file);
    // Profiles have no dependency list: like ML-006, each one resolves its catalog entries and typed
    // parameter refs in every map whose closure contains it, whether or not that map declares it.
    for (const id of [...scope.closure].sort()) if (docs.get(id).value.format === 'maplab.movement') walk(docs.get(id).value, docs.get(id).entry.path, 'movement', scope);
  }
  return portals;
}
