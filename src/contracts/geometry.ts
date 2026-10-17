// ML-004: staged geometry validation. No renderer, collision solver or prefab expansion.
import tilesetSchema from '../../schemas/maplab.tileset.v1.schema.json' with { type: 'json' };
import prefabSchema from '../../schemas/maplab.prefab.v1.schema.json' with { type: 'json' };
import { error, type Diagnostic, type PathSegment } from './diagnostics';
import { isId, COORDINATE_LIMIT } from './grammar';
import { parseJson, type JsonLimits, type JsonValue } from './json';
import { MAP_SCHEMA, validateMapHeader, type MapHeader } from './map-header';
import { canonical, compileSchema, evaluate, type CompiledSchema } from './schema';
import type { Anchor, BodyShape, RegionShape, Vec2 } from './common-types';
import type { CollisionBody, Foothold, Layer, Material, TerrainLayer, Traversal, Visual, VisualSource } from './geometry-types';

export interface PrefabPlacement {
  readonly id: string; readonly prefabId: string; readonly position: Vec2; readonly mirrorX: boolean;
  readonly layerBindings: readonly Readonly<{ slot: string; layerId: string }>[]; readonly expandedIds: readonly string[];
}
export interface GeometryContent {
  readonly assets: MapHeader['assets']; readonly visuals: readonly Visual[]; readonly materials: readonly Material[];
  readonly bodies: readonly CollisionBody[]; readonly footholds: readonly Foothold[]; readonly traversals: readonly Traversal[];
  readonly presentations: readonly JsonValue[]; readonly flags: readonly JsonValue[]; readonly regions: readonly JsonValue[];
  readonly entities: readonly JsonValue[]; readonly waypoints: readonly JsonValue[]; readonly routes: readonly JsonValue[];
  readonly triggers: readonly JsonValue[]; readonly encounters: readonly JsonValue[];
}
export interface MapGeometry extends MapHeader, GeometryContent {
  readonly layers: readonly Layer[]; readonly terrain: readonly TerrainLayer[]; readonly prefabPlacements: readonly PrefabPlacement[];
}
export interface TilesetDocument {
  readonly format: 'maplab.tileset'; readonly version: 1; readonly id: string; readonly name: string;
  readonly cellSize: Vec2; readonly assets: MapHeader['assets'];
  readonly tiles: readonly Readonly<{ id: string; visual: VisualSource; allowedQuarterTurns: readonly number[];
    allowMirrorX: boolean; allowMirrorY: boolean; terrainId: string | null; suggestedMaterialId: string | null; traceShapes: readonly BodyShape[] }>[];
  readonly terrains: readonly Readonly<{ id: string; name: string; biome: string; fallbackTileId: string }>[];
  readonly rulesVersion: number;
  readonly rules: readonly Readonly<{ id: string; terrainId: string; neighborMask: number; priority: number; outputTileIds: readonly string[]; weights: readonly number[] }>[];
}
export interface PrefabDocument {
  readonly format: 'maplab.prefab'; readonly version: 1; readonly id: string; readonly name: string; readonly pivot: Vec2;
  readonly dependencies: MapHeader['dependencies']; readonly layerSlots: readonly string[]; readonly content: GeometryContent;
}
export interface GeometryContext {
  readonly tilesets?: readonly TilesetDocument[]; readonly prefabs?: readonly PrefabDocument[];
}
const CONTENT_KINDS = { assets: 'asset', visuals: 'visual', materials: 'material', bodies: 'body', footholds: 'foothold',
  traversals: 'traversal', presentations: 'presentation', regions: 'region', entities: 'entity', waypoints: 'waypoint',
  routes: 'route', triggers: 'trigger', encounters: 'encounter', flags: 'flag' } as const;
export const TILESET_SCHEMA = compileSchema(tilesetSchema as JsonValue, 'tileset');
export const PREFAB_SCHEMA = compileSchema(prefabSchema as JsonValue, 'prefab');
export const GEOMETRY_DEFERRED = Object.freeze(['presentations', 'flags', 'regions', 'entities', 'waypoints', 'routes', 'triggers',
  'encounters', 'camera', 'environment', 'navigation', 'catalog calls/conditions', 'profile support/clearance'] as const);
