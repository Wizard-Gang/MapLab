// External per-document terrain tool session (R1 H2 Session store). The preview is a set of affected cells held here,
// never in the model or history; release commits one transaction; Escape, pointer cancellation, lost capture, focus
// loss, resize and a document change discard it. The fill snapshots its target model at pointer-down.
import type { Cell, TilesetDocument, Vec2 } from '../contracts';
import type { MapModel } from '../domain/model';
import type { Transaction } from '../domain/transaction';
import { CellSet, FillJob, GESTURE_CELL_LIMIT, TOOL_LABELS, boundsCells, cellAt, cellInRange, cellProblem, gridOf, lineCells, paintCells, rectArea, rectCells,
  type CellXY, type Grid, type TerrainTool } from './terrain';

export interface TerrainPreview {
  readonly layerId: string;
  readonly grid: Grid;
  readonly tool: TerrainTool;
  /** The value every affected cell receives: the palette cell, or null to erase. */
  readonly value: Cell | null;
  readonly cells: CellSet;
  readonly count: number;
}
export interface TerrainState {
  readonly tool: TerrainTool;
  readonly layerId: string | null;
  readonly tile: Cell | null;
  readonly preview: TerrainPreview | null;
  readonly message: string;
}
interface Stroke {
  readonly base: MapModel; readonly layerId: string; readonly grid: Grid; readonly tool: TerrainTool; readonly value: Cell | null;
  readonly start: CellXY; last: CellXY; cells: CellSet; job: FillJob | null;
}
/** A fill runs in slices of this many cells, so a large region never blocks input and stays cancellable. */
const FILL_SLICE = 8_192;

export class TerrainSession {
  private state: TerrainState = { tool: 'brush', layerId: null, tile: null, preview: null, message: '' };
  private readonly listeners = new Set<() => void>();
  private stroke: Stroke | null = null;
  constructor(
    private readonly model: () => MapModel,
    private readonly tileset: (id: string) => TilesetDocument | undefined,
    private readonly commit: (tx: Transaction) => boolean,
    private readonly editable: () => boolean,
    private readonly schedule: (run: () => void) => void = (run) => { setTimeout(run, 0); },
  ) {}
  readonly getSnapshot = (): TerrainState => this.state;
  readonly subscribe = (f: () => void): (() => void) => { this.listeners.add(f); return () => this.listeners.delete(f); };
  private set(patch: Partial<TerrainState>): void { this.state = { ...this.state, ...patch }; for (const f of this.listeners) f(); }
  message(message: string): void { this.set({ message }); }

  /** The active terrain layer: the chosen one while it exists, otherwise the first in the document. */
  layerId(m = this.model()): string | null {
    const order = m.terrain?.order ?? [];
    return this.state.layerId !== null && order.includes(this.state.layerId) ? this.state.layerId : (order[0] ?? null);
  }
  tilesetOf(m = this.model()): TilesetDocument | undefined {
    const id = this.layerId(m), layer = id === null ? undefined : m.terrain?.byLayer.get(id);
    return typeof layer?.settings.tilesetId === 'string' ? this.tileset(layer.settings.tilesetId) : undefined;
  }
  grid(m = this.model()): Grid | null { const id = this.layerId(m), layer = id === null ? undefined : m.terrain?.byLayer.get(id); return layer ? gridOf(layer) : null; }
  tool(tool: TerrainTool): void { this.cancel(); this.set({ tool, message: '' }); }
  layer(layerId: string): void { this.cancel(); this.set({ layerId, message: '' }); }
  /** Chooses the palette cell. A transform the tileset forbids is refused, never stored. */
  choose(tile: Cell): void {
    this.cancel();
    const problem = cellProblem(this.tilesetOf(), tile);
    if (problem) this.set({ message: problem }); else this.set({ tile, message: '' });
  }

  private publish(s: Stroke, message = ''): void {
    this.set({ preview: { layerId: s.layerId, grid: s.grid, tool: s.tool, value: s.value, cells: s.cells, count: s.cells.size }, message });
  }

