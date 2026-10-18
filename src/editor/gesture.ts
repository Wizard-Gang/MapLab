// One pointer gesture is one transaction (adopted H2, R1 H3). A gesture previews against the document's
// committed model without writing it. Release commits exactly one history entry; Escape or pointer
// cancellation commits nothing. A brush stroke holds bounded per-chunk working copies, and the base
// model's immutable chunks are its checkpoints: never a whole-map snapshot or clone per pointer event.
import type { JsonValue } from '../contracts';
import { setOp, terrainOp } from '../domain/commands';
import type { CollectionName, MapModel } from '../domain/model';
import { CHUNK_CELLS, PaintBuffer, type CellWrite } from '../domain/paint';
import { applyTransaction, type Operation, type Transaction } from '../domain/transaction';
import { commit, type CommitResult, type DocumentState } from './history';

export type GestureWrite =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'gesture.closed' | 'gesture.budget' | 'gesture.missing' | 'gesture.refused'; readonly written: number };

/** Working copies a gesture may hold: half the history budget in 4 KiB chunks, at least one. */
export const defaultMaxChunks = (budget: number): number => Math.max(1, Math.floor(budget / 2 / (CHUNK_CELLS * 4)));

export class Gesture {
  private readonly buffers = new Map<string, PaintBuffer>();
  private readonly pending = new Map<string, Operation>();
  private open = true;

  constructor(readonly base: DocumentState, readonly label: string, readonly maxChunks: number) {}

  get isOpen(): boolean { return this.open; }
  /** Working-copy bytes held now; at most `maxChunks` × 4 KiB. */
  get bytes(): number { let n = 0; for (const b of this.buffers.values()) n += b.bytes; return n; }
  get chunkCount(): number { let n = 0; for (const b of this.buffers.values()) n += b.chunkCount; return n; }

  /** Writes cells in order and stops at the first refused one: a closed gesture, a missing layer or the chunk bound. */
  paint(layerId: string, cells: Iterable<CellWrite>): GestureWrite {
    if (!this.open) return { ok: false, code: 'gesture.closed', written: 0 };
    let buffer = this.buffers.get(layerId);
    if (!buffer) {
      const layer = this.base.model.terrain?.byLayer.get(layerId);
      if (!layer) return { ok: false, code: 'gesture.missing', written: 0 };
      buffer = new PaintBuffer(layer.cells, () => this.chunkCount < this.maxChunks);
      this.buffers.set(layerId, buffer);
    }
    let written = 0;
    for (const cell of cells) {
      if (!buffer.write(cell)) return { ok: false, code: 'gesture.budget', written };
      written++;
    }
    return { ok: true };
  }

  /**
   * Sets one member relative to the base; setting it back to the base value removes the pending change.
   * A change the base would refuse (a colliding nested ID) is rejected here, so `preview` never fails.
   */
  set(collection: CollectionName | 'terrain', id: string, member: string, value: JsonValue | undefined): GestureWrite {
    if (!this.open) return { ok: false, code: 'gesture.closed', written: 0 };
    let op: Operation | null;
    try { op = collection === 'terrain' ? terrainOp(this.base.model, id, member, value) : setOp(this.base.model, collection, id, member, value); } catch (e) {
      if (e instanceof RangeError) return { ok: false, code: 'gesture.missing', written: 0 };
      throw e;
    }
    const key = JSON.stringify([collection, id, member]);
    const prior = this.pending.get(key);
    if (op) this.pending.set(key, op); else this.pending.delete(key);
    if (!applyTransaction(this.base.model, { label: this.label, ops: [...this.pending.values()] }).ok) {
      if (prior) this.pending.set(key, prior); else this.pending.delete(key);
      return { ok: false, code: 'gesture.refused', written: 0 };
    }
    return { ok: true };
  }

  /** The base with pending changes applied: session-only preview state, valid until the next write. */
  preview(): MapModel {
    const applied = applyTransaction(this.base.model, { label: this.label, ops: [...this.pending.values()] });
    if (!applied.ok) throw new Error(`Gesture preview refused: ${applied.problem.code}`);
    const m = applied.model;
    if (!m.terrain || this.buffers.size === 0) return m;
    const byLayer = new Map(m.terrain.byLayer);
    for (const [layerId, buffer] of this.buffers) byLayer.set(layerId, { settings: byLayer.get(layerId)?.settings ?? {}, cells: buffer.view() });
    return { ...m, terrain: { order: m.terrain.order, byLayer } };
  }

  /** The gesture's single transaction: pending sets, then one paint delta per touched layer. */
  transaction(): Transaction {
    const ops: Operation[] = [...this.pending.values()];
    for (const [layerId, buffer] of this.buffers) { const delta = buffer.delta(); if (delta) ops.push({ op: 'paint', layerId, delta }); }
    return { label: this.label, ops };
  }

  /** Release: commits one entry onto `current`, which must still be the gesture's base. Closes the gesture. */
  commit(current: DocumentState): CommitResult {
    if (!this.open) return { outcome: 'refused', state: current, problem: { code: 'gesture.closed', op: -1, message: 'The gesture already ended' } };
    this.open = false;
    if (current.model !== this.base.model || current.revision !== this.base.revision) {
      return { outcome: 'refused', state: current, problem: { code: 'gesture.stale', op: -1, message: 'The document changed during the gesture' } };
    }
    const result = commit(current, this.transaction());
    this.buffers.clear();
    this.pending.clear();
    return result;
  }

  /**
   * Escape or pointer cancellation: drops the working copies and returns `current` unchanged. The gesture
   * never wrote the document, so anything that happened meanwhile, such as a completed save, is kept.
   */
  cancel(current: DocumentState): DocumentState {
    this.open = false;
    this.buffers.clear();
    this.pending.clear();
    return current;
  }
}

export const beginGesture = (state: DocumentState, label: string, maxChunks = defaultMaxChunks(state.budget)): Gesture => new Gesture(state, label, maxChunks);
