// G1 steps 3–4 for verified bytes: exact format/contract negotiation, closed-schema validation,
// dependency closure, then reference resolution inside and across documents. Constructs nothing.
import { ReaderError, jcs, parseStrict } from './json.mjs';
import { validate } from './schema.mjs';
import { ASSET_TYPES, pathProblem } from './bundle.mjs';

/** Exact versions this reader accepts (F7: never `version <= latest`). Prefabs never ship in exports (F4). */
export const SUPPORTED_FORMATS = Object.freeze(['maplab.catalog@1', 'maplab.map@1', 'maplab.movement@1', 'maplab.tileset@1']);
export const SUPPORTED_CONTRACTS = Object.freeze(['maplab.camera@1', 'maplab.catalog@1', 'maplab.climb@1', 'maplab.collision@1',
  'maplab.map@1', 'maplab.movement@1', 'maplab.reference-controller@1', 'maplab.tileset@1']);
const OBJECT_KINDS = new Set(['layer', 'visual', 'body', 'shape', 'foothold', 'traversal', 'region', 'entity', 'waypoint', 'route',
  'trigger', 'encounter', 'asset', 'movement', 'flag', 'group', 'presentation', 'material']);
const COLLECTIONS = { assets: 'asset', presentations: 'presentation', layers: 'layer', visuals: 'visual', materials: 'material', bodies: 'body',
  footholds: 'foothold', traversals: 'traversal', regions: 'region', entities: 'entity', waypoints: 'waypoint', routes: 'route',
  triggers: 'trigger', encounters: 'encounter', flags: 'flag', prefabPlacements: 'prefab-placement' };
const NESTED = { 'camera.zones': 'camera-zone', 'environment.zones': 'environment-zone', 'navigation.modeVolumes': 'nav-volume',
  'navigation.links': 'nav-link', 'navigation.overrides': 'nav-override' };
/** Every `*Id`/`*Ids` member the published v1 schemas define. Anything else fails closed. */
const FIELDS = {
  footholdId: 'foothold', bodyId: 'body', ownerBodyId: 'body', bodyIds: 'body', entityId: 'entity', spawnIds: 'entity',
  assetId: 'asset', assetIds: 'asset', trackAssetId: 'asset', layerId: 'layer', planeId: 'layer', materialId: 'material',
  shapeId: 'shape', visualId: 'visual', regionId: 'region', approachRegionId: 'region', patrolRegionId: 'region',
  pursuitRegionId: 'region', leashRegionId: 'region', aggroRegionId: 'region', waypointIds: 'waypoint', routeId: 'route',
  presentationId: 'presentation', expandedIds: 'any', movementId: 'doc:movement', profileIds: 'doc:movement',
  tilesetId: 'doc:tileset', mapId: 'doc:map', prefabId: 'dep:prefab', bundleDependencyId: 'dep:riglab',
  tileId: 'tile', fallbackTileId: 'tile', outputTileIds: 'tile', terrainId: 'terrain',
  parentId: 'parent', groupId: 'implicit', dropGroupId: 'implicit', suggestedMaterialId: 'advisory',
};
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (segments) => '$' + segments.map((s) => (typeof s === 'number' ? `[${s}]` : `.${s}`)).join('');