export type GeometryResult<T> = { readonly ok: true; readonly document: T; readonly deferred: readonly string[]; readonly unresolved: readonly string[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };
type Report = (name: string, rule: string, at: readonly PathSegment[], message: string, id?: string | null) => void;
const record = (v: unknown): v is Record<string, JsonValue> => typeof v === 'object' && v !== null && !Array.isArray(v);
const same = (a: Vec2, b: Vec2): boolean => a[0] === b[0] && a[1] === b[1];
const plus = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const cross = (a: Vec2, b: Vec2, c: Vec2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const on = (a: Vec2, b: Vec2, p: Vec2): boolean => cross(a, b, p) === 0 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
const intersects = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean =>
  on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b) ||
  (Math.sign(cross(a, b, c)) * Math.sign(cross(a, b, d)) < 0 && Math.sign(cross(c, d, a)) * Math.sign(cross(c, d, b)) < 0);

/** Stable shape IDs are resolved within the named body, independent of shape array order. */
export function shapeEdges(shape: BodyShape): readonly (readonly [Vec2, Vec2])[] {
  if (shape.kind === 'segment') return [[shape.a, shape.b]];
  const points: readonly Vec2[] = shape.kind === 'polygon' ? shape.points : [
    [shape.rect[0], shape.rect[1]], [shape.rect[0] + shape.rect[2], shape.rect[1]],
    [shape.rect[0] + shape.rect[2], shape.rect[1] + shape.rect[3]], [shape.rect[0], shape.rect[1] + shape.rect[3]],
  ];
  return points.map((p, i) => [p, points[(i + 1) % points.length] as Vec2]);
}
function polygonProblem(points: readonly Vec2[]): string | null {
  const n = points.length;
  let area = 0n;
  for (let i = 0; i < n; i++) {
    const a = points[i] as Vec2, b = points[(i + 1) % n] as Vec2, c = points[(i + 2) % n] as Vec2;
    if (same(a, b)) return 'Repeated adjacent polygon vertex';
    if (cross(a, b, c) === 0 && (on(a, b, c) || on(b, c, a))) return 'Adjacent polygon edges overlap';
    area += BigInt(a[0] * 16) * BigInt(b[1] * 16) - BigInt(b[0] * 16) * BigInt(a[1] * 16);
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (intersects(a, b, points[j] as Vec2, points[(j + 1) % n] as Vec2)) return 'Polygon self-intersects';
    }
  }
  return area > 0n ? null : 'Polygon must have positive signed area (clockwise in Y-down)';
}
function shapeCheck(shape: BodyShape | RegionShape, at: readonly PathSegment[], report: Report, id: string | null = null): void {
  const name = shape.kind === 'polygon' ? 'polygon-shape' : shape.kind === 'rect' ? 'rect-shape' : shape.kind === 'circle' ? 'circle-region' : 'segment-shape';
  if (shape.kind === 'polygon') {
    const problem = polygonProblem(shape.points);
    if (problem) report(name, 'geometry', at, problem, id);
  } else if (shape.kind === 'segment') {
    if (same(shape.a, shape.b)) report(name, 'geometry', at, 'A segment must have distinct endpoints', id);
  } else if (shape.kind === 'rect') {
    if (shape.rect[0] + shape.rect[2] > COORDINATE_LIMIT || shape.rect[1] + shape.rect[3] > COORDINATE_LIMIT) report(name, 'range', at, 'Rectangle far edge exceeds the coordinate range', id);
  } else if (shape.center.some((v) => Math.abs(v) + shape.radius > COORDINATE_LIMIT)) report(name, 'range', at, 'Circle extent exceeds the coordinate range', id);
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
function result<T>(value: T, diagnostics: Diagnostic[], unresolved: Set<string>): GeometryResult<T> {
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, document: frozen(structuredClone(value)), deferred: GEOMETRY_DEFERRED, unresolved: [...unresolved].sort() };
}
function structural(value: JsonValue, schema: CompiledSchema): Diagnostic[] {
  const id = record(value) && isId(value.id) ? value.id : null;
  return evaluate(schema, value).map((d) => ({ ...d, documentId: id }));
}
export function loadMapGeometry(input: Uint8Array | string, context: GeometryContext = {}, limits?: JsonLimits): GeometryResult<MapGeometry> {
  const p = parseJson(input, limits); return p.ok ? validateMapGeometry(p.value, context) : { ok: false, diagnostics: [p.diagnostic] };
}
export function loadTileset(input: Uint8Array | string, limits?: JsonLimits): GeometryResult<TilesetDocument> {
  const p = parseJson(input, limits); return p.ok ? validateTileset(p.value) : { ok: false, diagnostics: [p.diagnostic] };
}
export function loadPrefab(input: Uint8Array | string, limits?: JsonLimits): GeometryResult<PrefabDocument> {
  const p = parseJson(input, limits); return p.ok ? validatePrefab(p.value) : { ok: false, diagnostics: [p.diagnostic] };
}

