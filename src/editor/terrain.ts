// ML-013 terrain painting (adopted C2/C3/F4/H2, R1 C4/D6/H3). Pure: cell coordinates, the tileset palette, brush,
// rectangle and line cell sets, and a bounded, cancellable flood fill over an immutable snapshot. A terrain gesture
// writes one `paint` operation and nothing else, so it can never change collision, footholds or any other record.
import { COORDINATE_LIMIT, type Cell, type TilesetDocument, type Vec2 } from '../contracts';
import { paintOp, transaction } from '../domain/commands';
import type { MapModel, TerrainLayerModel } from '../domain/model';
import { chunkKey, locate, type CellStore } from '../domain/paint';
import type { Transaction } from '../domain/transaction';
import { floorDiv } from '../render/transform';

export const TERRAIN_TOOLS = ['brush', 'rect', 'line', 'fill', 'erase'] as const;
export type TerrainTool = (typeof TERRAIN_TOOLS)[number];
export const TOOL_LABELS: Readonly<Record<TerrainTool, string>> = {
  brush: 'Paint terrain', rect: 'Paint terrain rectangle', line: 'Paint terrain line', fill: 'Fill terrain', erase: 'Erase terrain',
};
/**
 * Most cells one gesture may write: 64 full chunks. Its delta stays below ~1 MiB of the 64 MiB history budget
 * (R1 H3); a larger gesture is refused whole, never truncated.
 */
export const GESTURE_CELL_LIMIT = 65_536;

export type CellXY = readonly [column: number, row: number];
export interface Grid { readonly origin: Vec2; readonly cellSize: Vec2 }
/** Inclusive cell range. */
export interface CellBounds { readonly c0: number; readonly r0: number; readonly c1: number; readonly r1: number }

export const gridOf = (layer: TerrainLayerModel): Grid => ({ origin: layer.settings.origin as unknown as Vec2, cellSize: layer.settings.cellSize as unknown as Vec2 });
/** The cell containing a world point: floor division, so negative space gives negative cells and chunks. */
export const cellAt = (g: Grid, p: Vec2): CellXY => [floorDiv(p[0] - g.origin[0], g.cellSize[0]), floorDiv(p[1] - g.origin[1], g.cellSize[1])];
export const cellOrigin = (g: Grid, [c, r]: CellXY): Vec2 => [g.origin[0] + c * g.cellSize[0], g.origin[1] + r * g.cellSize[1]];
/** Whether the whole cell lies inside the ±131,072 WU world range (R1 D1), as the map contract requires. */
export function cellInRange(g: Grid, cell: CellXY): boolean {
  const [x, y] = cellOrigin(g, cell);
  return [x, y, x + g.cellSize[0], y + g.cellSize[1]].every((v) => Number.isFinite(v) && Math.abs(v) <= COORDINATE_LIMIT);
}
/** Cells that overlap the map's bounds rectangle: the region a fill may reach. */
export function boundsCells(g: Grid, bounds: readonly [number, number, number, number]): CellBounds {
  const [x, y, w, h] = bounds;
  return { c0: floorDiv(x - g.origin[0], g.cellSize[0]), r0: floorDiv(y - g.origin[1], g.cellSize[1]),
    c1: Math.ceil((x + w - g.origin[0]) / g.cellSize[0]) - 1, r1: Math.ceil((y + h - g.origin[1]) / g.cellSize[1]) - 1 };
}
const inside = (b: CellBounds, c: number, r: number): boolean => c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1;

/** Ordered set of distinct cells, refusing to grow past its limit. */
export class CellSet {
  private readonly seen = new Set<string>();
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  /** A cell was refused because the set was full. */
  over = false;
  constructor(readonly limit = GESTURE_CELL_LIMIT) {}
  get size(): number { return this.xs.length; }
  has(c: number, r: number): boolean { return this.seen.has(`${c},${r}`); }
  add(c: number, r: number): boolean {
    const key = `${c},${r}`;
    if (this.seen.has(key)) return true;
    if (this.xs.length >= this.limit) { this.over = true; return false; }
    this.seen.add(key); this.xs.push(c); this.ys.push(r);
    return true;
  }
  addAll(cells: Iterable<CellXY>): boolean { for (const [c, r] of cells) if (!this.add(c, r)) return false; return true; }
  *cells(): Generator<CellXY> { for (let i = 0; i < this.xs.length; i++) yield [this.xs[i]!, this.ys[i]!]; }
}

/** Integer Bresenham line from `a` to `b`, both included. Deterministic for a given direction. */
export function* lineCells(a: CellXY, b: CellXY): Generator<CellXY> {
  let [x, y] = a;
  const [x1, y1] = b, dx = Math.abs(x1 - x), dy = -Math.abs(y1 - y), sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    yield [x, y];
    if (x === x1 && y === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}
export const rectArea = (a: CellXY, b: CellXY): number => (Math.abs(a[0] - b[0]) + 1) * (Math.abs(a[1] - b[1]) + 1);
/** Every cell of the rectangle spanned by two corner cells, row-major. */
export function* rectCells(a: CellXY, b: CellXY): Generator<CellXY> {
  const c0 = Math.min(a[0], b[0]), c1 = Math.max(a[0], b[0]), r0 = Math.min(a[1], b[1]), r1 = Math.max(a[1], b[1]);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) yield [c, r];
}

