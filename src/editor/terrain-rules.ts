// ML-014 deterministic terrain rules (adopted F4, R1 D6), rules version 1. Pure. Terrain intent resolves to explicit
// stored tiles, so consumers never need an autotile engine:
// - a cell's mask has bit k set when its neighbor in direction k (N, NE, E, SE, S, SW, W, NW; Y down) has the same
//   terrain intent; a rule applies when its terrain and mask equal the cell's exactly;
// - the highest priority wins, then the lowest rule ID by code unit; with no rule, the terrain's fallback tile;
// - variation: 64-bit FNV-1a over the ASCII bytes `seed NUL layerId NUL column NUL row NUL ruleId`, modulo the rule's
//   integer weight total, walked through cumulative weights. Outputs carry no transform.
// Every intent cell stores its resolved tile: an edit that changes intent re-resolves the eight neighbors in the
// same transaction, and a literal tile edit on an intent cell clears that cell's intent.
import type { Cell, TilesetDocument } from '../contracts';
import { terrainOp, transaction } from '../domain/commands';
import type { MapModel, TerrainLayerModel } from '../domain/model';
import { CHUNK_SIZE, PaintBuffer, intentCell, unpack, type CellStore, type PaintDelta } from '../domain/paint';
import type { Operation, Transaction } from '../domain/transaction';
import { GESTURE_CELL_LIMIT, cellProblem, packedAt, type CellXY } from './terrain';

export const RULES_VERSION = 1;
/** Neighbor offsets in mask bit order: N, NE, E, SE, S, SW, W, NW (row grows downward). */
export const NEIGHBORS: readonly CellXY[] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
type Rule = TilesetDocument['rules'][number];

/** 64-bit FNV-1a of `bytes`, computed in exact 32-bit halves. */
export function fnv1a64(bytes: Iterable<number>): bigint {
  let hi = 0xcbf29ce4, lo = 0x84222325;
  for (const b of bytes) {
    lo = (lo ^ b) >>> 0;
    // (hi·2³² + lo) · (2⁴⁰ + 0x1b3) mod 2⁶⁴, every partial product below 2⁵³.
    const low = lo * 0x1b3, carry = Math.floor(low / 0x100000000);
    hi = (hi * 0x1b3 + carry + lo * 0x100) % 0x100000000;
    lo = low % 0x100000000;
  }
  return (BigInt(hi) << 32n) | BigInt(lo);
}
export const variationKey = (seed: number, layerId: string, column: number, row: number, ruleId: string): string => `${seed}\0${layerId}\0${column}\0${row}\0${ruleId}`;
const ascii = (text: string): number[] => Array.from(text, (ch) => { const code = ch.charCodeAt(0); if (code > 0x7f) throw new RangeError('Variation keys are ASCII'); return code; });
export const variationHash = (seed: number, layerId: string, column: number, row: number, ruleId: string): bigint => fnv1a64(ascii(variationKey(seed, layerId, column, row, ruleId)));

/** The output a hash selects through cumulative integer weights. A single output needs no hash. */
export function pickOutput(rule: Pick<Rule, 'outputTileIds' | 'weights'>, hash: () => bigint): string {
  if (rule.outputTileIds.length === 1) return rule.outputTileIds[0]!;
  const total = rule.weights.reduce((a, b) => a + b, 0);
  let pick = Number(hash() % BigInt(total));
  for (let i = 0; i < rule.weights.length; i++) { pick -= rule.weights[i]!; if (pick < 0) return rule.outputTileIds[i]!; }
  throw new RangeError(`Rule weights do not cover ${total}`);
}

/** A tileset's rules indexed by terrain and exact mask, with ties already decided. */
export interface RuleBook { readonly tileset: TilesetDocument; rule(terrainId: string, mask: number): Rule | undefined; fallback(terrainId: string): string | undefined }
export function ruleBook(t: TilesetDocument): RuleBook {
  if (t.rulesVersion !== RULES_VERSION) throw new RangeError(`${t.id} uses rules version ${t.rulesVersion}; this editor resolves version ${RULES_VERSION}`);
  const best = new Map<string, Rule>();
  for (const r of t.rules) {
    const key = `${r.terrainId}\0${r.neighborMask}`, prior = best.get(key);
    if (!prior || r.priority > prior.priority || (r.priority === prior.priority && r.id < prior.id)) best.set(key, r);
  }
  const fallbacks = new Map(t.terrains.map((x) => [x.id, x.fallbackTileId]));
  return { tileset: t, rule: (terrainId, mask) => best.get(`${terrainId}\0${mask}`), fallback: (terrainId) => fallbacks.get(terrainId) };
}