function reporter(id: string, out: Diagnostic[]): Report {
  return (name, rule, at, message, objectId = null) => { if (out.length < 100) out.push(error(`${name}.${rule}`, at, message, id, objectId)); };
}
// Reuse ML-003's path, alias, asset and dependency checks across authored formats.
function baseChecks(id: string, assets: MapHeader['assets'], dependencies: MapHeader['dependencies']): Diagnostic[] {
  const probe = { format: 'maplab.map', version: 1, id, metadata: { name: '', description: '', authors: [], license: '', tags: [] },
    requiredFeatures: [], coordinates: { units: 'WU', x: 'right', y: 'down', rotation: 'clockwiseDegrees', quantum: 0.0625, ticksPerSecond: 60 },
    bounds: [0, 0, 1, 1], collisionContract: { key: 'maplab.collision', version: 1 }, dependencies, assets };
  // Header validation uses the published closed map; populate only empty deferred collections.
  Object.assign(probe, { metadata: { ...probe.metadata, name: 'Validation', license: 'CC0-1.0' } });
  for (const key of Object.keys(MAP_SCHEMA.root.properties as object)) if (!(key in probe)) Object.assign(probe, { [key]: ['camera', 'environment', 'navigation'].includes(key) ? {} : [] });
  const checked = validateMapHeader(probe as unknown as JsonValue);
  return checked.ok ? [] : [...checked.diagnostics];
}

