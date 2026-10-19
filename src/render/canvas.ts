// Two canvases; coalesced dirty passes. Viewport input never rebuilds the authored scene.
import type { Rect, Vec2 } from '../contracts/common-types';
import type { ViewportState } from '../editor/viewport';
import { backingSize, canvasMatrix, backgroundShift, backgroundView, repeatRange, scaleOf, cssLengthInWorld, floorDiv, visibleWorld, type ViewTransform } from './transform';
import { DecodedImages } from './assets';
import type { Primitive, Scene, TileArt } from './scene';
import { drawPreview, drawTerrain } from './terrain';
import type { TerrainPreview } from '../editor/terrain-session';

const overlaps = (a: Rect, b: Rect): boolean => a[0] <= b[0] + b[2] && a[0] + a[2] >= b[0] && a[1] <= b[1] + b[3] && a[1] + a[3] >= b[1];
function draw(ctx: CanvasRenderingContext2D, list: readonly Primitive[], view: ViewTransform, size: Vec2, images?: DecodedImages): void {
  const rect = visibleWorld(view, size), pad = cssLengthInWorld(view, 160);
  const visible: Rect = [rect[0] - pad, rect[1] - pad, rect[2] + 2 * pad, rect[3] + 2 * pad];
  ctx.lineWidth = cssLengthInWorld(view, 1.5);
  ctx.font = `${cssLengthInWorld(view, 11)}px system-ui`;
  for (const p of list) {
    if (!overlaps(p.bounds, visible) || !p.points.length) continue;
    if (p.image && images) {
      const m=p.image.matrix;const decoded=images.get(p.image.asset,scaleOf(view)*Math.max(Math.hypot(m[0],m[1]),Math.hypot(m[2],m[3]))/p.image.asset.wuPerAssetUnit);
      if(decoded){ctx.save();ctx.transform(...p.image.matrix);ctx.drawImage(decoded.source,0,0,p.image.asset.size[0],p.image.asset.size[1]);ctx.restore();continue;}
    }
    ctx.beginPath(); ctx.moveTo(...p.points[0]!);
    for (const point of p.points.slice(1)) ctx.lineTo(...point);
    if (p.closed) ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle = p.color;
    if (p.fill) ctx.fill(); else ctx.stroke();
    if (p.label) { const a = p.points[0]!; ctx.fillText(p.label, a[0] + cssLengthInWorld(view, 4), a[1] - cssLengthInWorld(view, 5)); }
  }
}
function grid(ctx: CanvasRenderingContext2D, state: ViewportState): void {
  const { view, size, snap } = state;
  const rect = visibleWorld(view, size);
  ctx.strokeStyle = '#31433c'; ctx.lineWidth = cssLengthInWorld(view, 1);
  for (const axis of [0, 1] as const) {
    // Decimate display only; snap settings and source geometry are unchanged. At most one line per 12 CSS px.
    let step = snap.spacing[axis];
    while (step / cssLengthInWorld(view, 1) < 12) step *= 2;
    const first = floorDiv(rect[axis] - snap.origin[axis], step);
    const count = Math.ceil(rect[axis + 2]! / step) + 2;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const n = snap.origin[axis] + (first + i) * step;
      if (axis === 0) { ctx.moveTo(n, rect[1]); ctx.lineTo(n, rect[1] + rect[3]); }
      else { ctx.moveTo(rect[0], n); ctx.lineTo(rect[0] + rect[2], n); }
    }
    ctx.stroke();
  }
}

