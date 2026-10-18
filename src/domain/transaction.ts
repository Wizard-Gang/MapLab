// Pure transactions (adopted H2, R1 H3). A transaction is an ordered list of operations, each carrying
// its exact pre-image, so its inverse is exact. It applies completely or not at all and returns a new
// model; the input model is never written. Paint operations carry compact cell deltas.
import { canonical, isId, type JsonValue } from '../contracts';
import {
  FIXED_MEMBERS, Namespace, STRUCTURED, deepFreeze, fieldClaim, isObject, ownMember as own, recordClaim, same, setOwn,
  type Claim, type CollectionName, type JsonObject, type MapModel, type ObjectCollection,
} from './model';
import { applyDelta, deltaBytes, deltaProblem, invertDelta, type PaintDelta } from './paint';

/** A record at its index: the final index for an insert, the current index for a delete. Ascending. */
export interface RecordEntry { readonly index: number; readonly record: JsonObject }
export type Operation =
  | Readonly<{ op: 'insert' | 'delete'; collection: CollectionName; entries: readonly RecordEntry[] }>
  /** One member of one record; `collection: 'terrain'` addresses a terrain layer's settings by `layerId`. */
  | Readonly<{ op: 'set'; collection: CollectionName | 'terrain'; id: string; member: string; before: JsonValue | undefined; after: JsonValue | undefined }>
  /** One document member that is not a collection or `terrain`. */
  | Readonly<{ op: 'field'; member: string; before: JsonValue | undefined; after: JsonValue | undefined }>
  | Readonly<{ op: 'paint'; layerId: string; delta: PaintDelta }>;
export interface Transaction { readonly label: string; readonly ops: readonly Operation[] }
export interface TransactionProblem { readonly code: string; readonly op: number; readonly message: string }
export type ApplyResult = { readonly ok: true; readonly model: MapModel } | { readonly ok: false; readonly problem: TransactionProblem };

class Refusal { constructor(readonly code: string, readonly message: string) {} }
const refuse = (code: string, message: string): never => { throw new Refusal(code, message); };

/** A private frozen copy, so a model never freezes or shares a caller's value. */
const frozenCopy = <T extends JsonValue | undefined>(v: T): T => (v === undefined ? v : deepFreeze(structuredClone(v)));

/** Releases then claims namespace entries, copying the namespace only when the claims differ. */
function reclaim(m: MapModel, removed: readonly Claim[], added: readonly Claim[]): Pick<MapModel, 'owners' | 'groups'> {
  const key = (cs: readonly Claim[]): string => JSON.stringify(cs.map((c) => [c.ids.map(([id, owner]) => [id, owner]), c.groups.map(([g]) => g), c.groupLayer]));
  if (key(removed) === key(added)) return { owners: m.owners, groups: m.groups };
  const ns = new Namespace(m);
  for (const c of removed) ns.release(c);
  for (const c of added) {
    const hit = ns.claim(c);
    if (hit) refuse(hit.code === 'id' ? 'transaction.record' : 'transaction.duplicate-id', hit.message);
  }
  return { owners: ns.owners, groups: ns.groups };
}

/** Sets or removes one own member, returning a new frozen object. */
function withMember(o: JsonObject, member: string, value: JsonValue | undefined): JsonObject {
  const next: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(o)) if (k !== member) setOwn(next, k, v);
  if (value !== undefined) setOwn(next, member, frozenCopy(value));
  return Object.freeze(next);
}