function contentChecks(content: GeometryContent, layers: readonly Layer[] | readonly string[], report: Report, prefix: readonly PathSegment[], prefab: boolean): Map<string, string> {
  const ids = new Map<string, string>();
  const register = (id: string, kind: string, at: readonly PathSegment[]): void => {
    if (ids.has(id)) report(kind, 'identity', at, `Duplicate object ID ${id}`, id);
    else ids.set(id, kind);
  };
  if (!prefab) (layers as readonly Layer[]).forEach((l, i) => register(l.id, 'layer', ['layers', i, 'id']));
  for (const [collection, kind] of Object.entries(CONTENT_KINDS)) {
    (content[collection as keyof GeometryContent] as readonly unknown[]).forEach((o, i) => {
      if (record(o) && isId(o.id)) register(o.id, kind, [...prefix, collection, i, 'id']);
    });
  }
  content.bodies.forEach((b, i) => b.shapes.forEach((s, j) => register(s.id, 'body-shape', [...prefix, 'bodies', i, 'shapes', j, 'id'])));
  content.traversals.forEach((t, i) => { if ('access' in t) t.access.forEach((a, j) => register(a.id, 'access-point', [...prefix, 'traversals', i, 'access', j, 'id'])); });
  const ref = (id: string | null, kind: string, name: string, at: readonly PathSegment[]): void => {
    if (id !== null && ids.get(id) !== kind) report(name, 'reference', at, `Expected ${kind} ${id}`, id);
  };
  const layerMap = new Map((prefab ? [] : layers as readonly Layer[]).map((l) => [l.id, l]));
  const layerRef = (id: string | null, name: string, at: readonly PathSegment[], plane = false): void => {
    if (id === null) return;
    if (prefab) { if (!(layers as readonly string[]).includes(id)) report(name, 'layer-slot', at, `Undeclared prefab layer slot ${id}`); }
    else if (plane ? layerMap.get(id)?.kind !== 'actors' : !['sprite', 'background'].includes(layerMap.get(id)?.kind ?? '')) report(name, 'reference', at, `Expected ${plane ? 'actors plane' : 'visual content layer'} ${id}`);
  };
  const bodyMap = new Map(content.bodies.map((b) => [b.id, b]));
  const footholdMap = new Map(content.footholds.map((f) => [f.id, f]));
  const visualMap = new Map(content.visuals.map((v) => [v.id, v]));
  const entityMap = new Map(content.entities.filter(record).filter((e) => isId(e.id)).map((e) => [e.id as string, e]));
  const anchorSchema = { ...MAP_SCHEMA, root: { $ref: '#/$defs/anchor' } };
  const anchor = (a: Anchor, at: readonly PathSegment[], name: string): Vec2 | null => {
    let current = a, offset: Vec2 = [0, 0];
    const seen = new Set<string>();
    while (current.kind === 'entity') {
      ref(current.entityId, 'entity', name, [...at, 'entityId']);
      if (!entityMap.has(current.entityId)) return null;
      if (seen.has(current.entityId)) { report(name, 'reference-cycle', at, 'Entity anchor graph contains a cycle', current.entityId); return null; }
      seen.add(current.entityId);
      const target = entityMap.get(current.entityId)?.anchor;
      if (target === undefined || evaluate(anchorSchema, target).length) { report(name, 'unresolved', at, 'Referenced entity needs a structurally valid source anchor', current.entityId); return null; }
      offset = plus(offset, current.point); current = target as unknown as Anchor;
    }
    let point: Vec2 | null = null;
    if (current.kind === 'world') point = current.point;
    else if (current.kind === 'body') { ref(current.bodyId, 'body', name, [...at, 'bodyId']); const b = bodyMap.get(current.bodyId); point = b ? plus(b.position, current.point) : null; }
    else {
      ref(current.footholdId, 'foothold', name, [...at, 'footholdId']);
      const f = footholdMap.get(current.footholdId); if (!f) return null;
      const b = f.ownerBodyId === null ? [0, 0] as Vec2 : bodyMap.get(f.ownerBodyId)?.position; if (!b) return null;
      const dx = f.b[0] - f.a[0], dy = f.b[1] - f.a[1], length = Math.hypot(dx, dy);
      if (length === 0) return null;
      point = [b[0] + f.a[0] + current.u * dx + current.normalOffset * dy / length,
        b[1] + f.a[1] + current.u * dy - current.normalOffset * dx / length];
    }
    const resolved = point && plus(point, offset);
    if (resolved?.some((v) => !Number.isFinite(v) || Math.abs(v) > COORDINATE_LIMIT)) report(name, 'range', at, 'Resolved anchor exceeds the coordinate range');
    return resolved;
  };
  const checkedAnchor = (a: JsonValue, at: readonly PathSegment[], name: string): void => {
    const ds = evaluate(anchorSchema, a);
    if (ds.length) ds.forEach((d) => report(name, 'anchor', at, d.message));
    else anchor(a as unknown as Anchor, at, name);
  };
  // Geometry owns anchor shape/reference integrity; profile support and gameplay fields stay deferred.
  for (const key of ['entities', 'waypoints'] as const) content[key].forEach((v, i) => {
    if (!record(v)) return;
    if (v.anchor !== undefined) checkedAnchor(v.anchor, [...prefix, key, i, 'anchor'], 'anchor');
    if (record(v.ai)) for (const field of ['guard', 'home']) if (v.ai[field] !== undefined && v.ai[field] !== null) checkedAnchor(v.ai[field] as JsonValue, [...prefix, key, i, 'ai', field], 'anchor');
  });
  const cycles = <T extends { readonly id: string; readonly parentId: string | null }>(items: readonly T[], name: string, collection: string): void => {
    const lookup = new Map(items.map((x) => [x.id, x])); const done = new Set<string>();
    for (const [i, item] of items.entries()) {
      const chain = new Set<string>(); let current: T | undefined = item;
      while (current && !done.has(current.id)) {
        if (chain.has(current.id)) { report(name, 'parent-cycle', [...prefix, collection, i, 'parentId'], 'Parent graph contains a cycle', item.id); break; }
        chain.add(current.id); current = current.parentId === null ? undefined : lookup.get(current.parentId);
      }
      chain.forEach((id) => done.add(id));
    }
  };
  if (!prefab) {
    const ls = layers as readonly Layer[];
    ls.forEach((l, i) => {
      if (l.parentId !== null && layerMap.get(l.parentId)?.kind !== 'group') report('layer', 'parent', ['layers', i, 'parentId'], 'Layer parent must be a group', l.id);
      if (l.kind === 'background' && ((l.repeat.includes('x') && l.repeatSize[0] <= 0) || (l.repeat.includes('y') && l.repeatSize[1] <= 0))) report('background-layer', 'repeat', ['layers', i, 'repeatSize'], 'Repeated axes need a positive repeat size', l.id);
    });
    cycles(ls, 'layer', 'layers');
  }
  const source = (s: VisualSource, at: readonly PathSegment[], id: string): void => {
    if (s.kind === 'shape') shapeCheck(s.shape, [...at, 'shape'], report, id);
    else if (s.kind === 'asset') ref(s.assetId, 'asset', 'asset-source', [...at, 'assetId']);
    else {
      s.assetIds.forEach((assetId, i) => ref(assetId, 'asset', 'frames-source', [...at, 'assetIds', i]));
      if (s.assetIds.length !== s.frameTicks.length) report('frames-source', 'timings', [...at, 'frameTicks'], 'Each frame needs one duration', id);
    }
  };
  content.visuals.forEach((v, i) => {
    const at = [...prefix, 'visuals', i]; layerRef(v.layerId, 'visual', [...at, 'layerId']); ref(v.parentId, 'visual', 'visual', [...at, 'parentId']); ref(v.bodyId, 'body', 'visual', [...at, 'bodyId']);
    const parent = v.parentId === null ? undefined : visualMap.get(v.parentId);
    if (parent && (parent.layerId !== v.layerId || parent.bodyId !== v.bodyId)) report('visual', 'parent-frame', [...at, 'parentId'], 'Visual parent must share layer and body frame', v.id);
    source(v.source, [...at, 'source'], v.id);
  });
  cycles(content.visuals, 'visual', 'visuals');
  const edge = (e: { bodyId: string; shapeId: string; edgeIndex: number }, at: readonly PathSegment[], name: string): { body: CollisionBody; points: readonly [Vec2, Vec2] } | null => {
    const body = bodyMap.get(e.bodyId); const shape = body?.shapes.find((s) => s.id === e.shapeId); const points = shape && shapeEdges(shape)[e.edgeIndex];
    if (!body || !shape || !points) { report(name, 'reference', at, 'Edge must resolve within its named body and shape'); return null; }
    return { body, points };
  };
  content.bodies.forEach((b, i) => {
    const at = [...prefix, 'bodies', i]; ref(b.materialId, 'material', 'body', [...at, 'materialId']);
    b.shapes.forEach((s, j) => {
      shapeCheck(s, [...at, 'shapes', j], report, s.id);
      if (shapeEdges(s).some((e) => e.some((p) => plus(p, b.position).some((v) => Math.abs(v) > COORDINATE_LIMIT)))) report('body', 'range', [...at, 'shapes', j], 'Body-translated geometry exceeds range', b.id);
    });
    if (b.mobility === 'static' && b.motion !== null) report('body', 'motion', [...at, 'motion'], 'Static bodies cannot have motion', b.id);
    if (b.motion) {
      if (b.motion.legTicks.length !== b.motion.points.length - 1) report('motion', 'legs', [...at, 'motion', 'legTicks'], 'One duration per motion leg', b.id);
      if (b.motion.mode === 'loop' && !same(b.motion.points[0] as Vec2, b.motion.points.at(-1) as Vec2)) report('motion', 'loop', [...at, 'motion', 'points'], 'Loop paths repeat their first point', b.id);
      const duration = b.motion.legTicks.reduce((sum, ticks) => sum + ticks, 0);
      const period = b.motion.mode === 'pingPong' ? duration * 2 : duration;
      if (!Number.isSafeInteger(period) || (b.motion.mode === 'once' ? b.motion.initialPhaseTicks > period : b.motion.initialPhaseTicks >= period)) report('motion', 'phase', [...at, 'motion', 'initialPhaseTicks'], 'Initial phase must be within the safe-integer motion period (once paths may start at their terminal tick)', b.id);
    }
  });
  content.footholds.forEach((f, i) => {
    const at = [...prefix, 'footholds', i]; ref(f.ownerBodyId, 'body', 'foothold', [...at, 'ownerBodyId']); ref(f.materialId, 'material', 'foothold', [...at, 'materialId']); layerRef(f.planeId, 'foothold', [...at, 'planeId'], true);
    if (f.a[0] >= f.b[0]) report('foothold', 'x-monotone', [...at, 'b'], 'Footholds require a.x < b.x', f.id);
    const ownerPosition = f.ownerBodyId === null ? [0, 0] as Vec2 : bodyMap.get(f.ownerBodyId)?.position;
    if (ownerPosition && [f.a, f.b].some((p) => plus(p, ownerPosition).some((v) => Math.abs(v) > COORDINATE_LIMIT))) report('foothold', 'range', at, 'Body-translated foothold exceeds range', f.id);
    if (f.mode === 'solid' ? f.solidEdge === null : f.solidEdge !== null) report('foothold', 'solid-edge', [...at, 'solidEdge'], 'solidEdge is required exactly for solid mode', f.id);
    if (f.mode === 'solid' && f.dropAllowed) report('foothold', 'drop', [...at, 'dropAllowed'], 'Solid supports cannot drop through', f.id);
    if (f.mode === 'solid' && f.solidEdge) {
      const resolved = edge(f.solidEdge, [...at, 'solidEdge'], 'edge-ref');
      if (resolved) {
        const [a, b] = resolved.points;
        if (f.ownerBodyId !== resolved.body.id) report('foothold', 'owner', [...at, 'ownerBodyId'], 'Solid edge and foothold must have the same owner', f.id);
        else if (!((same(f.a, a) && same(f.b, b)) || (same(f.a, b) && same(f.b, a)))) report('foothold', 'edge-equality', [...at, 'solidEdge'], 'Foothold must equal its entire source edge', f.id);
        else if (resolved.body.shapes.find((s) => s.id === f.solidEdge?.shapeId)?.kind !== 'segment' && a[0] >= b[0]) report('foothold', 'support-face', [...at, 'solidEdge'], 'Solid support must be an exposed upward-facing edge', f.id);
        if (f.enabled !== resolved.body.enabled || f.category !== resolved.body.category || canonical([...f.mask].sort()) !== canonical([...resolved.body.mask].sort())) report('foothold', 'collision', at, 'Solid support collision settings must agree with its body', f.id);
      }
    }
    for (const endpoint of ['a', 'b'] as const) f.connections[endpoint].forEach((link, j) => {
      const atLink = [...at, 'connections', endpoint, j]; const target = footholdMap.get(link.footholdId);
      if (!target) report('endpoint-link', 'reference', atLink, 'Missing connected foothold', f.id);
      else if (target.id === f.id || target.ownerBodyId !== f.ownerBodyId || !same(f[endpoint], target[link.endpoint])) report('endpoint-link', 'weld', atLink, 'Welds require distinct surfaces and equal endpoints in the same owner frame', f.id);
      else if (!target.connections[link.endpoint].some((back) => back.footholdId === f.id && back.endpoint === endpoint)) report('endpoint-link', 'reciprocity', atLink, 'Weld must have a reciprocal endpoint link', f.id);
    });
  });
  // Sweep by left endpoint, avoiding all-pairs work on ordinary disjoint floors.
  const supports = content.footholds.map((f) => {
    const p = f.ownerBodyId === null ? [0, 0] as Vec2 : bodyMap.get(f.ownerBodyId)?.position ?? [0, 0] as Vec2;
    return { f, a: plus(f.a, p), b: plus(f.b, p) };
  }).sort((x, y) => x.a[0] - y.a[0]);
  supports.forEach((s, i) => {
    for (let j = i + 1; j < supports.length; j++) {
      const t = supports[j] as typeof s; if (t.a[0] >= s.b[0]) break;
      if (Math.min(s.b[0], t.b[0]) > Math.max(s.a[0], t.a[0]) && cross(s.a, s.b, t.a) === 0 && cross(s.a, s.b, t.b) === 0) report('foothold', 'ownership', [...prefix, 'footholds', content.footholds.indexOf(t.f)], 'Overlapping same-facing supports have ambiguous ownership', t.f.id);
    }
  });
  content.traversals.forEach((t, i) => {
    const at = [...prefix, 'traversals', i];
    if ('access' in t) {
      ref(t.visualId, 'visual', 'climb-traversal', [...at, 'visualId']); layerRef(t.planeId, 'climb-traversal', [...at, 'planeId'], true);
      const first = t.points[0] as Vec2, last = t.points.at(-1) as Vec2;
      if (first[1] === last[1] || t.points.some((p, j) => p[0] !== first[0] || (j > 0 && Math.sign(p[1] - (t.points[j - 1] as Vec2)[1]) !== Math.sign(last[1] - first[1])))) report('climb-traversal', 'vertical', [...at, 'points'], 'Climb paths must be vertical and strictly monotone', t.id);
      t.access.forEach((a, j) => {
        const p = anchor(a.anchor, [...at, 'access', j, 'anchor'], 'anchor');
        const expected: Vec2 = [first[0], first[1] + a.pathU * (last[1] - first[1])];
        if (p && !same(p, expected)) report('access-point', 'attachment', [...at, 'access', j, 'anchor'], 'Access anchor must equal the declared path point', a.id);
      });
    } else if ('edge' in t) { edge(t.edge, [...at, 'edge'], 'edge-ref'); ref(t.approachRegionId, 'region', 'edge-traversal', [...at, 'approachRegionId']); }
    else { anchor(t.from, [...at, 'from'], 'anchor'); anchor(t.to, [...at, 'to'], 'anchor'); }
  });
  return ids;
}

