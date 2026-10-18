// Sparse signed 32×32 terrain chunks with packed cells and the compact paint delta (adopted H2, R1 H3):
// per chunk, the changed cell indices with before/after packed values, never a map snapshot.
// Pure: no React, DOM, storage or network.
import type { Cell, TerrainChunk } from '../contracts';

export const CHUNK_SIZE = 32;
export const CHUNK_CELLS = CHUNK_SIZE * CHUNK_SIZE;
/** Largest tile-table index a packed `Uint32` cell can name: `(index + 1) · 16 + 15` stays below 2³². */
const MAX_TILES = 2 ** 28 - 2;

/** Interned tile IDs. Append-only, so packed values stay valid; never part of authored content. */
export interface TileTable { readonly ids: readonly string[]; readonly index: ReadonlyMap<string, number> }

/** One terrain layer's cells. */
export interface CellStore {
  /** Chunk keys in output order. A key keeps its position once created, even while its chunk is empty. */
  readonly order: readonly string[];
  /** A published chunk is never written again: edits copy the chunks they touch. */
  readonly chunks: ReadonlyMap<string, Uint32Array>;
  readonly tiles: TileTable;
}

export interface ChunkDelta {
  readonly column: number;
  readonly row: number;
  /** Strictly ascending row-major indices in 0…1023. */
  readonly indices: Uint16Array;
  readonly before: Uint32Array;
  readonly after: Uint32Array;
}

/** Self-contained paint delta: packed values index its own `tiles`, never a store's table. */
export interface PaintDelta { readonly tiles: readonly string[]; readonly chunks: readonly ChunkDelta[] }

export interface CellWrite { readonly column: number; readonly row: number; readonly cell: Cell | null }

export const chunkKey = (column: number, row: number): string => `${column},${row}`;
const keyOf = (key: string): [number, number] => key.split(',').map(Number) as [number, number];

/** 0 is empty; otherwise `(tile + 1) · 16 + mirrorY · 8 + mirrorX · 4 + quarterTurns`. */
export const pack = (tile: number, cell: Cell): number => (tile + 1) * 16 + (cell.mirrorY ? 8 : 0) + (cell.mirrorX ? 4 : 0) + cell.quarterTurns;
const tileOf = (packed: number): number => (packed >>> 4) - 1;

export function unpack(tiles: readonly string[], packed: number): Cell | null {
  if (packed === 0) return null;
  const tileId = tiles[tileOf(packed)];
  if (tileId === undefined) throw new RangeError(`Packed cell ${packed} names no tile`);
  return { tileId, quarterTurns: (packed & 3) as Cell['quarterTurns'], mirrorX: (packed & 4) !== 0, mirrorY: (packed & 8) !== 0 };
}

/** Chunk coordinates and row-major index of a signed cell coordinate (floor division). */
export function locate(column: number, row: number): { column: number; row: number; index: number } {
  const cc = Math.floor(column / CHUNK_SIZE), cr = Math.floor(row / CHUNK_SIZE);
  return { column: cc, row: cr, index: (row - cr * CHUNK_SIZE) * CHUNK_SIZE + (column - cc * CHUNK_SIZE) };
}

class TileBuilder {
  readonly ids: string[];
  readonly index: Map<string, number>;
  constructor(from: TileTable) { this.ids = [...from.ids]; this.index = new Map(from.index); }
  intern(id: string): number {
    const found = this.index.get(id);
    if (found !== undefined) return found;
    if (this.ids.length > MAX_TILES) throw new RangeError('Tile table is full');
    this.index.set(id, this.ids.length);
    this.ids.push(id);
    return this.ids.length - 1;
  }
  table(): TileTable { return { ids: Object.freeze([...this.ids]), index: new Map(this.index) }; }
}

export const EMPTY_TILES: TileTable = Object.freeze({ ids: Object.freeze([]), index: new Map() });
export const EMPTY_STORE: CellStore = Object.freeze({ order: Object.freeze([]), chunks: new Map(), tiles: EMPTY_TILES });

/** Packs authored chunks; the caller has already refused duplicate chunk coordinates. */
export function storeFromChunks(chunks: readonly TerrainChunk[]): CellStore {
  const tiles = new TileBuilder(EMPTY_TILES);
  const map = new Map<string, Uint32Array>();
  for (const chunk of chunks) {
    const cells = new Uint32Array(CHUNK_CELLS);
    chunk.cells.forEach((cell, i) => { if (cell !== null) cells[i] = pack(tiles.intern(cell.tileId), cell); });
    map.set(chunkKey(chunk.column, chunk.row), cells);
  }
  return { order: Object.freeze(chunks.map((c) => chunkKey(c.column, c.row))), chunks: map, tiles: tiles.table() };
}