export class CanvasViewport {
  private readonly images = new DecodedImages(() => { this.artDirty = true; if(this.frame===null)this.frame=requestAnimationFrame(()=>this.render()); }, (s) => this.notice(s));
  private handles: readonly Primitive[] = [];
  setHandles(handles: readonly Primitive[]): void {
    this.handles = handles; this.overlayDirty = true;
    if (this.frame === null) this.frame = requestAnimationFrame(() => this.render());
  }
  private preview: { readonly preview: TerrainPreview; readonly count: number; readonly art: TileArt | undefined } | null = null;
  /** A terrain gesture's affected cells, drawn on the overlay only: the art canvas keeps the committed cells. */
  setTerrainPreview(preview: TerrainPreview | null, art?: TileArt): void {
    if (preview === (this.preview?.preview ?? null) && preview?.count === this.preview?.count) return;
    this.preview = preview && { preview, count: preview.count, art }; this.overlayDirty = true;
    if (this.frame === null) this.frame = requestAnimationFrame(() => this.render());
  }
  private frame: number | null = null;
  private artDirty = true;
  private overlayDirty = true;
  private previous: ViewportState | null = null;
  private dpr = 0;
  private scene: Scene;
  private state: ViewportState;
  constructor(private readonly art: HTMLCanvasElement, private readonly overlay: HTMLCanvasElement, scene: Scene, state: ViewportState, private readonly notice: (text: string) => void = () => {}) {
    this.scene = scene; this.state = state; this.update(scene, state);
  }
  update(scene: Scene, state: ViewportState): void {
    const p = this.previous;
    const both = this.scene !== scene || !p || p.view !== state.view || p.size !== state.size;
    this.artDirty ||= both || p?.overlays.Art !== state.overlays.Art || p?.hiddenLayers !== state.hiddenLayers || p?.physicsFocus !== state.physicsFocus || p?.artTick !== state.artTick;
    this.overlayDirty ||= both || p?.snap !== state.snap || Object.entries(state.overlays).some(([name, value]) => name !== 'Art' && p?.overlays[name as keyof typeof state.overlays] !== value);
    this.previous = state; this.state = state; this.scene = scene;
    this.invalidateDpr();
    if ((this.artDirty || this.overlayDirty) && this.frame === null) this.frame = requestAnimationFrame(() => this.render());
  }
  /** Called by the resolution media query as well as resize; never poll/animate an idle viewport. */
  invalidateDpr(): void {
    if (this.dpr === window.devicePixelRatio) return;
    this.dpr = window.devicePixelRatio || 1; this.artDirty = this.overlayDirty = true;
    if (this.frame === null) this.frame = requestAnimationFrame(() => this.render());
  }
  private context(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const { size, view } = this.state, backing = backingSize(size, this.dpr);
    if (canvas.width !== backing[0]) canvas.width = backing[0];
    if (canvas.height !== backing[1]) canvas.height = backing[1];
    const ctx = canvas.getContext('2d');
    if (!ctx || size[0] <= 0 || size[1] <= 0) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(...canvasMatrix(view, [canvas.width / size[0], canvas.height / size[1]]));
    return ctx;
  }
  private rendered(canvas: HTMLCanvasElement): void { canvas.dataset.frames = String(Number(canvas.dataset.frames ?? 0) + 1); }
  private render(): void {
    this.frame = null;
    const { view, size, overlays } = this.state;
    if (this.artDirty) {
      this.notice('');this.images.beginFrame();
      const ctx = this.context(this.art);
      const hiddenLayers = new Map<string, boolean>();
      if (ctx && overlays.Art) for (const { layer, commands, visible, opacity, terrain } of this.scene.art) {
        // A hidden group hides all art descendants, but never touches physical overlays.
        const hidden = this.state.hiddenLayers.has(layer.id) || (layer.parentId !== null && hiddenLayers.get(layer.parentId) === true);
        hiddenLayers.set(layer.id, hidden);
        if (!visible || hidden || opacity === 0) continue;
        ctx.save(); ctx.globalAlpha = opacity * (this.state.physicsFocus ? 0.3 : 1);
        const artView=layer.kind==='background'?backgroundView(view,layer):view;
        ctx.setTransform(...canvasMatrix(artView,[this.art.width/size[0],this.art.height/size[1]]));
        if(terrain)drawTerrain(ctx,terrain,artView,size,this.images);
        if(layer.kind==='background') {
          const phase=backgroundShift(layer,this.state.artTick),r=visibleWorld(artView,size);
          for(const command of commands) {
            const b:Rect=[command.bounds[0]+phase[0],command.bounds[1]+phase[1],command.bounds[2],command.bounds[3]];
            const [x0,x1,y0,y1]=repeatRange(b,r,layer.repeatSize,layer.repeat);
            if((x1-x0+1)*(y1-y0+1)>4096){this.notice('Zoom in to show tightly repeated backgrounds (more than 4,096 visible copies).');continue;}
            for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++) {
              const shift:Vec2=[phase[0]+x*layer.repeatSize[0],phase[1]+y*layer.repeatSize[1]];
              ctx.save();ctx.translate(...shift);draw(ctx,[command],{...artView,camera:[artView.camera[0]-shift[0],artView.camera[1]-shift[1]]},size,this.images);ctx.restore();
            }
          }
        } else draw(ctx,commands,artView,size,this.images);
        ctx.restore();
      }
      this.images.endFrame();this.art.dataset.decodedBytes=String(this.images.lru.bytes);
      this.rendered(this.art); this.artDirty = false;
    }
    if (this.overlayDirty) {
      const ctx = this.context(this.overlay);
      if (ctx) {
        if (overlays.Grid) grid(ctx, this.state);
        for (const [name, commands] of this.scene.passes) if (overlays[name]) draw(ctx, commands, view, size);
        if (this.preview) {
          const { preview: p, art } = this.preview;
          this.overlay.dataset.previewCells = String(drawPreview(ctx, { grid: p.grid, value: p.value, xs: p.cells.xs, ys: p.cells.ys, count: p.count, outline: p.tool === 'transform' }, art, view, size));
        } else delete this.overlay.dataset.previewCells;
        draw(ctx, this.handles, view, size);
      }
      this.rendered(this.overlay); this.overlayDirty = false;
    }
  }
  dispose(): void { this.images.dispose(); if (this.frame !== null) cancelAnimationFrame(this.frame); this.frame = null; }
}