export function validateMapGeometry(value: JsonValue, context: GeometryContext = {}): GeometryResult<MapGeometry> {
  const base = validateMapHeader(value); if (!base.ok) return base;
  const doc = value as unknown as MapGeometry; const out: Diagnostic[] = []; const report = reporter(doc.id, out); const unresolved = new Set<string>();
  if (!doc.layers.some((l) => l.kind === 'actors')) report('layer', 'actors', ['layers'], 'A map needs at least one actors layer');
  const ids = contentChecks(doc, doc.layers, report, [], false);
  const deps = new Map(doc.dependencies.map((d) => [d.id, d.kind]));
  const layers = new Map(doc.layers.map((l) => [l.id, l]));
  const terrains = new Set<string>(); let occupied = 0;
  doc.terrain.forEach((t, i) => {
    const at = ['terrain', i];
    if (layers.get(t.layerId)?.kind !== 'tile' || terrains.has(t.layerId)) report('terrain', 'layer', [...at, 'layerId'], 'Terrain needs a distinct tile layer'); terrains.add(t.layerId);
    if (deps.get(t.tilesetId) !== 'tileset') report('terrain', 'reference', [...at, 'tilesetId'], 'Tileset dependency must be declared');
    const set = context.tilesets?.find((s) => s.id === t.tilesetId); if (!set) unresolved.add(t.tilesetId);
    if (set && (set.rulesVersion !== t.rulesVersion || !same(set.cellSize, t.cellSize))) report('terrain', 'tileset', at, 'Cell size/rules version must match tileset');
    const chunks = new Set<string>(); const intents = new Set<string>();
    t.terrainIntent.forEach((intent, j) => {
      const key = `${intent.column},${intent.row}`;
      if (intents.has(key)) report('terrain', 'intent', [...at, 'terrainIntent', j], 'Duplicate terrain intent cell'); intents.add(key);
      if (set && !set.terrains.some((x) => x.id === intent.terrainId)) report('terrain', 'reference', [...at, 'terrainIntent', j, 'terrainId'], 'Unknown tileset terrain');
    });
    const tiles = new Map(set?.tiles.map((x) => [x.id, x]));
    t.chunks.forEach((chunk, j) => {
      const key = `${chunk.column},${chunk.row}`;
      if (chunks.has(key)) report('chunk', 'identity', [...at, 'chunks', j], 'Duplicate chunk coordinate'); chunks.add(key);
      if (chunk.cells.every((cell) => cell === null)) report('chunk', 'empty', [...at, 'chunks', j], 'Empty chunks are omitted');
      chunk.cells.forEach((cell, k) => {
        if (!cell) return; occupied++;
        const x = t.origin[0] + (chunk.column * 32 + k % 32) * t.cellSize[0];
        const y = t.origin[1] + (chunk.row * 32 + Math.floor(k / 32)) * t.cellSize[1];
        if ([x, y, x + t.cellSize[0], y + t.cellSize[1]].some((v) => !Number.isFinite(v) || Math.abs(v) > COORDINATE_LIMIT)) report('cell', 'range', [...at, 'chunks', j, 'cells', k], 'Cell extent exceeds world range');
        if (!set) return; const tile = tiles.get(cell.tileId);
        if (!tile) report('cell', 'reference', [...at, 'chunks', j, 'cells', k, 'tileId'], 'Unknown tileset tile');
        else if (!tile.allowedQuarterTurns.includes(cell.quarterTurns) || (cell.mirrorX && !tile.allowMirrorX) || (cell.mirrorY && !tile.allowMirrorY)) report('cell', 'transform', [...at, 'chunks', j, 'cells', k], 'Tile transform is forbidden');
      });
    });
  });
  if (occupied > 1000000) report('terrain', 'limit', ['terrain'], 'Map exceeds one million occupied cells');
  const expanded = new Set<string>();
  doc.prefabPlacements.forEach((p, i) => {
    const at = ['prefabPlacements', i];
    if (ids.has(p.id)) report('prefab-placement', 'identity', [...at, 'id'], 'Placement ID collides with an object', p.id); else ids.set(p.id, 'prefab-placement');
    // Exported expanded maps may omit the optional prefab dependency; provenance is still retained.
    if (deps.has(p.prefabId) && deps.get(p.prefabId) !== 'prefab') report('prefab-placement', 'reference', [...at, 'prefabId'], 'Expected a prefab dependency', p.id);
    const prefab = context.prefabs?.find((f) => f.id === p.prefabId); if (!prefab) unresolved.add(p.prefabId);
    const slots = new Set<string>();
    let validBindings = true;
    p.layerBindings.forEach((b, j) => {
      if (slots.has(b.slot)) { validBindings = false; report('layer-binding', 'slot', [...at, 'layerBindings', j, 'slot'], 'Each slot binds exactly once', p.id); } slots.add(b.slot);
      if (!layers.has(b.layerId) || layers.get(b.layerId)?.kind === 'group') { validBindings = false; report('layer-binding', 'reference', [...at, 'layerBindings', j, 'layerId'], 'Slot must bind a content layer', p.id); }
    });
    if (prefab && (slots.size !== prefab.layerSlots.length || prefab.layerSlots.some((s) => !slots.has(s)))) { validBindings = false; report('prefab-placement', 'layer-slots', [...at, 'layerBindings'], 'Bindings must cover exactly the prefab layer slots', p.id); }
    p.expandedIds.forEach((id, j) => {
      if (!ids.has(id) || ids.get(id) === 'prefab-placement') report('prefab-placement', 'reference', [...at, 'expandedIds', j], 'Expanded object does not exist', p.id);
      else if (expanded.has(id)) report('prefab-placement', 'ownership', [...at, 'expandedIds', j], 'Expanded object belongs to two placements', p.id);
      expanded.add(id);
    });
    if (prefab) {
      const sourceKinds = contentKinds(prefab.content);
      const expected = [...sourceKinds.keys()].map((id) => `${p.id}:${id}`).sort();
      if (canonical(expected) !== canonical([...p.expandedIds].sort())) report('prefab-placement', 'expanded-ids', [...at, 'expandedIds'], 'Expanded IDs must preserve the placement namespace', p.id);
      p.expandedIds.forEach((id, j) => {
        const kind = sourceKinds.get(id.slice(p.id.length + 1));
        if (kind && ids.has(id) && ids.get(id) !== kind) report('prefab-placement', 'kind', [...at, 'expandedIds', j], 'Expanded object must retain its source kind', p.id);
      });
      const bindings = new Map(p.layerBindings.map((b) => [b.slot, b.layerId]));
      if (validBindings) {
        prefab.content.visuals.forEach((v) => {
          const actual = doc.visuals.find((x) => x.id === `${p.id}:${v.id}`);
          if (actual && actual.layerId !== bindings.get(v.layerId)) report('prefab-placement', 'layer-binding', [...at, 'layerBindings'], 'Expanded visual layer does not match its slot', p.id);
        });
        prefab.content.footholds.forEach((f) => {
          const actual = doc.footholds.find((x) => x.id === `${p.id}:${f.id}`);
          if (f.planeId !== null && actual && actual.planeId !== bindings.get(f.planeId)) report('prefab-placement', 'plane-binding', [...at, 'layerBindings'], 'Expanded foothold plane does not match its slot', p.id);
        });
        prefab.content.traversals.forEach((t) => {
          const actual = doc.traversals.find((x) => x.id === `${p.id}:${t.id}`);
          if ('planeId' in t && t.planeId !== null && actual && 'planeId' in actual && actual.planeId !== bindings.get(t.planeId)) report('prefab-placement', 'plane-binding', [...at, 'layerBindings'], 'Expanded climb plane does not match its slot', p.id);
        });
      }
    }
  });
  return result(doc, out, unresolved);
}
function contentKinds(content: GeometryContent): Map<string, string> {
  const ids = new Map<string, string>();
  for (const [collection, kind] of Object.entries(CONTENT_KINDS)) {
    (content[collection as keyof GeometryContent] as readonly unknown[]).forEach((v) => { if (record(v) && isId(v.id)) ids.set(v.id, kind); });
  }
  content.bodies.forEach((b) => b.shapes.forEach((s) => ids.set(s.id, 'body-shape')));
  content.traversals.forEach((t) => { if ('access' in t) t.access.forEach((a) => ids.set(a.id, 'access-point')); }); return ids;
}
export function validatePrefab(value: JsonValue): GeometryResult<PrefabDocument> {
  const ds = structural(value, PREFAB_SCHEMA); if (ds.length) return { ok: false, diagnostics: ds };
  const doc = value as unknown as PrefabDocument; const out = baseChecks(doc.id, doc.content.assets, doc.dependencies).map((d) => ({ ...d, jsonPath: d.jsonPath.startsWith('$.assets') ? d.jsonPath.replace('$.assets', '$.content.assets') : d.jsonPath }));
  contentChecks(doc.content, doc.layerSlots, reporter(doc.id, out), ['content'], true);
  return result(doc, out, new Set());
}
export function validateTileset(value: JsonValue): GeometryResult<TilesetDocument> {
  const ds = structural(value, TILESET_SCHEMA); if (ds.length) return { ok: false, diagnostics: ds };
  const doc = value as unknown as TilesetDocument; const out = baseChecks(doc.id, doc.assets, []); const report = reporter(doc.id, out);
  const ids = new Set<string>();
  for (const [name, collection] of [['asset', doc.assets], ['tile', doc.tiles], ['tileset-terrain', doc.terrains], ['tile-rule', doc.rules]] as const) collection.forEach((v, i) => {
    if (ids.has(v.id)) report(name, 'identity', [name === 'asset' ? 'assets' : name === 'tileset-terrain' ? 'terrains' : name === 'tile-rule' ? 'rules' : 'tiles', i, 'id'], 'Duplicate tileset object ID', v.id); ids.add(v.id);
  });
  // Trace shape IDs are local to a tile; R1 deliberately reuses trace.full across tiles.
  doc.tiles.forEach((t, i) => {
    const at = ['tiles', i]; const seen = new Set<string>();
    t.traceShapes.forEach((s, j) => { if (seen.has(s.id)) report('body-shape', 'identity', [...at, 'traceShapes', j, 'id'], 'Duplicate tile-local trace ID', s.id); seen.add(s.id); shapeCheck(s, [...at, 'traceShapes', j], report, s.id); });
    if (t.visual.kind === 'shape') shapeCheck(t.visual.shape, [...at, 'visual', 'shape'], report, t.id);
    else {
      const refs = t.visual.kind === 'asset' ? [t.visual.assetId] : t.visual.assetIds;
      refs.forEach((id) => { if (!doc.assets.some((a) => a.id === id)) report('visual-source', 'reference', [...at, 'visual'], 'Missing visual asset', t.id); });
      if (t.visual.kind === 'frames' && t.visual.assetIds.length !== t.visual.frameTicks.length) report('frames-source', 'timings', [...at, 'visual', 'frameTicks'], 'Each frame needs one duration', t.id);
    }
    if (t.terrainId !== null && !doc.terrains.some((r) => r.id === t.terrainId)) report('tile', 'reference', [...at, 'terrainId'], 'Unknown tileset terrain', t.id);
  });
  doc.terrains.forEach((t, i) => { if (!doc.tiles.some((x) => x.id === t.fallbackTileId)) report('tileset-terrain', 'reference', ['terrains', i, 'fallbackTileId'], 'Missing fallback tile', t.id); });
  doc.rules.forEach((r, i) => {
    if (!doc.terrains.some((t) => t.id === r.terrainId) || r.outputTileIds.some((id) => !doc.tiles.some((t) => t.id === id))) report('tile-rule', 'reference', ['rules', i], 'Rule terrain and output tiles must resolve', r.id);
    if (r.weights.length !== r.outputTileIds.length || !Number.isSafeInteger(r.weights.reduce((a, b) => a + b, 0))) report('tile-rule', 'weights', ['rules', i, 'weights'], 'One positive safe weight per output, with safe total', r.id);
  });
  return result(doc, out, new Set());
}
