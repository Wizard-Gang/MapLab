// Pure transactions (adopted H2, R1 H3). A transaction is an ordered list of operations, each carrying
// its exact pre-image, so its inverse is exact. It applies completely or not at all and returns a new
// model; the input model is never written. Paint operations carry compact cell deltas.
import { canonical, isId, type JsonValue } from '../contracts';
import {
  FIXED_MEMBERS, STRUCTURED, deepFreeze, isObject, nestedIds, recordIds, same,
  type CollectionName, type JsonObject, type MapModel, type ObjectCollection,
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

/** Owner bookkeeping for the object namespace: copied once per operation that changes it. */
function reown(model: MapModel, removed: readonly string[], added: readonly [string, string][]): ReadonlyMap<string, string> {
  if (removed.length === 0 && added.length === 0) return model.owners;
  const owners = new Map(model.owners);
  for (const id of removed) owners.delete(id);
  for (const [id, owner] of added) {
    if (!isId(id)) refuse('transaction.record', `${JSON.stringify(id)} is not a persistent ID`);
    if (owners.has(id)) refuse('transaction.duplicate-id', `${id} is already used by ${owners.get(id)}`);
    owners.set(id, owner);
  }
  return owners;
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
    if (op.after === undefined) fields.delete(op.member); else fields.set(op.member, deepFreeze(op.after));
    const owners = reown(m, nestedIds(op.member, op.before, '$').map(([id]) => id),
      nestedIds(op.member, op.after, '$').map(([id]) => [id, op.member]));
    return { ...m, fields, owners };
  }
  if (op.op === 'set' && op.collection === 'terrain') {
    const layer = m.terrain?.byLayer.get(op.id);
    if (!layer || !m.terrain) return refuse('transaction.missing', `No terrain for layer ${op.id}`);
    if (op.member === 'layerId' || op.member === 'chunks') refuse('transaction.member', `Terrain ${op.member} cannot be set`);
    if (!same(layer.settings[op.member], op.before)) refuse('transaction.stale', `Terrain ${op.id}.${op.member} differs from the operation's before value`);
    const { [op.member]: _, ...rest } = layer.settings;
    const settings = deepFreeze(op.after === undefined ? rest : { ...rest, [op.member]: op.after });
    return { ...m, terrain: { order: m.terrain.order, byLayer: new Map(m.terrain.byLayer).set(op.id, { settings, cells: layer.cells }) } };
  }
  const collection = m.collections.get(op.collection as CollectionName);
  if (!collection) return refuse('transaction.collection', `The document has no ${op.collection} collection`);
  const objects = op.collection !== 'dependencies';
  const ids = (record: JsonObject): [string, string][] => (objects ? recordIds(op.collection as ObjectCollection, record) : []);
  const byId = new Map(collection.byId);
  if (op.op === 'set') {
    const record = byId.get(op.id);
    if (!record) return refuse('transaction.missing', `No ${op.collection} record ${op.id}`);
    if (op.member === 'id') refuse('transaction.immutable-id', 'Persistent IDs never change');
    if (!same(record[op.member], op.before)) refuse('transaction.stale', `${op.id}.${op.member} differs from the operation's before value`);
    const { [op.member]: _, ...rest } = record;
    const next = deepFreeze(op.after === undefined ? rest : { ...rest, [op.member]: op.after });
    const owner = `${op.collection}/${op.id}`;
    const owners = objects ? reown(m, nestedIds(op.collection, record, '$').map(([id]) => id), nestedIds(op.collection, next, '$').map(([id]) => [id, owner])) : m.owners;
    byId.set(op.id, next);
    return { ...m, owners, collections: new Map(m.collections).set(op.collection as CollectionName, { order: collection.order, byId }) };
  }
  const order = [...collection.order];
  op.entries.forEach((e, i) => { if (!Number.isSafeInteger(e.index) || (i > 0 && e.index <= (op.entries[i - 1] as RecordEntry).index)) refuse('transaction.index', 'Entry indices must ascend strictly'); });
  let owners = m.owners;
  if (op.op === 'insert') {
    const added: [string, string][] = [];
    for (const { index, record } of op.entries) {
      if (!isObject(record) || !isId(record.id)) return refuse('transaction.record', 'An inserted record needs a persistent ID');
      if (byId.has(record.id)) refuse('transaction.duplicate-id', `${record.id} is already in ${op.collection}`);
      if (index < 0 || index > order.length) refuse('transaction.index', `Index ${index} is outside ${op.collection}`);
      order.splice(index, 0, record.id);
      byId.set(record.id, deepFreeze(record));
      added.push(...ids(record).map(([id], j): [string, string] => [id, j === 0 ? op.collection : `${op.collection}/${record.id}`]));
    }
    owners = reown(m, [], added);
  } else {
    const removed: string[] = [];
    for (const { index, record } of op.entries) {
      const id = order[index];
      if (id === undefined || id !== record.id || !same(byId.get(id), record)) refuse('transaction.stale', `${op.collection}[${index}] differs from the operation's record`);
      removed.push(...ids(record).map(([nested]) => nested));
    }
    for (const { index, record } of op.entries.toReversed()) { order.splice(index, 1); byId.delete(record.id as string); }
    owners = reown(m, removed, []);
  }
  return { ...m, owners, collections: new Map(m.collections).set(op.collection, { order: Object.freeze(order), byId }) };
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