  /** Pointer-down at a world point. False when no gesture starts (locked, no layer, no tile or a refused tile). */
  down(world: Vec2): boolean {
    this.cancel();
    if (!this.editable()) { this.message('This document is locked for editing'); return false; }
    const base = this.model(), layerId = this.layerId(base), grid = this.grid(base);
    if (layerId === null || grid === null) { this.message('This map has no terrain layer to paint'); return false; }
    const tool = this.state.tool;
    let value: Cell | null = null;
    if (tool !== 'erase') {
      if (!this.state.tile) { this.message('Choose a tile from the palette first'); return false; }
      const problem = cellProblem(this.tilesetOf(base), this.state.tile);
      if (problem) { this.message(problem); return false; }
      value = this.state.tile;
    }
    const start = cellAt(grid, world), cells = new CellSet();
    const s: Stroke = { base, layerId, grid, tool, value, start, last: start, cells, job: null };
    this.stroke = s;
    if (tool === 'fill') {
      const store = base.terrain!.byLayer.get(layerId)!.cells;
      s.job = new FillJob(store, start, boundsCells(grid, base.fields.get('bounds') as unknown as [number, number, number, number]));
      s.cells = s.job.cells;
      this.runFill(s);
    } else {
      cells.add(start[0], start[1]);
      this.publish(s, `${TOOL_LABELS[tool]} preview — release to commit; Escape cancels`);
    }
    return true;
  }

  private runFill(s: Stroke): void {
    const job = s.job!;
    job.step(FILL_SLICE);
    if (this.stroke !== s) return;
    if (job.status === 'running') { this.publish(s, `Filling… ${job.cells.size} cells`); this.schedule(() => { if (this.stroke === s && job.status === 'running') this.runFill(s); }); return; }
    const notes: Record<string, string> = {
      done: `Fill preview: ${job.cells.size} cells — release to commit; Escape cancels`,
      exceeded: `Fill region exceeds ${GESTURE_CELL_LIMIT.toLocaleString('en-US')} cells; release records nothing`,
      outside: 'Fill starts outside the map bounds; release records nothing',
      cancelled: 'Fill cancelled',
    };
    this.publish(s, notes[job.status]);
  }

  move(world: Vec2): void {
    const s = this.stroke;
    if (!s) return;
    if (s.base !== this.model()) { this.cancel('Document changed; gesture cancelled'); return; }
    const cell = cellAt(s.grid, world);
    if (cell[0] === s.last[0] && cell[1] === s.last[1]) return;
    if (s.tool === 'brush' || s.tool === 'erase') s.cells.addAll(lineCells(s.last, cell));
    else if (s.tool === 'rect') {
      s.cells = new CellSet();
      if (rectArea(s.start, cell) > GESTURE_CELL_LIMIT) s.cells.over = true; else s.cells.addAll(rectCells(s.start, cell));
    } else if (s.tool === 'line') { s.cells = new CellSet(); s.cells.addAll(lineCells(s.start, cell)); }
    s.last = cell;
    if (s.tool !== 'fill') this.publish(s, s.cells.over ? `More than ${GESTURE_CELL_LIMIT.toLocaleString('en-US')} cells; release records nothing` : `${TOOL_LABELS[s.tool]} preview: ${s.cells.size} cells — release to commit; Escape cancels`);
  }

  /** Release: one transaction for the whole gesture, or nothing for a refused, stale or no-op gesture. */
  end(): void {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    this.set({ preview: null });
    if (s.base !== this.model()) { this.message('Document changed; gesture cancelled'); return; }
    if (s.job?.status === 'running') while (s.job.step(FILL_SLICE) === 'running');
    if (s.job && s.job.status !== 'done') { this.message(s.job.status === 'exceeded' ? `Fill refused: the region exceeds ${GESTURE_CELL_LIMIT.toLocaleString('en-US')} cells` : 'Fill refused: start inside the map bounds'); return; }
    if (s.cells.over) { this.message(`Paint refused: more than ${GESTURE_CELL_LIMIT.toLocaleString('en-US')} cells in one gesture`); return; }
    for (const cell of s.cells.cells()) if (!cellInRange(s.grid, cell)) { this.message('Paint refused: a cell lies outside the ±131,072 WU world range'); return; }
    let tx: Transaction;
    try { tx = paintCells(s.base, s.layerId, s.cells.cells(), s.value, TOOL_LABELS[s.tool]); } catch (e) { this.message(e instanceof Error ? e.message : String(e)); return; }
    if (tx.ops.length === 0) { this.message('No change'); return; }
    this.message(this.commit(tx) ? '' : 'Terrain edit refused; see the edit notice');
  }

  /** Discards a gesture without touching the document or history. True when one was active. */
  cancel(message = 'Gesture cancelled'): boolean {
    const s = this.stroke;
    if (!s) return false;
    s.job?.cancel();
    this.stroke = null;
    this.set({ preview: null, message });
    return true;
  }
  /** A committed edit, undo or reload: a gesture previewing an older model can no longer commit. */
  sync(): void { if (this.stroke && this.stroke.base !== this.model()) this.cancel('Document changed; gesture cancelled'); }
}