/** The same-terrain neighbor mask of an intent cell. */
export function maskAt(intent: CellStore, column: number, row: number): number {
  const own = packedAt(intent, column, row);
  let mask = 0;
  NEIGHBORS.forEach(([dc, dr], bit) => { if (own !== 0 && packedAt(intent, column + dc, row + dr) === own) mask |= 1 << bit; });
  return mask;
}
/** The resolved tile of an intent cell, or null for a cell without intent. */
export function resolveCell(book: RuleBook, intent: CellStore, seed: number, layerId: string, column: number, row: number): Cell | null {
  const terrainId = unpack(intent.tiles.ids, packedAt(intent, column, row))?.tileId;
  if (terrainId === undefined) return null;
  const rule = book.rule(terrainId, maskAt(intent, column, row));
  const tileId = rule ? pickOutput(rule, () => variationHash(seed, layerId, column, row, rule.id)) : book.fallback(terrainId);
  if (tileId === undefined) throw new RangeError(`${book.tileset.id} has no terrain ${terrainId}`);
  const cell: Cell = { tileId, quarterTurns: 0, mirrorX: false, mirrorY: false };
  const problem = cellProblem(book.tileset, cell);
  if (problem) throw new RangeError(`${rule ? `Rule ${rule.id}` : `Fallback of ${terrainId}`}: ${problem}`);
  return cell;
}

const key = (c: number, r: number): string => `${c},${r}`;
/** The cells a delta changes, as coordinates. */
function deltaCells(d: PaintDelta): CellXY[] {
  return d.chunks.flatMap((k) => Array.from(k.indices, (i): CellXY => [k.column * CHUNK_SIZE + (i % CHUNK_SIZE), k.row * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE)]));
}
/** The tileset's rule book, refusing a layer whose rules version differs from it. */
function checkedBook(layer: TerrainLayerModel, tileset: TilesetDocument): RuleBook {
  if (layer.settings.rulesVersion !== tileset.rulesVersion) throw new RangeError(`Layer rules version ${String(layer.settings.rulesVersion)} differs from ${tileset.id}`);
  return ruleBook(tileset);
}
const layerOf = (m: MapModel, layerId: string): TerrainLayerModel => {
  const layer = m.terrain?.byLayer.get(layerId);
  if (!layer) throw new RangeError(`No terrain for layer ${layerId}`);
  return layer;
};

/**
 * One terrain edit as a single transaction: literal tile writes and/or intent writes, the intent cleared under every
 * literal write, and every intent cell whose intent or neighborhood changed re-resolved. `tileset` is required once
 * intent is involved.
 */
export function composeEdit(m: MapModel, layerId: string, tileset: TilesetDocument | undefined, label: string,
  tiles: ReadonlyMap<string, readonly [number, number, Cell | null]>, intents: ReadonlyMap<string, readonly [number, number, string | null]> = new Map()): Transaction {
  const layer = layerOf(m, layerId), intentBuffer = new PaintBuffer(layer.intent);
  for (const [k, [c, r, terrainId]] of intents) {
    if (tiles.has(k)) throw new RangeError('A cell cannot take a literal tile and terrain intent in one edit');
    if (terrainId !== null && !tileset?.terrains.some((x) => x.id === terrainId)) throw new RangeError(`Unknown terrain ${terrainId}`);
    intentBuffer.write({ column: c, row: r, cell: terrainId === null ? null : intentCell(terrainId) });
  }
  for (const [c, r] of tiles.values()) if (packedAt(layer.intent, c, r) !== 0) intentBuffer.write({ column: c, row: r, cell: null });
  const intentDelta = intentBuffer.delta(), view = intentBuffer.view(), paint = new PaintBuffer(layer.cells);
  for (const [c, r, cell] of tiles.values()) paint.write({ column: c, row: r, cell });
  if (intentDelta || intents.size) {
    if (!tileset) throw new RangeError('The terrain layer\'s tileset is not available in this library');
    const book = checkedBook(layer, tileset), seed = layer.settings.variationSeed as number;
    const resolve = new Map<string, CellXY>();
    for (const [c, r] of intents.values()) resolve.set(key(c, r), [c, r]);
    for (const [c, r] of intentDelta ? deltaCells(intentDelta) : []) for (const [dc, dr] of [[0, 0] as const, ...NEIGHBORS]) resolve.set(key(c + dc, r + dr), [c + dc, r + dr]);
    for (const [k, [c, r]] of resolve) {
      if (tiles.has(k)) continue;
      const cell = resolveCell(book, view, seed, layerId, c, r);
      // A cell without intent keeps its literal tile unless its own intent was removed by this edit.
      if (cell !== null || intents.has(k)) paint.write({ column: c, row: r, cell });
    }
  }
  const paintDelta = paint.delta(), ops: Operation[] = [];
  if (intentDelta) ops.push({ op: 'intent', layerId, delta: intentDelta });
  if (paintDelta) ops.push({ op: 'paint', layerId, delta: paintDelta });
  return transaction(label, ops);
}