/** Parses, negotiates and schema-checks every manifest document. Returns Map id → {entry, value}. */
export function loadDocuments(manifest, files, schemas, diagnostics) {
  const docs = new Map();
  const report = (code, file, path, message) => diagnostics.push({ code, file, path, message });
  for (const contract of manifest.requiredContracts) {
    if (!SUPPORTED_CONTRACTS.includes(`${contract.key}@${contract.version}`)) report('contract.unsupported', 'manifest.json', '$.requiredContracts', `Unsupported required contract ${contract.key}@${contract.version}`);
  }
  if (manifest.externalMaps.length) report('contract.external-maps', 'manifest.json', '$.externalMaps', 'External-map bundles are deferred; this reader accepts closed bundles only');
  const declared = new Set(manifest.requiredContracts.map((c) => `${c.key}@${c.version}`));
  const required = new Set();
  for (const entry of manifest.documents) {
    const bytes = files.get(entry.path);
    let value;
    try { value = parseStrict(bytes); } catch (e) { report(e.code, entry.path, e.path, e.message); continue; }
    const identity = `${value?.format}@${value?.version}`;
    if (!SUPPORTED_FORMATS.includes(identity)) {
      const known = SUPPORTED_FORMATS.some((f) => f.startsWith(`${value?.format}@`));
      report(known ? 'document.version' : 'document.unsupported-format', entry.path, known ? '$.version' : '$.format', `Unsupported document ${identity}`);
      continue;
    }
    if (value.id !== entry.id || value.format !== entry.format || value.version !== entry.version) report('manifest.document-identity', entry.path, '$', `Manifest entry ${entry.id} disagrees with the document`);
    if (!declared.has(identity)) report('contract.undeclared', 'manifest.json', '$.requiredContracts', `${identity} is not declared`);
    if (Buffer.compare(Buffer.from(jcs(value), 'utf8'), bytes) !== 0) report('document.canonical', entry.path, '$', 'Export bytes are not RFC 8785 canonical');
    const violations = validate(schemas.get(identity), value);
    for (const v of violations) report(`schema.${v.keyword}`, entry.path, v.path, `Violates ${identity}`);
    if (violations.length) continue;
    const contracts = [...(value.requiredFeatures ?? []), ...(value.collisionContract ? [value.collisionContract] : []), ...(value.controller ? [value.controller] : [])];
    for (const c of contracts) {
      if (!SUPPORTED_CONTRACTS.includes(`${c.key}@${c.version}`)) report('contract.unsupported', entry.path, '$', `Unsupported contract ${c.key}@${c.version}`);
      else required.add(`${c.key}@${c.version}`);
    }
    docs.set(entry.id, { entry, value });
  }
  // F6: requiredContracts names every semantic contract a bundled document requires.
  for (const c of [...required].sort()) if (!declared.has(c)) report('contract.undeclared', 'manifest.json', '$.requiredContracts', `${c} is required by a document but not declared`);
  return docs;
}

/** Dependency closure from the entry map: identity, presence, reachability and non-map cycles. */
export function checkClosure(manifest, docs, diagnostics) {
  const report = (code, file, path, message) => diagnostics.push({ code, file, path, message });
  const entry = docs.get(manifest.entryMapId);
  if (entry?.value.format !== 'maplab.map') { report('closure.entry', 'manifest.json', '$.entryMapId', 'entryMapId must name a bundled map'); return; }
  const edges = new Map();
  for (const [id, { entry: e, value }] of docs) {
    const out = [];
    (value.dependencies ?? []).forEach((dep, i) => {
      const at = `$.dependencies[${i}]`;
      const target = docs.get(dep.id);
      if (!target) { if (dep.required) report('dependency.missing', e.path, at, `Required dependency ${dep.id} is not in the bundle`); return; }
      if (target.entry.path !== dep.path || target.value.format !== `maplab.${dep.kind}`) report('dependency.identity', e.path, at, `Dependency ${dep.id} disagrees with the bundled document`);
      out.push(dep.id);
    });
    edges.set(id, out);
  }
  const reach = (start) => { const seen = new Set([start]); const stack = [start]; while (stack.length) for (const n of edges.get(stack.pop()) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); } return seen; };
  const closure = reach(manifest.entryMapId);
  for (const [id, { entry: e }] of docs) if (!closure.has(id)) report('closure.unreachable', 'manifest.json', '$.documents', `${e.path} is outside the entry map's dependency closure`);
  for (const [id, { entry: e, value }] of docs) {
    if (value.format === 'maplab.map') continue;
    (edges.get(id) ?? []).forEach((to) => { if (reach(to).has(id)) report('dependency.cycle', e.path, '$.dependencies', `Non-map document ${id} is on a dependency cycle`); });
  }
}

