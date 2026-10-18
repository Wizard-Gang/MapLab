// Builders that read pre-images from a model and return operations for one transaction. A builder that
// would change nothing returns null, so a no-op gesture records nothing.
import type { JsonValue } from '../contracts';
import { isObject, same, type CollectionName, type JsonObject, type MapModel } from './model';
import { paintDelta, type CellWrite } from './paint';
import type { Operation, RecordEntry, Transaction } from './transaction';

export const transaction = (label: string, ops: readonly (Operation | null)[]): Transaction =>
  ({ label, ops: ops.filter((op): op is Operation => op !== null) });

export function setOp(model: MapModel, collection: CollectionName, id: string, member: string, after: JsonValue | undefined): Operation | null {
  const record = model.collections.get(collection)?.byId.get(id);
  if (!record) throw new RangeError(`No ${collection} record ${id}`);
  const before = record[member];
  return same(before, after) ? null : { op: 'set', collection, id, member, before, after };
}

export function terrainOp(model: MapModel, layerId: string, member: string, after: JsonValue | undefined): Operation | null {
  const layer = model.terrain?.byLayer.get(layerId);
  if (!layer) throw new RangeError(`No terrain for layer ${layerId}`);
  const before = layer.settings[member];
  return same(before, after) ? null : { op: 'set', collection: 'terrain', id: layerId, member, before, after };
}

export function fieldOp(model: MapModel, member: string, after: JsonValue | undefined): Operation | null {
  const before = model.fields.get(member);
  return same(before, after) ? null : { op: 'field', member, before, after };
}

/** Inserts `records` in order at `at` (default: the end of the collection). */
export function insertOp(model: MapModel, collection: CollectionName, records: readonly JsonObject[], at?: number): Operation | null {
  const c = model.collections.get(collection);
  if (!c) throw new RangeError(`The document has no ${collection} collection`);
  const start = at ?? c.order.length;
  return records.length ? { op: 'insert', collection, entries: records.map((record, i) => ({ index: start + i, record })) } : null;
}

/** Deletes the named records, capturing each with its current index. */
export function deleteOp(model: MapModel, collection: CollectionName, ids: readonly string[]): Operation | null {
  const c = model.collections.get(collection);
  if (!c) throw new RangeError(`The document has no ${collection} collection`);
  const wanted = new Set(ids);
  const entries: RecordEntry[] = [];
  c.order.forEach((id, index) => { if (wanted.delete(id)) entries.push({ index, record: c.byId.get(id) as JsonObject }); });
  if (wanted.size) throw new RangeError(`No ${collection} records ${[...wanted].join(', ')}`);
  return entries.length ? { op: 'delete', collection, entries } : null;
}

export function paintOp(model: MapModel, layerId: string, cells: Iterable<CellWrite>): Operation | null {
  const layer = model.terrain?.byLayer.get(layerId);
  if (!layer) throw new RangeError(`No terrain for layer ${layerId}`);
  const delta = paintDelta(layer.cells, cells);
  return delta ? { op: 'paint', layerId, delta } : null;
}

/** A filled rectangle of one cell value: the shape the 10,000-cell fixture paints. */
export function* rectangle(column: number, row: number, width: number, height: number, cell: CellWrite['cell']): Generator<CellWrite> {
  for (let r = row; r < row + height; r++) for (let c = column; c < column + width; c++) yield { column: c, row: r, cell };
}

export const isRecord = isObject;