/** Authored chunks in store order; empty chunks are omitted, as the format requires. */
export function storeToChunks(store: CellStore): TerrainChunk[] {
  const out: TerrainChunk[] = [];
  for (const key of store.order) {
    const cells = store.chunks.get(key);
    if (!cells || cells.every((v) => v === 0)) continue;
    const [column, row] = keyOf(key);
    out.push({ column, row, cells: Array.from(cells, (v) => unpack(store.tiles.ids, v)) });
  }
  return out;
}

export const readCell = (store: CellStore, column: number, row: number): Cell | null => {
  const at = locate(column, row);
  return unpack(store.tiles.ids, store.chunks.get(chunkKey(at.column, at.row))?.[at.index] ?? 0);
};

/**
 * Bounded working copies of the chunks one edit touches. The base store is never written: its chunks
 * are the checkpoints the edit recovers to. `admit` is asked before each new 4 KiB working copy.
 */
export class PaintBuffer {
  private readonly working = new Map<string, Uint32Array>();
  private readonly tiles: TileBuilder;
  constructor(readonly base: CellStore, private readonly admit: () => boolean = () => true) { this.tiles = new TileBuilder(base.tiles); }

  get chunkCount(): number { return this.working.size; }
  get bytes(): number { return this.working.size * CHUNK_CELLS * 4; }

  /** Writes one cell. False, writing nothing, for an unsafe coordinate or a new chunk `admit` refuses. */
  write({ column, row, cell }: CellWrite): boolean {
    if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row)) return false;
    const at = locate(column, row);
    const key = chunkKey(at.column, at.row);
    let cells = this.working.get(key);
    if (!cells) {
      if (!this.admit()) return false;
      cells = this.base.chunks.get(key)?.slice() ?? new Uint32Array(CHUNK_CELLS);
      this.working.set(key, cells);
    }
    cells[at.index] = cell === null ? 0 : pack(this.tiles.intern(cell.tileId), cell);
    return true;
  }

  /** The base with the working chunks substituted. A live preview: valid until the next write. */
  view(): CellStore {
    const chunks = new Map(this.base.chunks);
    const order = [...this.base.order];
    for (const [key, cells] of this.working) { if (!chunks.has(key)) order.push(key); chunks.set(key, cells); }
    return { order, chunks, tiles: this.tiles.table() };
  }

  /** Only the cells that differ from the base, or null when nothing changed. */
  delta(): PaintDelta | null {
    const tiles: string[] = [];
    const local = new Map<number, number>();
    const toLocal = (v: number): number => {
      if (v === 0) return 0;
      const t = tileOf(v);
      let l = local.get(t);
      if (l === undefined) { l = tiles.length; local.set(t, l); tiles.push(this.tiles.ids[t] as string); }
      return (l + 1) * 16 + (v & 15);
    };
    const chunks: ChunkDelta[] = [];
    for (const [key, cells] of this.working) {
      const base = this.base.chunks.get(key);
      const changed: number[] = [];
      cells.forEach((v, i) => { if (v !== (base?.[i] ?? 0)) changed.push(i); });
      if (changed.length === 0) continue;
      const [column, row] = keyOf(key);
      chunks.push({ column, row, indices: Uint16Array.from(changed),
        before: Uint32Array.from(changed, (i) => toLocal(base?.[i] ?? 0)), after: Uint32Array.from(changed, (i) => toLocal(cells[i] ?? 0)) });
    }
    return chunks.length ? { tiles: Object.freeze(tiles), chunks: Object.freeze(chunks) } : null;
  }
}

/** The delta of writing `cells` in order (later writes win) over `store`, or null for a no-op. */
export function paintDelta(store: CellStore, cells: Iterable<CellWrite>): PaintDelta | null {
  const buffer = new PaintBuffer(store);
  for (const c of cells) if (!buffer.write(c)) throw new RangeError(`Unsafe cell coordinate ${c.column},${c.row}`);
  return buffer.delta();
}

export const invertDelta = (d: PaintDelta): PaintDelta => ({ tiles: d.tiles, chunks: d.chunks.map((c) => ({ ...c, before: c.after, after: c.before })) });
export const deltaCells = (d: PaintDelta): number => d.chunks.reduce((n, c) => n + c.indices.length, 0);
/** Retained bytes: the typed arrays plus a fixed allowance per chunk and tile ID. */
export const deltaBytes = (d: PaintDelta): number => 32 + d.tiles.reduce((n, t) => n + 16 + t.length * 2, 0)
  + d.chunks.reduce((n, c) => n + 32 + c.indices.byteLength + c.before.byteLength + c.after.byteLength, 0);