const namespace = (map, report, file) => {
  const ids = new Map();
  const add = (id, kind, at) => { if (ids.has(id)) report('object.duplicate', file, at, `Duplicate object ID ${id}`); else ids.set(id, kind); };
  for (const [collection, kind] of Object.entries(COLLECTIONS)) (map[collection] ?? []).forEach((o, i) => add(o.id, kind, `$.${collection}[${i}].id`));
  for (const [dotted, kind] of Object.entries(NESTED)) {
    const [a, b] = dotted.split('.');
    (map[a]?.[b] ?? []).forEach((o, i) => add(o.id, kind, `$.${dotted}[${i}].id`));
  }
  (map.bodies ?? []).forEach((body, i) => body.shapes.forEach((s, j) => add(s.id, 'shape', `$.bodies[${i}].shapes[${j}].id`)));
  (map.traversals ?? []).forEach((t, i) => (t.access ?? []).forEach((a, j) => add(a.id, 'access', `$.traversals[${i}].access[${j}].id`)));
  return ids;
};

/** Resolves every reference in bundled maps and tilesets; checks calls against declared catalogs and asset paths. */
export function checkReferences(manifest, docs, diagnostics) {
  const report = (code, file, path, message) => diagnostics.push({ code, file, path, message });
  const maps = new Map([...docs].filter(([, d]) => d.value.format === 'maplab.map').map(([id, d]) => [id, d.value]));
  const spaces = new Map();
  for (const [id, map] of maps) spaces.set(id, namespace(map, report, docs.get(id).entry.path));
  const assetFiles = new Set(manifest.files.filter((f) => f.role === 'asset').map((f) => f.path));
  const portals = [];
  for (const [docId, { entry, value }] of docs) {
    if (value.format !== 'maplab.map' && value.format !== 'maplab.tileset') continue;
    const file = entry.path;
    const isMap = value.format === 'maplab.map';
    const space = isMap ? spaces.get(docId) : null;
    const deps = new Map((value.dependencies ?? []).map((d) => [d.id, d.kind]));
    const groups = new Set();
    if (isMap) for (const c of ['entities', 'encounters']) for (const o of value[c]) if (typeof o.groupId === 'string') groups.add(o.groupId);
    const catalogEntries = new Set([...deps].filter(([, k]) => k === 'catalog').flatMap(([id]) => (docs.get(id)?.value.entries ?? []).map((e) => `${e.key}@${e.version}`)));
    const tilesetIndex = (doc) => ({ tile: new Set(doc.tiles.map((t) => t.id)), terrain: new Set(doc.terrains.map((t) => t.id)) });
    const fail = (at, message, code = 'reference.dangling') => report(code, file, text(at), message);
    const docRef = (id, format, at) => {
      if (docs.get(id)?.value.format !== format) fail(at, `${id} is not a bundled ${format} document`);
      else if (isMap && !deps.has(id)) fail(at, `${id} is not a declared dependency`, 'reference.undeclared');
    };
    const resolve = (kind, id, at, ctx) => {
      if (kind === 'implicit' || kind === 'advisory') return;
      if (kind === 'any') { if (!space?.has(id)) fail(at, `Unknown object ${id}`); return; }
      if (kind.startsWith('doc:')) { docRef(id, `maplab.${kind.slice(4)}`, at); return; }
      if (kind.startsWith('dep:')) { if (deps.get(id) !== kind.slice(4)) fail(at, `${id} is not a declared ${kind.slice(4)} dependency`); return; }
      if (kind === 'tile' || kind === 'terrain') { if (!ctx.tileset?.[kind].has(id)) fail(at, `Unknown tileset ${kind} ${id}`); return; }
      if (kind === 'parent') kind = ctx.collection === 'layers' ? 'layer' : ctx.collection === 'visuals' ? 'visual' : null;
      if (!isMap) { if (kind === 'asset' && !value.assets.some((a) => a.id === id)) fail(at, `Unknown tileset asset ${id}`); return; }
      if (kind === null) { fail(at, 'Unclassified parent reference', 'reference.unclassified'); return; }
      const found = (ctx.scope ?? space).get(id);
      if (found === undefined) fail(at, `Unknown ${kind} ${id}`);
      else if (found !== kind) fail(at, `${id} is a ${found}, expected ${kind}`, 'reference.kind');
    };
    const walk = (v, at, ctx) => {
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, [...at, i], ctx)); return; }
      if (!isObject(v)) return;
      if (typeof v.tilesetId === 'string' && docs.get(v.tilesetId)?.value.format === 'maplab.tileset') ctx = { ...ctx, tileset: tilesetIndex(docs.get(v.tilesetId).value) };
      if (isMap && typeof v.kind === 'string' && typeof v.id === 'string' && Object.keys(v).every((k) => k === 'kind' || k === 'id' || k === 'mapId') && OBJECT_KINDS.has(v.kind)) {
        const scope = v.mapId === undefined ? space : spaces.get(v.mapId);
        if (v.mapId !== undefined && !scope) fail([...at, 'mapId'], `Unknown map ${v.mapId}`);
        else if (v.kind === 'movement') docRef(v.id, 'maplab.movement', [...at, 'id']);
        else if (v.kind === 'group') { if (!groups.has(v.id)) fail([...at, 'id'], `Unknown group ${v.id}`); }
        else resolve(v.kind, v.id, [...at, 'id'], { ...ctx, scope });
        return;
      }
      if (isMap && v.kind === 'flag' && typeof v.id === 'string' && 'equals' in v) resolve('flag', v.id, [...at, 'id'], ctx);
      if (isMap && typeof v.key === 'string' && Number.isInteger(v.version) && isObject(v.params) && !catalogEntries.has(`${v.key}@${v.version}`)) {
        fail(at, `Call ${v.key}@${v.version} is not declared by a dependency catalog`, 'catalog.missing');
      }
      if (isMap && typeof v.mapId === 'string' && typeof v.entityId === 'string' && !('kind' in v)) {
        const target = maps.get(v.mapId);
        if (!target) fail([...at, 'mapId'], `Portal destination map ${v.mapId} is not in the bundle`, 'portal.map');
        else if (!target.entities.some((e) => e.id === v.entityId)) fail([...at, 'entityId'], `Destination entity ${v.entityId} is not in ${v.mapId}`, 'portal.entity');
        else portals.push({ from: docId, path: text(at), to: { mapId: v.mapId, entityId: v.entityId } });
        if (target && !deps.has(v.mapId)) fail([...at, 'mapId'], `${v.mapId} is not a declared dependency`, 'reference.undeclared');
      }
      if (isMap && typeof v.bodyId === 'string' && typeof v.shapeId === 'string' && space.get(v.bodyId) === 'body' && !value.bodies.find((b) => b.id === v.bodyId).shapes.some((s) => s.id === v.shapeId)) {
        fail([...at, 'shapeId'], `${v.shapeId} is not a shape of ${v.bodyId}`, 'reference.owner');
      }
      for (const [k, x] of Object.entries(v)) {
        const next = at.length === 0 ? { ...ctx, collection: k } : ctx;
        if (/(?:Id|Ids)$/.test(k)) {
          if (!Object.hasOwn(FIELDS, k)) { fail([...at, k], `Unclassified reference member ${k}`, 'reference.unclassified'); continue; }
          const destination = k === 'entityId' && typeof v.mapId === 'string';
          if (!destination && k !== 'mapId') for (const [i, id] of (Array.isArray(x) ? x.map((y, j) => [j, y]) : [[null, x]])) {
            if (typeof id === 'string') resolve(FIELDS[k], id, i === null ? [...at, k] : [...at, k, i], next);
          }
          if (k === 'mapId' && typeof x === 'string' && !(typeof v.entityId === 'string' || ('kind' in v && 'id' in v))) resolve('doc:map', x, [...at, k], next);
          continue;
        }
        walk(x, [...at, k], next);
      }
    };
    walk(value, [], isMap ? {} : { tileset: tilesetIndex(value) });
    value.assets.forEach((a, i) => {
      const at = ['assets', i, 'path'];
      const problem = pathProblem(a.path);
      const ext = (a.path.match(/\.[a-z0-9]+$/) ?? [''])[0];
      if (problem) fail(at, `Unsafe asset path: ${problem}`, 'asset.path');
      else if (ASSET_TYPES[ext] !== a.mediaType) fail(at, `${a.path} does not match ${a.mediaType}`, 'asset.extension');
      else if (!assetFiles.has(a.path)) fail(at, `Asset ${a.path} is not a listed asset file`, 'asset.missing');
    });
  }
  return portals;
}
