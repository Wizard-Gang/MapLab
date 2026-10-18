// D1: CSS pixels only. DPR never enters world, picking, snapping or CSS-sized handles.
import type { Rect, Vec2 } from '../contracts/common-types';

export interface ViewTransform {
  readonly camera: Vec2;
  readonly origin: Vec2;
  readonly zoom: number;
  readonly pixelsPerWU: number;
}
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 16;
export const scaleOf = (v: ViewTransform): number => v.zoom * v.pixelsPerWU;
export const worldToCss = (v: ViewTransform, p: Vec2): Vec2 => {
  const s = scaleOf(v);
  return [v.origin[0] + (p[0] - v.camera[0]) * s, v.origin[1] + (p[1] - v.camera[1]) * s];
};
export const cssToWorld = (v: ViewTransform, p: Vec2): Vec2 => {
  const s = scaleOf(v);
  return [v.camera[0] + (p[0] - v.origin[0]) / s, v.camera[1] + (p[1] - v.origin[1]) / s];
};
/** Canvas's world affine matrix, composed with the buffer's actual rounded X/Y ratios. */
export function canvasMatrix(v: ViewTransform, ratio: Vec2): [number, number, number, number, number, number] {
  const p = worldToCss(v, [0, 0]), s = scaleOf(v);
  return [s * ratio[0], 0, 0, s * ratio[1], p[0] * ratio[0], p[1] * ratio[1]];
}
export const cssLengthInWorld = (v: ViewTransform, css: number): number => css / scaleOf(v);
export function panBy(v: ViewTransform, deltaCss: Vec2): ViewTransform {
  const s = scaleOf(v);
  return { ...v, camera: [v.camera[0] - deltaCss[0] / s, v.camera[1] - deltaCss[1] / s] };
}
export function zoomAt(v: ViewTransform, pointerCss: Vec2, zoom: number): ViewTransform {
  const world = cssToWorld(v, pointerCss);
  const next = { ...v, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) };
  const s = scaleOf(next);
  return { ...next, camera: [world[0] - (pointerCss[0] - v.origin[0]) / s, world[1] - (pointerCss[1] - v.origin[1]) / s] };
}
export function visibleWorld(v: ViewTransform, size: Vec2): Rect {
  const a = cssToWorld(v, [0, 0]), b = cssToWorld(v, size);
  return [a[0], a[1], b[0] - a[0], b[1] - a[1]];
}
export function fitBounds(bounds: Rect, size: Vec2, pixelsPerWU = 1): ViewTransform {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(Math.max(1, size[0] - 40) / bounds[2], Math.max(1, size[1] - 40) / bounds[3]) / pixelsPerWU));
  const s = zoom * pixelsPerWU;
  return { zoom, pixelsPerWU, origin: [0, 0], camera: [bounds[0] + bounds[2] / 2 - size[0] / (2 * s), bounds[1] + bounds[3] / 2 - size[1] / (2 * s)] };
}
export function resizeView(v: ViewTransform, from: Vec2, to: Vec2): ViewTransform {
  return panBy(v, [(to[0] - from[0]) / 2, (to[1] - from[1]) / 2]);
}
/** Mathematical floor division, including negative cells/chunks. */
export function floorDiv(n: number, d: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) throw new RangeError('floorDiv needs a finite numerator and positive divisor');
  return Math.floor(n / d);
}
export const roundAway = (n: number): number => (n < 0 ? -Math.floor(-n + 0.5) : Math.floor(n + 0.5)) || 0;
export const quantize = (n: number): number => roundAway(n * 16) / 16;
export interface SnapSettings { readonly free: boolean; readonly spacing: Vec2; readonly origin: Vec2 }
/** Explicit grid first, then serialization quantum. Pointer previews otherwise stay unquantized. */
export function snapWorld(p: Vec2, snap: SnapSettings): Vec2 {
  if (snap.free) return [quantize(p[0]), quantize(p[1])];
  const axis = (n: number, i: 0 | 1): number => {
    const step = snap.spacing[i], origin = snap.origin[i];
    if (!Number.isFinite(step) || step <= 0 || quantize(step) !== step || !Number.isFinite(origin) || quantize(origin) !== origin) throw new RangeError('Snap grid must be on the 1/16 WU quantum');
    const cell = floorDiv(n - origin, step);
    // Ties are away from the grid origin, including in negative space.
    const fraction = (n - origin) / step - cell;
    const index = fraction < 0.5 ? cell : fraction > 0.5 ? cell + 1 : (n < origin ? cell : cell + 1);
    return quantize(origin + index * step);
  };
  return [axis(p[0], 0), axis(p[1], 1)];
}
/** Backing dimensions are the sole DPR boundary. CSS size is never multiplied elsewhere. */
export const backingSize = (size: Vec2, dpr: number): Vec2 => [Math.max(1, Math.round(size[0] * dpr)), Math.max(1, Math.round(size[1] * dpr))];
