// Snapshot expansion: no evaluator, recursive templates or live connection back to the source prefab.
import { isId, validateDocumentSchema, validatePrefab, validateMapGeometry, type JsonValue, type Vec2, type Dependency } from '../contracts';
import type { PrefabDocument, PrefabContent } from '../contracts/document-types';
import { denormalize, isObject, recordIds, type JsonObject, type MapModel } from '../domain/model';
import { insertOp, setOp, transaction } from '../domain/commands';
import { OBJECT_REF_MEMBERS } from '../domain/remap';
import { applyTransaction, type Transaction } from '../domain/transaction';
import { transformContent } from './prefab-transform';
import type { ObjectKey } from './editing';
export const PREFAB_COLLECTIONS = ['assets', 'presentations', 'flags', 'visuals', 'materials', 'bodies', 'footholds', 'traversals', 'regions', 'entities', 'waypoints', 'routes', 'triggers', 'encounters'] as const;
const json = (v: unknown): JsonObject => v as JsonObject;
function checked(prefab: PrefabDocument): void {
  const schema = validateDocumentSchema(prefab as unknown as JsonValue), geometry = validatePrefab(prefab as unknown as JsonValue);
  if (schema.length || !geometry.ok) throw Error(`Invalid prefab: ${[...schema, ...(!geometry.ok ? geometry.diagnostics : [])].map(d => d.message).join('; ')}`);
  if (prefab.dependencies.some(d => d.kind === 'prefab')) throw Error('Nested or recursive prefab dependencies are not supported');
}
/** Catalog parameter strings are literals even when their names resemble reference members. */
function prefabRefs(value: JsonValue, mapId: string, rewrite: (id: string, path: string) => string | undefined): JsonValue {
  const one = (id: string, path: string): string => rewrite(id, path) ?? id;
  const visit = (v: JsonValue, at: string, params = false): JsonValue => {
    if (Array.isArray(v)) return v.map((x, i) => visit(x, `${at}[${i}]`));
    if (!isObject(v)) return v;
    const typed = typeof v.kind === 'string' && typeof v.id === 'string' && Object.keys(v).every(k => ['kind', 'id', 'mapId'].includes(k));
    const destination = typeof v.entityId === 'string' && Object.keys(v).every(k => ['mapId', 'entityId'].includes(k));
    if (!params && (typed || destination) && typeof v.mapId === 'string' && v.mapId !== mapId) return v;
    const ref = typed && v.kind !== 'movement' || v.kind === 'flag' && typeof v.id === 'string' && Object.hasOwn(v, 'equals');
    return Object.fromEntries(Object.entries(v).map(([k, x]) => {
      const path = `${at}.${k}`;
      // A params object contains scalar literals or {ref: ObjectRef} values. Its keys
      // never confer reference semantics, including id, mapId, bodyId or groupId.
      if (params) return [k, isObject(x) ? visit(x, path) : x];
      if (k === 'id') return [k, ref && typeof x === 'string' ? one(x, path) : x];
      if (OBJECT_REF_MEMBERS.has(k) && typeof x === 'string') return [k, one(x, path)];
      if (OBJECT_REF_MEMBERS.has(k) && Array.isArray(x) && x.every(y => typeof y === 'string')) return [k, x.map((y, i) => one(y as string, `${path}[${i}]`))];
      return [k, visit(x, path, k === 'params')];
    }));
  };
  return visit(value, '$');
}
function mapIds(v: JsonValue, from: string, to: string, params = false): JsonValue {
  if (Array.isArray(v)) return v.map(x => mapIds(x, from, to));
  if (!isObject(v)) return v;
  const scoped = !params && typeof v.mapId === 'string' && (typeof v.entityId === 'string' || typeof v.kind === 'string' && typeof v.id === 'string');
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scoped && k === 'mapId' && x === from ? to : mapIds(x, from, to, k === 'params')]));
}
/** Capture selection plus its internal reference closure, using source layer IDs as explicit slot names. */
export function createPrefab(model: MapModel, keys: readonly ObjectKey[], id: string, name: string, pivot: Vec2, sources: readonly JsonValue[] = []): PrefabDocument {
  if (!isId(id) || !name.trim() || !keys.length) throw Error('Choose content and a valid prefab ID and name');
  const selected = new Map<string, { collection: typeof PREFAB_COLLECTIONS[number]; record: JsonObject }>();
  const records = PREFAB_COLLECTIONS.flatMap(collection => [...(model.collections.get(collection)?.byId.values() ?? [])].map(record => ({ collection, record })));
  const byId = new Map(records.flatMap(item => recordIds(item.collection, item.record).map(([key]) => [key, item] as const)));
  const slots = new Set<string>();
  const include = (key: string): void => {
    if (selected.has(key)) return;
    const item = byId.get(key); if (!item) throw Error(`Prefab needs an internal object ${key}`);
    if (selected.has(item.record.id as string)) return;
    selected.set(item.record.id as string, item);
    if (item.collection === 'visuals') for (const child of records) if (child.collection === 'visuals' && child.record.parentId === item.record.id) include(child.record.id as string);
    prefabRefs(item.record, model.id, (ref, path) => {
      if (/\.(layerId|planeId)$/.test(path) || model.collections.get('layers')?.byId.has(ref)) { slots.add(ref); return; }
      if (/\.(groupId|dropGroupId)$/.test(path)) return;
      if (model.groups.has(ref) && !byId.has(ref)) { for (const member of records) if (member.record.groupId === ref) include(member.record.id as string); return; }
      include(ref); return;
    });
  };
  for (const key of keys) {
    if (!(PREFAB_COLLECTIONS as readonly string[]).includes(key.collection)) throw Error('Select prefab content, excluding layers and placement provenance');
    include(key.id);
  }
  const content = Object.fromEntries(PREFAB_COLLECTIONS.map(c => [c, [...selected.values()].filter(i => i.collection === c).map(i => mapIds(i.record, model.id, id))])) as unknown as PrefabContent;
  const needed = new Set<string>();
  const documents = (v: JsonValue, params = false): void => {
    if (Array.isArray(v)) v.forEach(x => documents(x));
    else if (isObject(v)) {
      if (!params && typeof v.movementId === 'string') needed.add(v.movementId);
      if (!params && typeof v.bundleDependencyId === 'string') needed.add(v.bundleDependencyId);
      if (!params && typeof v.mapId === 'string' && v.mapId !== id && (typeof v.entityId === 'string' || typeof v.kind === 'string' && typeof v.id === 'string')) needed.add(v.mapId);
      if (!params && v.kind === 'movement' && typeof v.id === 'string') needed.add(v.id);
      Object.entries(v).forEach(([k, x]) => documents(x, k === 'params'));
    }
  };
  documents(content as unknown as JsonValue);
  const roots = [...(model.collections.get('dependencies')?.byId.values() ?? [])] as unknown as Dependency[];
  const byDocument = new Map(sources.filter(isObject).filter(v => typeof v.id === 'string').map(v => [v.id as string, v]));
  const reachable = new Map<string, Dependency>(), pending = [...roots];
  while (pending.length) {
    const dep = pending.pop()!; if (reachable.has(dep.id)) continue;
    reachable.set(dep.id, dep);
    const target = byDocument.get(dep.id);
    if (target && Array.isArray(target.dependencies)) pending.push(...target.dependencies as unknown as Dependency[]);
  }
  // Resolve used documents to direct entries when the loaded graph is available. This
  // preserves transitive access without retaining unrelated map roots that could form
  // a mixed map/template cycle once the template is placed back into its source map.
  const dependencies = sources.length
    ? [...reachable.values()].filter(d => d.kind === 'catalog' || d.kind !== 'prefab' && needed.has(d.id))
    : roots.filter(d => d.kind !== 'prefab');
  if (sources.length) for (const neededId of needed) if (!dependencies.some(d => d.id === neededId)) throw Error(`Prefab needs a resolving dependency for ${neededId}`);
  const prefab: PrefabDocument = { format: 'maplab.prefab', version: 1, id, name: name.trim(), pivot, dependencies, layerSlots: [...slots].sort(), content };
  checked(prefab); return prefab;
}
export interface PlacementOptions {
  readonly id: string; readonly position: Vec2; readonly mirrorX: boolean;
  readonly layerBindings: readonly Readonly<{ slot: string; layerId: string }>[];
  readonly prefabPath: string;
}
/** One atomic transaction owns all copied records, nested IDs, dependency additions and provenance. */
export function applyPrefab(model: MapModel, prefab: PrefabDocument, options: PlacementOptions): Transaction {
  checked(prefab);
  if (!isId(options.id) || model.owners.has(options.id) || model.groups.has(options.id)) throw Error('Placement ID is invalid or already used');
  const slots = new Map(options.layerBindings.map(b => [b.slot, b.layerId]));
  if (slots.size !== options.layerBindings.length || slots.size !== prefab.layerSlots.length || prefab.layerSlots.some(s => !slots.has(s))) throw Error('Bind every layer slot exactly once');
  for (const layer of slots.values()) { const l = model.collections.get('layers')?.byId.get(layer); if (!l || l.kind === 'group') throw Error('Slots require existing content layers'); }
  const mapping = new Map<string, string>();
  const claim = (id: string): void => {
    if (mapping.has(id)) return;
    const next = `${options.id}:${id}`;
    if (!isId(next) || model.owners.has(next) || model.groups.has(next) || next === options.id) throw Error(`Expanded ID ${next} is invalid or collides`);
    mapping.set(id, next);
  };
  for (const c of PREFAB_COLLECTIONS) for (const r of prefab.content[c]) {
    recordIds(c, json(r)).forEach(([id]) => claim(id));
    prefabRefs(json(r), prefab.id, (ref, path) => { if (/\.(groupId|dropGroupId)$/.test(path)) claim(ref); return; });
  }
  const content = transformContent(prefab.content, prefab.pivot, options.position, options.mirrorX);
  const ops = PREFAB_COLLECTIONS.map(c => insertOp(model, c, content[c].map(r => {
    const layerRefs = new Set<string>();
    const scan = (v: JsonValue, at: string): void => {
      if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${at}[${i}]`));
      else if (isObject(v)) {
        if (v.kind === 'layer' && typeof v.id === 'string') layerRefs.add(`${at}.id`);
        for (const [k, x] of Object.entries(v)) scan(x, `${at}.${k}`);
      }
    };
    scan(json(r), '$');
    const v = prefabRefs(json(r), prefab.id, (id, path) => {
      const layer = /\.(layerId|planeId)$/.test(path) || layerRefs.has(path);
      const next = layer ? slots.get(id) : mapping.get(id) ?? slots.get(id);
      if (!next) throw Error(`Unresolved prefab internal reference ${id}`);
      return next;
    });
    const renamed = mapIds(v, prefab.id, model.id) as JsonObject;
    const out: Record<string, JsonValue> = { ...renamed, id: mapping.get(r.id)! };
    for (const member of c === 'bodies' ? ['shapes'] : c === 'traversals' ? ['access'] : []) {
      const items = out[member];
      if (Array.isArray(items)) Object.assign(out, { [member]: items.map(x => isObject(x) ? { ...x, id: mapping.get(x.id as string)! } : x) });
    }
    return out;
  })));
  const dependencies: Dependency[] = [...prefab.dependencies, { id: prefab.id, kind: 'prefab', path: options.prefabPath, required: false }];
  const added: JsonObject[] = [];
  for (const d of dependencies) {
    const existing = model.collections.get('dependencies')?.byId.get(d.id);
    if (existing) { if (existing.kind !== d.kind || existing.path !== d.path) throw Error(`Conflicting dependency ${d.id}`); if (d.kind === 'prefab' && existing.required) throw Error('Prefab provenance must be optional'); if (d.required && !existing.required) ops.push(setOp(model, 'dependencies', d.id, 'required', true)); }
    else added.push(json(d));
  }
  const expandedIds = PREFAB_COLLECTIONS.flatMap(c => content[c].flatMap(r => recordIds(c, json(r)).map(([id]) => mapping.get(id)!)));
  const tx = transaction('Apply prefab', [...ops, insertOp(model, 'dependencies', added), insertOp(model, 'prefabPlacements', [json({ id: options.id, prefabId: prefab.id, position: options.position, mirrorX: options.mirrorX, layerBindings: options.layerBindings, expandedIds })])]);
  const applied = applyTransaction(model, tx); if (!applied.ok) throw Error(applied.problem.message);
  const value = denormalize(applied.model), schema = validateDocumentSchema(value), geometry = validateMapGeometry(value);
  if (schema.length || !geometry.ok) throw Error(`Invalid placement: ${[...schema, ...(!geometry.ok ? geometry.diagnostics : [])].map(d => d.message).join('; ')}`);
  return tx;
}
