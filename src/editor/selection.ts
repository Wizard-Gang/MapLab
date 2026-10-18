// External per-document selection/gesture session; only commit() may cross into authored history.
import { physicalHandles, moveHandle, type PhysicalHandle } from './geometry';
import { worldToCss } from '../render/transform';
import type { Vec2 } from '../contracts';
import type { MapModel } from '../domain/model';
import type { Transaction } from '../domain/transaction';
import { cascade, copySelection, deleteSelection, dependents, keyOf, moveSelection, pasteSelection, recordOf, type ObjectKey } from './editing';
import { cssToWorld, snapWorld } from '../render/transform';
import { PickIndex, type PickMode } from '../render/picking';
import type { ViewportState } from './viewport';

export interface SelectionState {
  readonly keys: readonly ObjectKey[];
  readonly mode: PickMode;
  readonly delta: Vec2;
  readonly handlePreview: { readonly handle: PhysicalHandle; readonly point: Vec2 } | null;
  readonly marquee: readonly [Vec2, Vec2] | null;
  readonly message: string;
  readonly deleting: readonly ObjectKey[] | null;
  readonly cascadePreview: boolean;
}
export class SelectionSession {
  private state: SelectionState = { keys: [], mode: 'All', handlePreview: null, delta: [0, 0], marquee: null, message: '', deleting: null, cascadePreview: false };
  private listeners = new Set<() => void>();
  private drag: { base: MapModel; start: Vec2; css: Vec2; index: PickIndex; state: ViewportState; keys: readonly ObjectKey[]; before: readonly ObjectKey[]; marquee: boolean; shift: boolean; moved: boolean } | null = null;
  private handleDrag: { base: MapModel; handle: PhysicalHandle; view: ViewportState; point: Vec2; css: Vec2; moved: boolean } | null = null;
  constructor(private readonly model: () => MapModel, private readonly commit: (tx: Transaction) => boolean, private readonly editable: () => boolean) {}
  readonly getSnapshot = (): SelectionState => this.state;
  readonly subscribe = (f: () => void): (() => void) => { this.listeners.add(f); return () => this.listeners.delete(f); };
  private set(patch: Partial<SelectionState>): void { this.state = { ...this.state, ...patch }; for (const f of this.listeners) f(); }
  message(message: string): void { this.set({ message }); }
  mode(mode: PickMode): void { this.cancel(); this.set({ mode }); }
  select(keys: readonly ObjectKey[], toggle = false): void {
    this.cancel();
    const next = new Map((toggle ? this.state.keys : []).map((k) => [keyOf(k), k]));
    for (const k of keys) if (toggle && next.has(keyOf(k))) next.delete(keyOf(k)); else next.set(keyOf(k), k);
    this.set({ keys: [...next.values()], deleting: null, message: '' });
  }
  sync(): void {
    if (this.handleDrag && this.handleDrag.base !== this.model()) this.cancel();
    if (this.drag && this.drag.base !== this.model()) this.cancel();
    const keys = this.state.keys.filter((k) => recordOf(this.model(), k));
    if (keys.length !== this.state.keys.length) this.set({ keys });
    // A command/reload invalidates a pending delete preview, even when the same IDs still exist.
    if (this.state.deleting) this.set({ deleting: null, cascadePreview: false });
  }
  down(at: Vec2, index: PickIndex, state: ViewportState, shift: boolean, cycle: boolean): void {
    this.cancel();
    if (this.editable() && ['Platforms', 'Collision'].includes(this.state.mode)) {
      const handles = physicalHandles(this.model(), this.state.keys);
      const handle = handles.find(h => { const p = worldToCss(state.view, h.point); return Math.hypot(p[0]-at[0], p[1]-at[1]) <= 7; });
      if (handle) { this.handleDrag = { base: this.model(), handle, view: state, point: handle.point, css: at, moved: false }; return; }
    }
    const before = this.state.keys, hits = index.pick(at, state, this.state.mode);
    let hit = hits[0];
    if (cycle && hits.length) { const i = hits.findIndex((k) => before.some((s) => keyOf(s) === keyOf(k))); hit = hits[(i + 1) % hits.length]; }
    if (hit) {
      if (shift || cycle || !before.some((k) => keyOf(k) === keyOf(hit!))) this.select([hit], shift);
    } else if (!shift) this.select([]);
    const world = cssToWorld(state.view, at);
    this.drag = { base: this.model(), start: world, css: at, index, state, keys: this.state.keys, before, marquee: !hit, shift, moved: false };
  }
  move(at: Vec2): void {
    const h = this.handleDrag;
    if (h) {
      if (h.base !== this.model()) { this.cancel(); return; }
      if (!h.moved && Math.hypot(at[0]-h.css[0], at[1]-h.css[1]) < 3) return;
      h.moved = true; h.point = snapWorld(cssToWorld(h.view.view, at), h.view.snap);
      this.set({ handlePreview: { handle: h.handle, point: h.point }, message: 'Physical handle preview — release to commit; Escape cancels' }); return;
    }
    const d = this.drag; if (!d) return;
    if (d.base !== this.model()) { this.cancel(); return; }
    if (Math.hypot(at[0] - d.css[0], at[1] - d.css[1]) < 3 && !d.moved) return;
    d.moved = true;
    const world = cssToWorld(d.state.view, at);
    if (d.marquee) this.set({ marquee: [d.start, world] });
    else if (this.editable()) {
      const start = snapWorld(d.start, d.state.snap), end = snapWorld(world, d.state.snap);
      this.set({ delta: [end[0] - start[0], end[1] - start[1]], message: 'Move preview — release to commit; Escape cancels' });
    }
  }
  end(): void {
    const h = this.handleDrag;
    if (h) { this.handleDrag = null; this.set({ handlePreview: null }); if (h.moved && h.base === this.model()) this.run(() => moveHandle(h.base, h.handle, h.point)); return; }
    const d = this.drag; if (!d) return;
    const { delta, marquee } = this.state;
    this.drag = null; this.set({ delta: [0, 0], marquee: null });
    if (d.base !== this.model()) { this.message('Document changed; gesture cancelled'); return; }
    if (d.marquee && marquee) {
      const keys = d.index.marquee(...marquee, d.state, this.state.mode), combined = new Map((d.shift ? d.before : []).map((k) => [keyOf(k), k]));
      for (const k of keys) combined.set(keyOf(k), k);
      this.set({ keys: [...combined.values()], message: '' });
    } else if (d.moved && delta.some((v) => v !== 0)) this.run(() => moveSelection(d.base, d.keys, delta));
    else this.message('');
  }
  cancel(): boolean {
    const h = this.handleDrag; this.handleDrag = null;
    if (h) this.set({ handlePreview: null, message: 'Gesture cancelled' });
    const d = this.drag; this.drag = null;
    if (d) this.set({ keys: d.before, delta: [0, 0], marquee: null, message: 'Gesture cancelled' });
    return d !== null || h !== null;
  }
  escape(): void { if (!this.cancel()) this.set({ keys: [], deleting: null, message: '', delta: [0, 0], marquee: null }); }
  run(build: () => Transaction): boolean {
    if (!this.editable()) { this.message('This document is locked for editing'); return false; }
    this.cancel();
    try { return this.commit(build()); } catch (e) { this.message(e instanceof Error ? e.message : String(e)); return false; }
  }
  copy(): string { return copySelection(this.model(), this.state.keys); }
  paste(text: string): void {
    let keys: ObjectKey[] = [];
    if (this.run(() => { const p = pasteSelection(this.model(), text); keys = p.keys; return p.tx; })) this.set({ keys });
  }
  duplicate(): void { if (this.state.keys.length) this.paste(this.copy()); }
  askDelete(): void { this.cancel(); if (this.state.keys.length && this.editable()) this.set({ deleting: this.state.keys, cascadePreview: false }); }
  cancelDelete(): void { this.set({ deleting: null, cascadePreview: false }); }
  previewCascade(): void {
    if (!this.state.deleting) return;
    const plan = cascade(this.model(), this.state.deleting);
    if (plan.blocked.length) { this.message(`Retarget document/terrain dependents first: ${plan.blocked.map((r) => r.path).join(', ')}`); return; }
    this.set({ deleting: plan.keys, cascadePreview: true });
  }
  delete(target?: string): void {
    const keys = this.state.deleting;
    if (keys && this.run(() => deleteSelection(this.model(), keys, target))) this.set({ keys: [], deleting: null, cascadePreview: false });
  }
  references() { return dependents(this.model(), this.state.deleting ?? []); }
}