/** Sets the layer's variation seed and re-resolves every intent cell, as one transaction. */
export function reseed(m: MapModel, layerId: string, tileset: TilesetDocument | undefined, seed: number): Transaction {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new RangeError('The variation seed is a non-negative safe integer');
  if (!tileset) throw new RangeError('The terrain layer\'s tileset is not available in this library');
  const layer = layerOf(m, layerId), book = checkedBook(layer, tileset), paint = new PaintBuffer(layer.cells);
  let n = 0;
  for (const [k, cells] of layer.intent.chunks) {
    const [cc, cr] = k.split(',').map(Number) as [number, number];
    for (let i = 0; i < cells.length; i++) if (cells[i] !== 0) {
      if (++n > GESTURE_CELL_LIMIT) throw new RangeError(`Reseeding re-resolves more than ${GESTURE_CELL_LIMIT.toLocaleString('en-US')} intent cells`);
      const c = cc * CHUNK_SIZE + (i % CHUNK_SIZE), r = cr * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
      paint.write({ column: c, row: r, cell: resolveCell(book, layer.intent, seed, layerId, c, r) });
    }
  }
  const delta = paint.delta();
  return transaction('Reseed terrain variation', [terrainOp(m, layerId, 'variationSeed', seed), delta ? { op: 'paint', layerId, delta } : null]);
}

export const TURNS = ['rotate', 'mirrorX', 'mirrorY'] as const;
export type Turn = (typeof TURNS)[number];
/**
 * A transform composed after a cell's existing one (render: mirror, then quarter turns clockwise). Mirroring after a
 * turn q equals turning by −q after the mirror, so mirrors negate the turn count.
 */
export function turned(cell: Cell, turn: Turn): Cell {
  if (turn === 'rotate') return { ...cell, quarterTurns: ((cell.quarterTurns + 1) % 4) as Cell['quarterTurns'] };
  const quarterTurns = ((4 - cell.quarterTurns) % 4) as Cell['quarterTurns'];
  return turn === 'mirrorX' ? { ...cell, quarterTurns, mirrorX: !cell.mirrorX } : { ...cell, quarterTurns, mirrorY: !cell.mirrorY };
}
/** Turns every painted cell in `cells`; refused whole when the tileset forbids any result. */
export function turnCells(m: MapModel, layerId: string, tileset: TilesetDocument | undefined, cells: Iterable<CellXY>, turn: Turn): Transaction {
  const layer = layerOf(m, layerId), writes = new Map<string, readonly [number, number, Cell | null]>();
  for (const [c, r] of cells) {
    const cell = unpack(layer.cells.tiles.ids, packedAt(layer.cells, c, r));
    if (!cell) continue;
    const next = turned(cell, turn), problem = cellProblem(tileset, next);
    if (problem) throw new RangeError(`Cell ${c},${r}: ${problem}; nothing was turned`);
    writes.set(key(c, r), [c, r, next]);
  }
  return composeEdit(m, layerId, tileset, turn === 'rotate' ? 'Rotate terrain cells' : 'Mirror terrain cells', writes);
}
