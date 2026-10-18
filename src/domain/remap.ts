// Stable persistent-ID remapping and atomic reference rewrites (adopted H2 and C1). Pasted records
// receive new IDs, allocated deterministically, and every internal reference among them is rewritten
// in the same transaction. A reference to another map, a document or a tile keeps its identity.
import { isId, type JsonValue } from '../contracts';
import { FIXED_MEMBERS, OBJECT_COLLECTIONS, isObject, nestedIds, recordIds, type JsonObject, type MapModel, type ObjectCollection } from './model';
import type { Operation, Transaction } from './transaction';

/** Members of the published v1 map schema whose string (or string-array) values name objects of the same map. */
export const OBJECT_REF_MEMBERS: ReadonlySet<string> = new Set(['footholdId', 'bodyId', 'ownerBodyId', 'bodyIds', 'entityId', 'spawnIds',
  'assetId', 'assetIds', 'trackAssetId', 'layerId', 'planeId', 'materialId', 'shapeId', 'visualId', 'regionId', 'approachRegionId',
  'patrolRegionId', 'pursuitRegionId', 'leashRegionId', 'aggroRegionId', 'waypointIds', 'routeId', 'presentationId', 'expandedIds',
  'parentId', 'groupId', 'dropGroupId']);

/** Group membership is implicit: a group exists while any member names it, so it never dangles. */
const IMPLICIT_MEMBERS: ReadonlySet<string> = new Set(['groupId', 'dropGroupId']);

type Rewrite = (id: string, path: string) => string | undefined;
const isObjectRef = (v: JsonObject): boolean => typeof v.kind === 'string' && v.kind !== 'movement' && typeof v.id === 'string'
  && Object.keys(v).every((k) => k === 'kind' || k === 'id' || k === 'mapId');
const isFlagCondition = (v: JsonObject): boolean => v.kind === 'flag' && typeof v.id === 'string' && Object.hasOwn(v, 'equals');

/**
 * Returns `value` with every same-map object reference passed through `rewrite` (undefined keeps it).
 * Unchanged subtrees are returned as is. An object whose `mapId` names another map is left untouched.
 */
export function rewriteRefs(value: JsonValue, mapId: string, rewrite: Rewrite, at = '$'): JsonValue {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v, i) => { const r = rewriteRefs(v, mapId, rewrite, `${at}[${i}]`); changed ||= r !== v; return r; });
    return changed ? out : value;
  }
  if (!isObject(value) || (typeof value.mapId === 'string' && value.mapId !== mapId)) return value;
  let out: Record<string, JsonValue> | null = null;
  const put = (k: string, v: JsonValue): void => { (out ??= { ...value })[k] = v; };
  const one = (v: string, p: string): string => { const r = rewrite(v, p); return r === undefined ? v : r; };
  const ref = isObjectRef(value) || isFlagCondition(value);
  for (const [k, v] of Object.entries(value)) {
    const p = `${at}.${k}`;
    if (k === 'id') { if (ref && typeof v === 'string' && one(v, p) !== v) put(k, one(v, p)); continue; }
    if (OBJECT_REF_MEMBERS.has(k) && typeof v === 'string') { if (one(v, p) !== v) put(k, one(v, p)); continue; }
    if (OBJECT_REF_MEMBERS.has(k) && Array.isArray(v) && v.every((x) => typeof x === 'string')) {
      const next = (v as string[]).map((x, i) => one(x, `${p}[${i}]`));
      if (next.some((x, i) => x !== v[i])) put(k, next);
      continue;
    }
    const r = rewriteRefs(v, mapId, rewrite, p);
    if (r !== v) put(k, r);
  }
  return out ?? value;
}

/** Smallest `base-N` (N ≥ 2, base without a trailing `-digits`) that is a valid, untaken persistent ID. */
export function allocateId(id: string, taken: (id: string) => boolean): string {
  const base = id.replace(/-[0-9]+$/, '');
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, 96 - suffix.length) + suffix;
    if (isId(candidate) && !taken(candidate)) return candidate;
  }
}

export interface PasteItem { readonly collection: ObjectCollection; readonly record: JsonObject }
export interface PastePlan {
  readonly mapping: ReadonlyMap<string, string>;
  readonly items: readonly PasteItem[];
  /** References that are neither pasted nor present in the target map; kept unchanged for the caller to preview. */
  readonly unresolved: readonly Readonly<{ item: number; path: string; id: string }>[];
}

