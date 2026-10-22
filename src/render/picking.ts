// Cached spatial grid, reverse painter order and geometry-aware CSS tolerance, sharing transform.ts.
import type { Layer } from '../contracts/geometry-types';
import type { Rect, Vec2 } from '../contracts/common-types';
import { objects, type ObjectKey } from '../editor/editing';
import type { MapModel } from '../domain/model';
import type { ViewportState } from '../editor/viewport';
import { backgroundShift, backgroundView, repeatRange, cssLengthInWorld, cssToWorld, type ViewTransform } from './transform';
import type { Primitive, Scene } from './scene';
import type { Overlay } from '../editor/viewport';

/** Terrain mode paints instead of picking (ML-013), so it picks nothing. */
export const PICK_MODES = ['All', 'Terrain', 'Objects', 'Platforms', 'Collision', 'Traversal', 'Gameplay', 'Navigation'] as const;
export type PickMode = (typeof PICK_MODES)[number];
export interface Pickable { readonly key: ObjectKey; readonly primitive: Primitive; readonly pass: Overlay; readonly layerId?: string; readonly background?: Extract<Layer,{kind:'background'}> }
export const overlaps = (a: Rect, b: Rect): boolean => a[0] <= b[0] + b[2] && a[0] + a[2] >= b[0] && a[1] <= b[1] + b[3] && a[1] + a[3] >= b[1];
const allowed = (p: Pickable, mode: PickMode): boolean => mode === 'All' || (mode === 'Terrain'||mode==='Navigation' ? false : mode === 'Platforms' ? p.key.collection === 'footholds' : mode === 'Collision' ? p.key.collection === 'bodies' : mode === 'Traversal' ? p.key.collection === 'traversals' : mode === 'Objects' ? p.key.collection === 'visuals' : ['entities', 'waypoints', 'regions', 'routes'].includes(p.key.collection));
function distance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
export function contains(p: Primitive, at: Vec2, tolerance: number): boolean {
  const points = p.points; if (!points.length) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j]!, b = points[i]!;
    if ((i > 0 || p.closed) && distance(at, a, b) <= tolerance) return true;
    if (p.closed && ((a[1] > at[1]) !== (b[1] > at[1])) && at[0] < (b[0] - a[0]) * (at[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside || (points.length === 1 && distance(at, points[0]!, points[0]!) <= tolerance);
}
export class PickIndex {
  readonly items: readonly Pickable[];
  private cells = new Map<string, number[]>();
  private broad: number[] = [];
  constructor(model: MapModel, readonly scene: Scene) {
    const keys = new Map(objects(model).map((k) => [k.id, k])), items: Pickable[] = [];
    const add = (p: Primitive, pass: Overlay, layerId?: string, background?: Extract<Layer,{kind:'background'}>): void => {
      const id = p.objectId ?? p.label.split('/')[0]!, key = keys.get(id);
      if (key) items.push({ key, primitive: p, pass, ...(layerId ? { layerId } : {}),...(background?{background}:{}) });
    };
    for (const { layer, commands, visible, opacity } of scene.art) {
      // Camera-space backgrounds are selected through the hierarchy; world-space repeat copies share source IDs.
      if (visible && opacity > 0 && (layer.kind !== 'background' || layer.space === 'world')) for (const p of commands) add(p, 'Art', layer.id, layer.kind==='background'?layer:undefined);
    }
    for (const [pass, commands] of scene.passes) for (const p of commands) add(p, pass);
    this.items = items;
    items.forEach(({ primitive: { bounds: b } }, i) => {
      if(items[i]!.background){this.broad.push(i);return;}
      const x0 = Math.floor(b[0] / 128), y0 = Math.floor(b[1] / 128), x1 = Math.floor((b[0] + b[2]) / 128), y1 = Math.floor((b[1] + b[3]) / 128);
      if (![x0,y0,x1,y1].every(Number.isSafeInteger) || (x1 - x0 + 1) * (y1 - y0 + 1) > 256) { this.broad.push(i); return; }
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = `${x},${y}`, list = this.cells.get(k) ?? []; list.push(i); this.cells.set(k, list); }
    });
  }
  private query(rect: Rect, state: ViewportState, mode: PickMode): Pickable[] {
    const ids = new Set(this.broad), x0 = Math.floor(rect[0] / 128), x1 = Math.floor((rect[0] + rect[2]) / 128), y0 = Math.floor(rect[1] / 128), y1 = Math.floor((rect[1] + rect[3]) / 128);
    if (![x0,x1,y0,y1].every(Number.isSafeInteger) || (x1 - x0 + 1) * (y1 - y0 + 1) > 4096) this.items.forEach((_, i) => ids.add(i));
    else for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (const i of this.cells.get(`${x},${y}`) ?? []) ids.add(i);
    const hidden = new Map<string, boolean>();
    for (const { layer } of this.scene.art) hidden.set(layer.id, state.hiddenLayers.has(layer.id) || hidden.get(layer.parentId ?? '') === true);
    return [...ids].sort((a,b)=>b-a).map(i=>this.items[i]!).filter(p=>{
      if(!allowed(p,mode)||!state.overlays[p.pass]||(p.layerId&&hidden.get(p.layerId)))return false;
      if(!p.background)return overlaps(rect,p.primitive.bounds);
      const layer=p.background,v=backgroundView(state.view,layer),shift=backgroundShift(layer,state.artTick);
      const r:Rect=[rect[0]+v.camera[0]-state.view.camera[0]-shift[0],rect[1]+v.camera[1]-state.view.camera[1]-shift[1],rect[2],rect[3]],b=p.primitive.bounds;
      const range=repeatRange(b,r,layer.repeatSize,layer.repeat);if(!range)return false;
      const [x0,x1,y0,y1]=range;
      return x0<=x1&&y0<=y1&&(x1-x0+1)*(y1-y0+1)<=4096&&(layer.repeat.includes('x')||r[0]<=b[0]+b[2]&&r[0]+r[2]>=b[0])&&(layer.repeat.includes('y')||r[1]<=b[1]+b[3]&&r[1]+r[3]>=b[1]);
    });
  }
  pick(atCss: Vec2, state: ViewportState, mode: PickMode): ObjectKey[] {
    const at=cssToWorld(state.view,atCss),t=cssLengthInWorld(state.view,6);
    const found=this.query([at[0]-t,at[1]-t,t*2,t*2],state,mode).filter(p=>{
      if(!p.background)return contains(p.primitive,at,t);
      const layer=p.background,v=cssToWorld(backgroundView(state.view,layer),atCss),shift=backgroundShift(layer,state.artTick),q:Vec2=[v[0]-shift[0],v[1]-shift[1]];
      const range=repeatRange(p.primitive.bounds,[q[0]-t,q[1]-t,t*2,t*2],layer.repeatSize,layer.repeat);if(!range)return false;
      const [x0,x1,y0,y1]=range;
      for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)if(contains(p.primitive,[q[0]-x*layer.repeatSize[0],q[1]-y*layer.repeatSize[1]],t))return true;
      return false;
    });
    return [...new Map(found.map((p) => [p.key.id, p.key])).values()];
  }
  marquee(a: Vec2, b: Vec2, state: ViewportState, mode: PickMode): ObjectKey[] {
    const rect: Rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])];
    return [...new Map(this.query(rect, state, mode).map((p) => [p.key.id, p.key])).values()];
  }
  bounds(keys: readonly ObjectKey[]): Rect | null {
    const ids = new Set(keys.map((k) => k.id)), ps = this.items.filter((p) => ids.has(p.key.id));
    if (!ps.length) return null;
    const x = Math.min(...ps.map((p) => p.primitive.bounds[0])), y = Math.min(...ps.map((p) => p.primitive.bounds[1]));
    const r = Math.max(...ps.map((p) => p.primitive.bounds[0] + p.primitive.bounds[2])), b = Math.max(...ps.map((p) => p.primitive.bounds[1] + p.primitive.bounds[3]));
    return [x, y, Math.max(1, r - x), Math.max(1, b - y)];
  }
}
/** CSS-sized selection handles and transient marquee: no authored geometry changes. */
export function selectionPrimitives(index: PickIndex, keys: readonly ObjectKey[], view: ViewTransform, delta: Vec2 = [0, 0], marquee: readonly [Vec2, Vec2] | null = null): Primitive[] {
  const ids = new Set(keys.map((k) => k.id)), half = cssLengthInWorld(view, 3), out: Primitive[] = [];
  const box = (b: Rect): Primitive => ({ points: [[b[0], b[1]], [b[0] + b[2], b[1]], [b[0] + b[2], b[1] + b[3]], [b[0], b[1] + b[3]]], bounds: b, closed: true, color: '#ffffff', fill: false, label: '' });
  for (const p of index.items) if (ids.has(p.key.id)) {
    const b = p.primitive.bounds, r: Rect = [b[0] + delta[0], b[1] + delta[1], b[2], b[3]];
    out.push(box(r));
    for (const at of [[r[0], r[1]], [r[0] + r[2], r[1] + r[3]]] as Vec2[]) out.push(box([at[0] - half, at[1] - half, 2 * half, 2 * half]));
  }
  if (marquee) { const [a, b] = marquee; out.push(box([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])])); }
  return out;
}