function applyOp(m: MapModel, op: Operation): MapModel {
  if (op.op === 'paint') {
    const layer = m.terrain?.byLayer.get(op.layerId);
    if (!layer || !m.terrain) return refuse('transaction.missing', `No terrain for layer ${op.layerId}`);
    const problem = deltaProblem(layer.cells, op.delta);
    if (problem) refuse(problem.code, problem.message);
    const byLayer = new Map(m.terrain.byLayer).set(op.layerId, { settings: layer.settings, cells: applyDelta(layer.cells, op.delta) });
    return { ...m, terrain: { order: m.terrain.order, byLayer } };
  }
  if (op.op === 'field') {
    if (FIXED_MEMBERS.has(op.member) || STRUCTURED.has(op.member)) refuse('transaction.member', `${op.member} cannot be set as a field`);
    if (!same(m.fields.get(op.member), op.before)) refuse('transaction.stale', `${op.member} differs from the operation's before value`);
    const fields = new Map(m.fields);
    if (op.after === undefined) fields.delete(op.member); else fields.set(op.member, frozenCopy(op.after));
    return { ...m, fields, ...reclaim(m, [fieldClaim(op.member, op.before)], [fieldClaim(op.member, op.after)]) };
  }
  if (op.op === 'set' && op.collection === 'terrain') {
    const layer = m.terrain?.byLayer.get(op.id);
    if (!layer || !m.terrain) return refuse('transaction.missing', `No terrain for layer ${op.id}`);
    if (op.member === 'layerId' || op.member === 'chunks') refuse('transaction.member', `Terrain ${op.member} cannot be set`);
    if (!same(own(layer.settings, op.member), op.before)) refuse('transaction.stale', `Terrain ${op.id}.${op.member} differs from the operation's before value`);
    const settings = withMember(layer.settings, op.member, op.after);
    return { ...m, terrain: { order: m.terrain.order, byLayer: new Map(m.terrain.byLayer).set(op.id, { settings, cells: layer.cells }) } };
  }
  const name = op.collection as CollectionName;
  const collection = m.collections.get(name);
  if (!collection) return refuse('transaction.collection', `The document has no ${op.collection} collection`);
  const claims = (records: readonly JsonObject[]): Claim[] => (name === 'dependencies' ? [] : records.map((r) => recordClaim(name as ObjectCollection, r)));
  const byId = new Map(collection.byId);
  if (op.op === 'set') {
    const record = byId.get(op.id);
    if (!record) return refuse('transaction.missing', `No ${op.collection} record ${op.id}`);
    if (op.member === 'id') refuse('transaction.immutable-id', 'Persistent IDs never change');
    if (!same(own(record, op.member), op.before)) refuse('transaction.stale', `${op.id}.${op.member} differs from the operation's before value`);
    const next = withMember(record, op.member, op.after);
    const ns = reclaim(m, claims([record]), claims([next]));
    byId.set(op.id, next);
    return { ...m, ...ns, collections: new Map(m.collections).set(name, { order: collection.order, byId }) };
  }
  const order = [...collection.order];
  op.entries.forEach((e, i) => { if (!Number.isSafeInteger(e.index) || (i > 0 && e.index <= (op.entries[i - 1] as RecordEntry).index)) refuse('transaction.index', 'Entry indices must ascend strictly'); });
  let ns: Pick<MapModel, 'owners' | 'groups'>;
  if (op.op === 'insert') {
    const records: JsonObject[] = [];
    for (const { index, record } of op.entries) {
      if (!isObject(record) || !isId(record.id)) return refuse('transaction.record', 'An inserted record needs a persistent ID');
      if (byId.has(record.id)) refuse('transaction.duplicate-id', `${record.id} is already in ${op.collection}`);
      if (index < 0 || index > order.length) refuse('transaction.index', `Index ${index} is outside ${op.collection}`);
      const stored = frozenCopy(record);
      order.splice(index, 0, record.id);
      byId.set(record.id, stored);
      records.push(stored);
    }
    ns = reclaim(m, [], claims(records));
  } else {
    const records: JsonObject[] = [];
    for (const { index, record } of op.entries) {
      const id = order[index];
      const current = id === undefined ? undefined : byId.get(id);
      if (current === undefined || id !== record.id || !same(current, record)) refuse('transaction.stale', `${op.collection}[${index}] differs from the operation's record`);
      records.push(current as JsonObject);
    }
    for (const { index, record } of op.entries.toReversed()) { order.splice(index, 1); byId.delete(record.id as string); }
    ns = reclaim(m, claims(records), []);
  }
  return { ...m, ...ns, collections: new Map(m.collections).set(name, { order: Object.freeze(order), byId }) };
}

/** Applies every operation in order, or none: on refusal the problem names the operation. */
export function applyTransaction(model: MapModel, tx: Transaction): ApplyResult {
  let m = model;
  for (const [i, op] of tx.ops.entries()) {
    try { m = applyOp(m, op); } catch (e) {
      if (e instanceof Refusal) return { ok: false, problem: { code: e.code, op: i, message: e.message } };
      throw e;
    }
  }
  return { ok: true, model: m };
}

export function invertOperation(op: Operation): Operation {
  switch (op.op) {
    case 'insert': return { ...op, op: 'delete' };
    case 'delete': return { ...op, op: 'insert' };
    case 'set': case 'field': return { ...op, before: op.after, after: op.before };
    case 'paint': return { ...op, delta: invertDelta(op.delta) };
  }
}

/** The exact inverse: inverted operations in reverse order, sharing the forward data. */
export const invertTransaction = (tx: Transaction): Transaction => ({ label: tx.label, ops: tx.ops.toReversed().map(invertOperation) });

const changes = (op: Operation): boolean => (op.op === 'set' || op.op === 'field' ? !same(op.before, op.after)
  : op.op === 'paint' ? op.delta.chunks.length > 0 : op.entries.length > 0);
/** Drops operations that change nothing. A transaction left with no operations records nothing. */
export const pruneTransaction = (tx: Transaction): Transaction => ({ label: tx.label, ops: tx.ops.filter(changes) });

const jsonBytes = (v: JsonValue | undefined): number => (v === undefined ? 0 : canonical(v).length * 2);
/** Accounted retained bytes of a transaction: typed arrays exactly, JSON as UTF-16 canonical text plus overheads. */
export function transactionBytes(tx: Transaction): number {
  return tx.ops.reduce((n, op) => n + (op.op === 'paint' ? 32 + deltaBytes(op.delta)
    : op.op === 'set' || op.op === 'field' ? 64 + jsonBytes(op.before) + jsonBytes(op.after)
      : 32 + op.entries.reduce((k, e) => k + 32 + jsonBytes(e.record), 0)), 64 + tx.label.length * 2);
}

/**
 * A private, frozen copy for history: JSON values are cloned and frozen, paint arrays are copied, so no
 * caller can change an entry after it is recorded. Typed arrays cannot be frozen; the history never
 * hands its copies out for writing.
 */
export function sealTransaction(tx: Transaction): Transaction {
  const ops = tx.ops.map((op): Operation => {
    switch (op.op) {
      case 'insert': case 'delete': return Object.freeze({ ...op, entries: Object.freeze(op.entries.map((e) => Object.freeze({ index: e.index, record: frozenCopy(e.record) }))) });
      case 'set': case 'field': return Object.freeze({ ...op, before: frozenCopy(op.before), after: frozenCopy(op.after) });
      case 'paint': return Object.freeze({ ...op, delta: Object.freeze({ tiles: Object.freeze([...op.delta.tiles]),
        chunks: Object.freeze(op.delta.chunks.map((c) => Object.freeze({ column: c.column, row: c.row, indices: c.indices.slice(), before: c.before.slice(), after: c.after.slice() }))) }) });
    }
  });
  return Object.freeze({ label: tx.label, ops: Object.freeze(ops) });
}