/** Assigns new persistent IDs to every pasted record and nested object, in item order, and rewrites internal refs. */
export function planPaste(model: MapModel, items: readonly PasteItem[]): PastePlan {
  const originals = new Set<string>();
  for (const { collection, record } of items) {
    if (!(OBJECT_COLLECTIONS as readonly string[]).includes(collection)) throw new RangeError(`${collection} is not an object collection`);
    for (const [id] of recordIds(collection, record)) {
      if (!isId(id) || originals.has(id)) throw new RangeError(`Clipboard ID ${id} is invalid or repeated`);
      originals.add(id);
    }
  }
  const mapping = new Map<string, string>();
  const allocated = new Set<string>();
  for (const id of originals) {
    const next = allocateId(id, (c) => model.owners.has(c) || allocated.has(c) || originals.has(c));
    mapping.set(id, next);
    allocated.add(next);
  }
  const unresolved: { item: number; path: string; id: string }[] = [];
  const out = items.map(({ collection, record }, item) => {
    const renamed = rewriteRefs(record, model.id, (id, path) => {
      const to = mapping.get(id);
      if (to === undefined && !model.owners.has(id) && !IMPLICIT_MEMBERS.has(path.replace(/^.*\.|\[[0-9]+\]$/g, ''))) unresolved.push({ item, path, id });
      return to;
    }) as Record<string, JsonValue>;
    const nested = new Set(nestedIds(collection, record, '$').map(([id]) => id));
    const renest = (v: JsonValue): JsonValue => (Array.isArray(v) ? v.map((x) => (isObject(x) && typeof x.id === 'string' && nested.has(x.id) ? { ...x, id: mapping.get(x.id) as string } : x)) : v);
    const copy: Record<string, JsonValue> = { ...renamed, id: mapping.get(record.id as string) as string };
    for (const [member, v] of Object.entries(copy)) if (Array.isArray(v)) copy[member] = renest(v);
    return { collection, record: copy };
  });
  return { mapping, items: out, unresolved };
}

/** One transaction appending the planned records to the end of their collections. */
export function pasteTransaction(model: MapModel, plan: PastePlan, label = 'Paste'): Transaction {
  const groups = new Map<ObjectCollection, JsonObject[]>();
  for (const { collection, record } of plan.items) groups.set(collection, [...(groups.get(collection) ?? []), record]);
  const ops: Operation[] = [...groups].map(([collection, records]) => {
    const start = model.collections.get(collection)?.order.length;
    if (start === undefined) throw new RangeError(`The document has no ${collection} collection`);
    return { op: 'insert', collection, entries: records.map((record, i) => ({ index: start + i, record })) };
  });
  return { label, ops };
}

/** Operations that rewrite every same-map reference to `from` into `to`: records, terrain settings and fields. */
export function retargetOps(model: MapModel, from: string, to: string): Operation[] {
  const swap = (id: string): string | undefined => (id === from ? to : undefined);
  const ops: Operation[] = [];
  // Each member is wrapped so a reference held directly by the record (`regionId`) is rewritten too.
  const rewritten = (member: string, v: JsonValue): JsonValue => (rewriteRefs({ [member]: v }, model.id, swap) as JsonObject)[member] as JsonValue;
  const members = (record: JsonObject, emit: (member: string, before: JsonValue, after: JsonValue) => void): void => {
    for (const [member, v] of Object.entries(record)) {
      const after = member === 'id' ? v : rewritten(member, v);
      if (after !== v) emit(member, v, after);
    }
  };
  for (const [collection, c] of model.collections) {
    if (collection === 'dependencies') continue;
    for (const id of c.order) members(c.byId.get(id) as JsonObject, (member, before, after) => ops.push({ op: 'set', collection, id, member, before, after }));
  }
  for (const layerId of model.terrain?.order ?? []) {
    members(model.terrain?.byLayer.get(layerId)?.settings as JsonObject, (member, before, after) => {
      if (member !== 'layerId') ops.push({ op: 'set', collection: 'terrain', id: layerId, member, before, after });
    });
  }
  for (const [member, v] of model.fields) {
    if (FIXED_MEMBERS.has(member)) continue;
    const after = rewritten(member, v);
    if (after !== v) ops.push({ op: 'field', member, before: v, after });
  }
  return ops;
}
