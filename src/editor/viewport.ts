// Small per-document session. Camera, snap, overlay visibility and pointer preview are never authored/history.
import type { Rect, Vec2 } from '../contracts/common-types';
import { fitBounds, panBy, resizeView, zoomAt, type SnapSettings, type ViewTransform } from '../render/transform';

export const OVERLAYS = ['Art', 'Footholds', 'Collision', 'Traversal', 'Navigation', 'Spawns & routes', 'Regions & triggers', 'Camera', 'Audio/env zones', 'Grid', 'Bounds'] as const;
export type Overlay = (typeof OVERLAYS)[number];
export interface ViewportState {
  readonly view: ViewTransform;
  readonly size: Vec2;
  readonly overlays: Readonly<Record<Overlay, boolean>>;
  readonly hiddenLayers: ReadonlySet<string>;
  readonly physicsFocus: boolean;
  readonly panTool: boolean;
  readonly snap: SnapSettings;
}
export class ViewportSession {
  private state: ViewportState = { view: { camera: [0, 0], origin: [0, 0], zoom: 1, pixelsPerWU: 1 }, size: [0, 0],
    overlays: Object.fromEntries(OVERLAYS.map((n) => [n, true])) as Record<Overlay, boolean>, hiddenLayers: new Set(), physicsFocus: false, panTool: false,
    snap: { free: false, spacing: [32, 32], origin: [0, 0] } };
  private listeners = new Set<() => void>();
  private drag: { readonly id: number; readonly at: Vec2; readonly view: ViewTransform } | null = null;
  readonly getSnapshot = (): ViewportState => this.state;
  readonly subscribe = (f: () => void): (() => void) => { this.listeners.add(f); return () => this.listeners.delete(f); };
  private set(patch: Partial<ViewportState>): void { this.state = { ...this.state, ...patch }; for (const f of this.listeners) f(); }
  resize(size: Vec2, bounds: Rect): void {
    if (size[0] <= 0 || size[1] <= 0 || size.every((v, i) => v === this.state.size[i])) return;
    this.cancel();
    const view = this.state.size[0] === 0 ? fitBounds(bounds, size) : resizeView(this.state.view, this.state.size, size);
    this.set({ size, view });
  }
  fit(bounds: Rect): void { this.cancel(); this.set({ view: fitBounds(bounds, this.state.size) }); }
  zoom(at: Vec2, zoom: number): void { if (!this.drag && Number.isFinite(zoom)) this.set({ view: zoomAt(this.state.view, at, zoom) }); }
  pan(delta: Vec2): void { if (!this.drag) this.set({ view: panBy(this.state.view, delta) }); }
  toggle(name: Overlay): void { this.set({ overlays: { ...this.state.overlays, [name]: !this.state.overlays[name] } }); }
  toggleLayer(id: string): void { const hidden = new Set(this.state.hiddenLayers); if (hidden.has(id)) hidden.delete(id); else hidden.add(id); this.set({ hiddenLayers: hidden }); }
  focusPhysics(): void { this.set({ physicsFocus: !this.state.physicsFocus }); }
  panTool(): void { this.cancel(); this.set({ panTool: !this.state.panTool }); }
  snap(snap: SnapSettings): void { this.set({ snap }); }
  begin(id: number, at: Vec2): void { if (!this.drag) this.drag = { id, at, view: this.state.view }; }
  move(id: number, at: Vec2): void {
    if (!this.drag || this.drag.id !== id) return;
    this.set({ view: panBy(this.drag.view, [at[0] - this.drag.at[0], at[1] - this.drag.at[1]]) });
  }
  end(id: number): void { if (this.drag?.id === id) this.drag = null; }
  cancel(id?: number): void {
    if (!this.drag || (id !== undefined && id !== this.drag.id)) return;
    const view = this.drag.view; this.drag = null; this.set({ view });
  }
}
