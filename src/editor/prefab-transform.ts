// Prefab coordinates are source world coordinates around pivot; body/visual/anchor local frames stay local.
import type { Anchor, BodyShape, RegionShape, Vec2 } from '../contracts';
import type { PrefabContent } from '../contracts/document-types';
import type { Rect } from '../contracts/common-types';
export function transformContent(content: PrefabContent, pivot: Vec2, position: Vec2, mirror: boolean): PrefabContent {
  const point = (p: Vec2): Vec2 => [position[0] + (mirror ? -1 : 1) * (p[0] - pivot[0]), position[1] + p[1] - pivot[1]];
  const local = (p: Vec2): Vec2 => [mirror ? -p[0] || 0 : p[0], p[1]];
  const rect = (r: Rect, world: boolean): Rect => { const p = (world ? point : local)([r[0] + (mirror ? r[2] : 0), r[1]]); return [...p, r[2], r[3]]; };
  const shape = <T extends BodyShape | RegionShape>(s: T, world: boolean): T => {
    const p = world ? point : local;
    if (s.kind === 'rect') return { ...s, rect: rect(s.rect, world) };
    if (s.kind === 'circle') return { ...s, center: p(s.center) };
    if (s.kind === 'segment') return { ...s, a: p(s.a), b: p(s.b) };
    const points = s.points.map(p); return { ...s, points: mirror ? points.reverse() : points };
  };
  const anchor = (a: Anchor): Anchor => a.kind === 'surface' ? { ...a, u: mirror ? 1 - a.u : a.u }
    : { ...a, point: (a.kind === 'world' ? point : local)(a.point) };
  const edge = <T extends { bodyId: string; shapeId: string; edgeIndex: number }>(e: T): T => {
    if (!mirror) return e;
    const s = content.bodies.find(b => b.id === e.bodyId)?.shapes.find(s => s.id === e.shapeId);
    if (!s) throw Error('Prefab edge has no internal collider');
    return { ...e, edgeIndex: s.kind === 'rect' ? [0, 3, 2, 1][e.edgeIndex]! : s.kind === 'polygon' ? (s.points.length - 2 - e.edgeIndex + s.points.length) % s.points.length : 0 };
  };
  return { ...content,
    visuals: content.visuals.map(v => v.parentId !== null ? v : { ...v, transform: { ...v.transform,
      position: (v.bodyId === null ? point : local)(v.transform.position), rotation: mirror ? -v.transform.rotation || 0 : v.transform.rotation,
      mirrorX: mirror ? !v.transform.mirrorX : v.transform.mirrorX } }),
    bodies: content.bodies.map(b => ({ ...b, position: point(b.position), shapes: b.shapes.map(s => shape(s, false)),
      motion: b.motion && { ...b.motion, points: b.motion.points.map(local) } })),
    materials: content.materials.map(m => ({ ...m, conveyorSu: mirror ? -m.conveyorSu || 0 : m.conveyorSu })),
    footholds: content.footholds.map(f => { const p = f.ownerBodyId === null ? point : local;
      const links = (ls: typeof f.connections.a) => ls.map(l => ({ ...l, endpoint: mirror ? l.endpoint === 'a' ? 'b' as const : 'a' as const : l.endpoint }));
      return { ...f, a: p(mirror ? f.b : f.a), b: p(mirror ? f.a : f.b), solidEdge: f.solidEdge && edge(f.solidEdge),
        direction: !mirror || f.direction === 'both' ? f.direction : f.direction === 'aToB' ? 'bToA' : 'aToB',
        connections: { a: links(mirror ? f.connections.b : f.connections.a), b: links(mirror ? f.connections.a : f.connections.b) } };
    }),
    traversals: content.traversals.map(t => t.kind === 'scripted' ? { ...t, from: anchor(t.from), to: anchor(t.to) }
      : 'access' in t ? { ...t, points: t.points.map(point), access: t.access.map(a => ({ ...a, anchor: anchor(a.anchor) })) }
      : { ...t, points: t.points.map(point), edge: edge(t.edge) }),
    regions: content.regions.map(r => ({ ...r, shape: shape(r.shape, true) })),
    entities: content.entities.map(e => ({ ...e, anchor: anchor(e.anchor), facing: mirror ? e.facing === 'left' ? 'right' : 'left' : e.facing,
      ...('ai' in e ? { ai: { ...e.ai, home: anchor(e.ai.home), guard: e.ai.guard && anchor(e.ai.guard) } } : {}) })),
    waypoints: content.waypoints.map(w => ({ ...w, anchor: anchor(w.anchor) })),
  };
}
