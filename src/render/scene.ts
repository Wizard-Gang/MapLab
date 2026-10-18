// Backend-neutral viewport primitives, built once per model identity. No document clones on input.
// Terrain cells draw from the packed store (ML-013); asset decoding and derived navigation arrive in their reserved tasks.
import type { Anchor, BodyShape, Rect, RegionShape, Transform, Vec2 } from '../contracts/common-types';
import type { CollisionBody, Foothold, Layer, Traversal, Visual } from '../contracts/geometry-types';
import type { Entity, Region, Route, Waypoint } from '../contracts/gameplay-types';
import type { CollectionName, MapModel } from '../domain/model';
import type { Overlay } from '../editor/viewport';
import type { TilesetDocument } from '../contracts';
import { gridOf } from '../editor/terrain';
import { tileArt, type TerrainArt } from './terrain';

export interface Primitive {
  readonly points: readonly Vec2[];
  readonly closed: boolean;
  readonly color: string;
  readonly fill: boolean;
  readonly label: string;
  readonly bounds: Rect;
  readonly objectId?: string;
}
export interface ArtLayer { readonly layer: Layer; readonly commands: readonly Primitive[]; readonly visible: boolean; readonly opacity: number; readonly terrain?: TerrainArt }
export interface Scene {
  readonly bounds: Rect;
  readonly art: readonly ArtLayer[];
  readonly passes: ReadonlyMap<Overlay, readonly Primitive[]>;
}
export const records = <T>(model: MapModel, name: CollectionName): readonly T[] => {
  const c = model.collections.get(name);
  return c ? c.order.map((id) => c.byId.get(id) as unknown as T) : [];
};
export const mapBounds = (model: MapModel): Rect => model.fields.get('bounds') as unknown as Rect;
const plus = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const boundsOf = (ps: readonly Vec2[]): Rect => {
  let x = Infinity, y = Infinity, r = -Infinity, b = -Infinity;
  for (const p of ps) { x = Math.min(x, p[0]); y = Math.min(y, p[1]); r = Math.max(r, p[0]); b = Math.max(b, p[1]); }
  return [x, y, r - x, b - y];
};
export function primitive(points: readonly Vec2[], color: string, label = '', closed = false, fill = false): Primitive {
  return { points, color, label, closed, fill, bounds: boundsOf(points) };
}
export function shapePoints(shape: RegionShape | BodyShape): readonly Vec2[] {
  if (shape.kind === 'rect') { const [x, y, w, h] = shape.rect; return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
  if (shape.kind === 'polygon') return shape.points;
  if (shape.kind === 'segment') return [shape.a, shape.b];
  return Array.from({ length: 64 }, (_, i): Vec2 => [shape.center[0] + Math.cos(i * Math.PI / 32) * shape.radius, shape.center[1] + Math.sin(i * Math.PI / 32) * shape.radius]);
}
function transformed(p: Vec2, t: Transform): Vec2 {
  const x = p[0] * t.scale[0] * (t.mirrorX ? -1 : 1), y = p[1] * t.scale[1] * (t.mirrorY ? -1 : 1), r = t.rotation * Math.PI / 180;
  return [t.position[0] + x * Math.cos(r) - y * Math.sin(r), t.position[1] + x * Math.sin(r) + y * Math.cos(r)];
}
/** `tilesets` supplies tile art by tileset ID; a tile layer whose tileset is absent draws its cells as missing markers. */
export function buildScene(model: MapModel, tilesets: ReadonlyMap<string, TilesetDocument> = new Map()): Scene {
  const bodies = new Map(records<CollisionBody>(model, 'bodies').map((b) => [b.id, b]));
  const footholds = new Map(records<Foothold>(model, 'footholds').map((f) => [f.id, f]));
  const regions = new Map(records<Region>(model, 'regions').map((r) => [r.id, r]));
  const entities = new Map(records<Entity>(model, 'entities').map((e) => [e.id, e]));
  const visuals = new Map(records<Visual>(model, 'visuals').map((v) => [v.id, v]));
  const bodyPosition = (id: string | null): Vec2 => (id ? bodies.get(id)?.position : null) ?? [0, 0];
  const entityPoints = new Map<string, Vec2 | null>();
  const baseAnchor = (a: Exclude<Anchor, { readonly kind: 'entity' }>): Vec2 | null => {
    if (a.kind === 'world') return a.point;
    if (a.kind === 'body') return plus(bodyPosition(a.bodyId), a.point);
    const f = footholds.get(a.footholdId);
    if (!f) return null;
    const dx = f.b[0] - f.a[0], dy = f.b[1] - f.a[1], length = Math.hypot(dx, dy);
    return plus(bodyPosition(f.ownerBodyId), [f.a[0] + dx * a.u + dy / length * a.normalOffset, f.a[1] + dy * a.u - dx / length * a.normalOffset]);
  };
  const resolveEntity = (id: string): Vec2 | null => {
    const path: { readonly id: string; readonly offset: Vec2 }[] = [], seen = new Set<string>();
    let current = id, point: Vec2 | null = null;
    while (true) {
      if (entityPoints.has(current)) { point = entityPoints.get(current)!; break; }
      if (seen.has(current)) break; // Invalid cycles terminate without fabricating a location.
      seen.add(current);
      const e = entities.get(current);
      if (!e) break;
      if (e.anchor.kind !== 'entity') { point = baseAnchor(e.anchor); entityPoints.set(current, point); break; }
      path.push({ id: current, offset: e.anchor.point }); current = e.anchor.entityId;
    }
    for (let i = path.length - 1; i >= 0; i--) {
      const entry = path[i]!; point = point ? plus(point, entry.offset) : null; entityPoints.set(entry.id, point);
    }
    return point;
  };
  const resolve = (a: Anchor): Vec2 | null => {
    if (a.kind !== 'entity') return baseAnchor(a);
    const point = resolveEntity(a.entityId); return point ? plus(point, a.point) : null;
  };
  const layers = records<Layer>(model, 'layers');
  const order: ArtLayer[] = [];
  const sorted = <T extends { readonly order: number; readonly id: string }>(items: readonly T[]): T[] => [...items].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const children = new Map<string | null, Layer[]>();
  for (const layer of layers) { const list = children.get(layer.parentId) ?? []; list.push(layer); children.set(layer.parentId, list); }
  for (const [parent, list] of children) children.set(parent, sorted(list));
  const stack = [...(children.get(null) ?? [])].reverse().map((layer) => ({ layer, visible: true, opacity: 1 }));
  const visited = new Set<string>();
  while (stack.length) {
    const { layer, visible, opacity } = stack.pop()!;
    if (visited.has(layer.id)) continue;
    visited.add(layer.id);
    const commands: Primitive[] = [];
    for (const v of sorted([...visuals.values()].filter((v) => v.layerId === layer.id))) {
      // Resolve source-local visual hierarchy, then its rigid body attachment.
      const worldPoint = (p: Vec2): Vec2 => {
        let at = transformed(p, v.transform), parent = v.parentId, body = v.bodyId, depth = 0;
        while (parent && depth++ < visuals.size) {
          const pv = visuals.get(parent); if (!pv) break;
          at = transformed(at, pv.transform); body = pv.bodyId ?? body; parent = pv.parentId;
        }
        return plus(at, bodyPosition(body));
      };
      if (v.source.kind === 'shape') commands.push(primitive(shapePoints(v.source.shape).map(worldPoint), v.source.fill, v.id, true, true));
      // Raster/SVG loading belongs to ML-015; mark existing references instead of claiming to decode them.
      else commands.push(primitive(([[0, 0], [16, 0], [16, 16], [0, 16]] as Vec2[]).map(worldPoint), '#a5bbb3', `${v.id} (asset)`, true));
      if (commands.length) commands[commands.length - 1] = { ...commands[commands.length - 1]!, objectId: v.id };
    }
    const inherited = { visible: visible && layer.visible, opacity: opacity * layer.opacity };
    const t = layer.kind === 'tile' ? model.terrain?.byLayer.get(layer.id) : undefined;
    const terrain: TerrainArt | undefined = t && { grid: gridOf(t), cells: t.cells, tiles: tileArt(tilesets.get(t.settings.tilesetId as string)) };
    order.push({ layer, commands, ...inherited, ...(terrain ? { terrain } : {}) });
    const descendants = children.get(layer.id) ?? [];
    for (let i = descendants.length - 1; i >= 0; i--) stack.push({ layer: descendants[i]!, ...inherited });
  }
  const passes = new Map<Overlay, Primitive[]>();
  const add = (name: Overlay, p: Primitive): void => { const list = passes.get(name) ?? []; list.push(p); passes.set(name, list); };
  for (const f of footholds.values()) {
    const pos = bodyPosition(f.ownerBodyId), a = plus(f.a, pos), b = plus(f.b, pos);
    add('Footholds', primitive([a, b], f.enabled ? '#ffcf60' : '#796d4c', f.id));
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    add('Footholds', primitive([mid, [mid[0] + dy / len * 16, mid[1] - dx / len * 16]], '#ffcf60'));
  }
  for (const b of bodies.values()) for (const s of b.shapes) add('Collision', primitive(shapePoints(s).map((p) => plus(p, b.position)), b.enabled ? '#ff8c88' : '#85565a', `${b.id}/${s.id}`, s.kind !== 'segment'));
  for (const t of records<Traversal>(model, 'traversals')) {
    const points = t.kind === 'scripted' ? [resolve(t.from), resolve(t.to)].filter((p): p is Vec2 => p !== null) : t.points;
    if (points.length) add('Traversal', primitive(points, '#cbb4ff', t.id));
  }
  for (const r of regions.values()) add('Regions & triggers', primitive(shapePoints(r.shape), '#75d6c6', r.id, true));
  for (const e of entities.values()) {
    const p = resolve(e.anchor); if (!p) continue;
    // World-sized marker; its ID is CSS-sized. Actor simulation is a later task.
    add('Spawns & routes', primitive([[p[0] - 4, p[1]], [p[0], p[1] - 8], [p[0] + 4, p[1]], [p[0] - 4, p[1]]], '#f4baef', e.id));
  }
  const waypoints = new Map(records<Waypoint>(model, 'waypoints').map((w) => [w.id, w]));
  for (const w of waypoints.values()) { const p = resolve(w.anchor); if (p) add('Spawns & routes', primitive([[p[0] - 3, p[1]], [p[0], p[1] - 3], [p[0] + 3, p[1]], [p[0], p[1] + 3]], '#f4baef', w.id, true)); }
  for (const r of records<Route>(model, 'routes')) {
    const ps = r.waypointIds.map((id) => waypoints.get(id)).map((w) => w ? resolve(w.anchor) : null).filter((p): p is Vec2 => p !== null);
    if (ps.length) add('Spawns & routes', primitive(ps, '#f4baef', r.id, r.mode === 'loop'));
  }
  // Only authored intent/zone outlines: no fabricated navigation graph, camera simulation or engine effects.
  type Zones = { readonly zones?: readonly { readonly id: string; readonly regionId: string }[] };
  type Navigation = { readonly modeVolumes: readonly { readonly id: string; readonly regionId: string }[]; readonly overrides: readonly { readonly id: string; readonly regionId: string }[]; readonly links: readonly { readonly id: string; readonly from: Anchor; readonly to: Anchor }[] };
  for (const [field, pass, color] of [['camera', 'Camera', '#96b9ff'], ['environment', 'Audio/env zones', '#bdda83']] as const) {
    const zones = model.fields.get(field) as unknown as Zones | undefined;
    for (const z of zones?.zones ?? []) { const r = regions.get(z.regionId); if (r) add(pass, primitive(shapePoints(r.shape), color, z.id, true)); }
  }
  const nav = model.fields.get('navigation') as unknown as Navigation | undefined;
  for (const n of [...(nav?.modeVolumes ?? []), ...(nav?.overrides ?? [])]) { const r = regions.get(n.regionId); if (r) add('Navigation', primitive(shapePoints(r.shape), '#97d9ff', `${n.id} (intent)`, true)); }
  for (const n of nav?.links ?? []) { const a = resolve(n.from), b = resolve(n.to); if (a && b) add('Navigation', primitive([a, b], '#97d9ff', `${n.id} (intent)`)); }
  const bounds = mapBounds(model);
  add('Bounds', primitive(shapePoints({ kind: 'rect', rect: bounds }), '#e7f0ed', 'Map bounds', true));
  return { bounds, art: order, passes };
}