/** One palette entry: a tileset tile with the transforms that tileset permits (adopted C2). */
export interface PaletteTile {
  readonly id: string;
  readonly quarterTurns: readonly (0 | 1 | 2 | 3)[];
  readonly mirrorX: boolean;
  readonly mirrorY: boolean;
  readonly terrainId: string | null;
  readonly color: string | null;
}
export const palette = (t: TilesetDocument): PaletteTile[] => t.tiles.map((tile) => ({
  id: tile.id, quarterTurns: tile.allowedQuarterTurns.filter((q): q is 0 | 1 | 2 | 3 => [0, 1, 2, 3].includes(q)),
  mirrorX: tile.allowMirrorX, mirrorY: tile.allowMirrorY, terrainId: tile.terrainId, color: tile.visual.kind === 'shape' ? tile.visual.fill : null,
}));
/** Why the tileset does not permit `cell`, or null. A tile edit never relaxes the tileset's transform permissions. */
export function cellProblem(t: TilesetDocument | undefined, cell: Cell): string | null {
  if (!t) return 'The terrain layer\'s tileset is not available in this library';
  const tile = t.tiles.find((x) => x.id === cell.tileId);
  if (!tile) return `${t.id} has no tile ${cell.tileId}`;
  if (!tile.allowedQuarterTurns.includes(cell.quarterTurns)) return `${cell.tileId} does not allow ${cell.quarterTurns} quarter turn(s)`;
  if ((cell.mirrorX && !tile.allowMirrorX) || (cell.mirrorY && !tile.allowMirrorY)) return `${cell.tileId} does not allow that mirror`;
  return null;
}

/** Packed value of one cell in a store (0 is empty). Reading never copies a chunk. */
export function packedAt(store: CellStore, c: number, r: number): number {
  const at = locate(c, r);
  return store.chunks.get(chunkKey(at.column, at.row))?.[at.index] ?? 0;
}

export type FillStatus = 'running' | 'done' | 'exceeded' | 'outside' | 'cancelled';
const STEPS: readonly CellXY[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Four-connected flood fill of the cells equal to the start cell, over a snapshot store that is never written
 * (published chunks are immutable). The region is bounded by `bounds` and by `limit` cells: past the limit the job
 * stops as `exceeded` rather than truncating. It advances in steps, so a caller can slice or cancel it.
 */
export class FillJob {
  status: FillStatus = 'running';
  readonly cells: CellSet;
  readonly target: number;
  /** Visited bits per chunk: the frontier only ever touches chunks the region reaches. */
  private readonly visited = new Map<string, Uint8Array>();
  private readonly queue: number[] = [];
  private head = 0;
  constructor(readonly store: CellStore, readonly start: CellXY, readonly bounds: CellBounds, limit = GESTURE_CELL_LIMIT) {
    this.cells = new CellSet(limit);
    this.target = inside(bounds, start[0], start[1]) ? packedAt(store, start[0], start[1]) : 0;
    if (!inside(bounds, start[0], start[1])) this.status = 'outside';
    else this.visit(start[0], start[1]);
  }
  get chunkCount(): number { return this.visited.size; }
  private visit(c: number, r: number): void {
    if (!inside(this.bounds, c, r) || packedAt(this.store, c, r) !== this.target) return;
    const at = locate(c, r), key = chunkKey(at.column, at.row);
    let bits = this.visited.get(key);
    if (!bits) { bits = new Uint8Array(1024); this.visited.set(key, bits); }
    if (bits[at.index]) return;
    bits[at.index] = 1;
    this.queue.push(c, r);
  }
  /** Processes up to `budget` cells. */
  step(budget = Infinity): FillStatus {
    for (let n = 0; n < budget && this.status === 'running'; n++) {
      if (this.head >= this.queue.length) { this.status = 'done'; break; }
      const c = this.queue[this.head++]!, r = this.queue[this.head++]!;
      if (!this.cells.add(c, r)) { this.status = 'exceeded'; break; }
      for (const [dc, dr] of STEPS) this.visit(c + dc, r + dr);
    }
    if (this.status === 'running' && this.head >= this.queue.length) this.status = 'done';
    return this.status;
  }
  cancel(): void { if (this.status === 'running') this.status = 'cancelled'; this.queue.length = 0; }
}

/** The single transaction of one terrain gesture: one paint operation, or none when every cell already holds `value`. */
export function paintCells(m: MapModel, layerId: string, cells: Iterable<CellXY>, value: Cell | null, label: string): Transaction {
  const writes = (function* () { for (const [column, row] of cells) yield { column, row, cell: value }; })();
  return transaction(label, [paintOp(m, layerId, writes)]);
}