/** Why `d` cannot apply to `store` (`paint.malformed`, or `paint.stale` when a before value disagrees), or null. */
export function deltaProblem(store: CellStore, d: PaintDelta): { code: 'paint.malformed' | 'paint.stale'; message: string } | null {
  const malformed = (message: string) => ({ code: 'paint.malformed' as const, message });
  const seen = new Set<string>();
  for (const c of d.chunks) {
    const key = chunkKey(c.column, c.row);
    if (!Number.isSafeInteger(c.column) || !Number.isSafeInteger(c.row) || seen.has(key)) return malformed(`Chunk ${key} is malformed or repeated`);
    seen.add(key);
    if (c.indices.length === 0 || c.before.length !== c.indices.length || c.after.length !== c.indices.length) return malformed(`Chunk ${key} has mismatched arrays`);
    const current = store.chunks.get(key);
    for (let i = 0; i < c.indices.length; i++) {
      const index = c.indices[i] as number;
      if (index >= CHUNK_CELLS || (i > 0 && index <= (c.indices[i - 1] as number))) return malformed(`Chunk ${key} indices are not strictly ascending cells`);
      for (const v of [c.before[i] as number, c.after[i] as number]) if (v !== 0 && d.tiles[tileOf(v)] === undefined) return malformed(`Chunk ${key} names an unknown tile`);
      const before = c.before[i] as number;
      const expected = before === 0 ? 0 : store.tiles.index.get(d.tiles[tileOf(before)] as string);
      const actual = current?.[index] ?? 0;
      if (expected === undefined || (before === 0 ? actual !== 0 : actual !== (expected + 1) * 16 + (before & 15))) return { code: 'paint.stale', message: `Cell ${index} of chunk ${key} differs from the delta's before value` };
    }
  }
  return null;
}

/** Applies a delta whose `deltaProblem` is null. Copies only the touched chunks. */
export function applyDelta(store: CellStore, d: PaintDelta): CellStore {
  const tiles = new TileBuilder(store.tiles);
  const map = d.tiles.map((id) => tiles.intern(id));
  const chunks = new Map(store.chunks);
  const order = [...store.order];
  for (const c of d.chunks) {
    const key = chunkKey(c.column, c.row);
    const prior = chunks.get(key);
    if (prior === undefined && !store.order.includes(key)) order.push(key);
    const cells = prior?.slice() ?? new Uint32Array(CHUNK_CELLS);
    c.indices.forEach((index, i) => {
      const v = c.after[i] as number;
      cells[index] = v === 0 ? 0 : ((map[tileOf(v)] as number) + 1) * 16 + (v & 15);
    });
    chunks.set(key, cells);
  }
  return { order: Object.freeze(order), chunks, tiles: tiles.table() };
}

/** One terrain-intent entry of a layer (adopted F4): the terrain a cell should resolve from. */
export interface IntentEntry { readonly column: number; readonly row: number; readonly terrainId: string }
/** Intent shares the packed store: a terrain ID in place of a tile ID, with no transform bits. */
export const intentCell = (terrainId: string): Cell => ({ tileId: terrainId, quarterTurns: 0, mirrorX: false, mirrorY: false });

/** Packs authored intent entries; the caller has already refused repeated cells. */
export function storeFromIntents(entries: readonly IntentEntry[]): CellStore {
  const buffer = new PaintBuffer(EMPTY_STORE);
  for (const e of entries) if (!buffer.write({ column: e.column, row: e.row, cell: intentCell(e.terrainId) })) throw new RangeError(`Unsafe intent cell ${e.column},${e.row}`);
  return buffer.view();
}

/** Authored intent entries in domain order: row, then column (ML-014). */
export function intentEntries(store: CellStore): IntentEntry[] {
  const out: IntentEntry[] = [];
  for (const [key, cells] of store.chunks) {
    const [cc, cr] = keyOf(key);
    cells.forEach((v, i) => { if (v !== 0) out.push({ column: cc * CHUNK_SIZE + (i % CHUNK_SIZE), row: cr * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE), terrainId: store.tiles.ids[tileOf(v)] as string }); });
  }
  return out.sort((a, b) => a.row - b.row || a.column - b.column);
}

