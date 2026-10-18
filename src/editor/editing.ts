// ML-011: pure selection commands. Models/history are never pointer-preview state.
import { parseJson, validateDocumentSchema, validateMapGeometry, type JsonValue, type Vec2 } from '../contracts';
import { deleteOp, setOp, transaction } from '../domain/commands';
import { denormalize, isObject, OBJECT_COLLECTIONS, recordIds, type JsonObject, type MapModel, type ObjectCollection } from '../domain/model';
import { pasteTransaction, planPaste, retargetOps, rewriteRefs, type PasteItem } from '../domain/remap';
import { applyTransaction, type Operation, type Transaction } from '../domain/transaction';
import { quantize } from '../render/transform';

export interface ObjectKey { readonly collection: ObjectCollection; readonly id: string }
export const keyOf = (k: ObjectKey): string => `${k.collection}/${k.id}`;
export const recordOf = (m: MapModel, k: ObjectKey): JsonObject | undefined => m.collections.get(k.collection)?.byId.get(k.id);
export function objects(m: MapModel): ObjectKey[] {
  return OBJECT_COLLECTIONS.flatMap((collection) => (m.collections.get(collection)?.order ?? []).map((id) => ({ collection, id })));
}
export interface Dependent { readonly owner: ObjectKey | null; readonly path: string; readonly id: string }
/** Inspect exact schema reference members, including nested IDs, fields and terrain; never match names as text. */
export function dependents(m: MapModel, selection: readonly ObjectKey[]): Dependent[] {
  const removed = new Set(selection.flatMap((k) => { const r = recordOf(m, k); return r ? recordIds(k.collection, r).map(([id]) => id) : []; }));
  const selected = new Set(selection.map(keyOf)), out: Dependent[] = [];
  const scan = (v: JsonValue, owner: ObjectKey | null, at: string): void => {
    rewriteRefs(v, m.id, (id, path) => { if (removed.has(id)) out.push({ owner, path, id }); return undefined; }, at);
  };
  for (const k of objects(m)) if (!selected.has(keyOf(k))) scan(recordOf(m, k)!, k, `$.${k.collection}[${k.id}]`);
  for (const [name, v] of m.fields) scan({ [name]: v }, null, '$');
  for (const id of m.terrain?.order ?? []) scan(m.terrain!.byLayer.get(id)!.settings, null, `$.terrain[${id}]`);
  return out;
}
/** A cascade is a previewable transitive set; document/terrain dependents require retargeting instead. */
export function cascade(m: MapModel, selection: readonly ObjectKey[]): { keys: ObjectKey[]; blocked: Dependent[] } {
  const all = new Map(selection.map((k) => [keyOf(k), k]));
  while (true) {
    const refs = dependents(m, [...all.values()]); let added = false;
    for (const r of refs) if (r.owner && !all.has(keyOf(r.owner))) { all.set(keyOf(r.owner), r.owner); added = true; }
    if (!added) return { keys: [...all.values()], blocked: refs.filter((r) => !r.owner) };
  }
}
export function deleteSelection(m: MapModel, keys: readonly ObjectKey[], target?: string): Transaction {
  const ops: Operation[] = [];
  if (target !== undefined) {
    if (keys.length !== 1 || !m.collections.get(keys[0]!.collection)?.byId.has(target) || keys.some((k) => k.id === target)) throw new Error('Choose a surviving object in the same collection');
    const k = keys[0]!, r = recordOf(m, k)!;
    if (recordIds(k.collection, r).length > 1) throw new Error('Nested IDs require their own explicit repair; cancel and repair those references first');
    ops.push(...retargetOps(m, k.id, target));
  } else if (dependents(m, keys).length) throw new Error('References remain: cancel, retarget or preview an explicit cascade');
  const groups = new Map<ObjectCollection, string[]>();
  for (const k of keys) groups.set(k.collection, [...(groups.get(k.collection) ?? []), k.id]);
  for (const [c, ids] of groups) { const op = deleteOp(m, c, ids); if (op) ops.push(op); }
  // Retarget operations on records that are themselves removed must be folded into deletion preimages.
  const removing = new Set(keys.map(keyOf));
  return transaction('Delete objects', ops.filter((op) => op.op !== 'set' || !removing.has(`${op.collection}/${op.id}`)));
}
export function unresolved(m: MapModel): string[] {
  const out: string[] = [];
  const scan = (v: JsonValue): void => { rewriteRefs(v, m.id, (id, path) => {
    // Implicit groups need no defining record. All other same-map references must resolve.
    if (!m.owners.has(id) && !m.groups.has(id) && !/\.(?:groupId|dropGroupId)$/.test(path)) out.push(`${path}: ${id}`);
    return undefined;
  }); };
  for (const k of objects(m)) scan(recordOf(m, k)!);
  for (const [member, v] of m.fields) scan({ [member]: v });
  for (const id of m.terrain?.order ?? []) scan(m.terrain!.byLayer.get(id)!.settings);
  return out;
}
/** Local commit gate; full cross-document/catalog validation still belongs to the library save gate. */
export function editProblems(m: MapModel): string[] {
  const value = denormalize(m), schema = validateDocumentSchema(value);
  if (schema.length) return schema.slice(0, 8).map((d) => `${d.jsonPath}: ${d.message}`);
  const geometry = validateMapGeometry(value);
  return [...(!geometry.ok ? geometry.diagnostics.slice(0, 8).map((d) => `${d.jsonPath}: ${d.message}`) : []), ...unresolved(m).slice(0, 8)];
}
export function numericLeaves(r: JsonValue, path: readonly (string | number)[] = []): { path: readonly (string | number)[]; value: number }[] {
  if (typeof r === 'number') return [{ path, value: r }];
  if (Array.isArray(r)) return r.flatMap((v, i) => numericLeaves(v, [...path, i]));
  if (isObject(r)) return Object.entries(r).flatMap(([k, v]) => numericLeaves(v, [...path, k]));
  return [];
}
export function numericEdit(m: MapModel, key: ObjectKey, path: readonly (string | number)[], value: number): Transaction {
  if (!Number.isFinite(value) || path.length === 0 || typeof path[0] !== 'string') throw new Error('Enter a finite number');
  const r = recordOf(m, key); if (!r) throw new Error('Object no longer exists');
  const change = (v: JsonValue, at: number): JsonValue => {
    if (at === path.length) { if (typeof v !== 'number') throw new Error('Not a numeric field'); return value; }
    const k = path[at]!;
    if (Array.isArray(v) && typeof k === 'number' && k >= 0 && k < v.length) return v.map((x, i) => i === k ? change(x, at + 1) : x);
    if (isObject(v) && typeof k === 'string' && Object.hasOwn(v, k)) return { ...v, [k]: change(v[k]!, at + 1) };
    throw new Error('Field no longer exists');
  };
  const member = path[0], after = change(r[member]!, 1);
  return transaction('Set numeric property', [setOp(m, key.collection, key.id, member, after)]);
}
const point = (v: JsonValue | undefined): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number');
const plus = (v: JsonValue, delta: Vec2): JsonValue => { if (!point(v)) throw new Error('No editable position'); return [quantize(v[0] + delta[0]), quantize(v[1] + delta[1])]; };
/** Expand layer/visual hierarchies and route waypoints iteratively, never duplicating a moved descendant. */
export function moveKeys(m: MapModel, keys: readonly ObjectKey[]): ObjectKey[] {
  const all = new Map(keys.map((k) => [keyOf(k), k])), children = new Map<string, ObjectKey[]>();
  const child = (parent: string, key: ObjectKey): void => { const list = children.get(parent) ?? []; list.push(key); children.set(parent, list); };
  for (const k of objects(m)) {
    const r = recordOf(m, k)!;
    if (k.collection === 'layers' && typeof r.parentId === 'string') child(`layers/${r.parentId}`, k);
    if (k.collection === 'visuals') { child(`layers/${r.layerId}`, k); if (typeof r.parentId === 'string') child(`visuals/${r.parentId}`, k); }
  }
  const pending = [...keys];
  for (let at = 0; at < pending.length; at++) {
    const k = pending[at]!, r = recordOf(m, k);
    const next = k.collection === 'routes' && r ? (r.waypointIds as string[]).map((id) => ({ collection: 'waypoints' as const, id })) : children.get(keyOf(k)) ?? [];
    for (const c of next) if (!all.has(keyOf(c))) { all.set(keyOf(c), c); pending.push(c); }
  }
  return [...all.values()];
}
export function moveSelection(m: MapModel, keys: readonly ObjectKey[], delta: Vec2): Transaction {
  if (!delta.every(Number.isFinite)) throw new Error('Movement must be finite');
  if (delta.every((n) => n === 0)) return transaction('Move objects', []);
  const expanded = moveKeys(m, keys), selected = new Set(expanded.map((k) => k.id)), ops: (Operation | null)[] = [];
  const follows = (r: JsonObject): boolean => {
    if (isObject(r.transform)) {
      let current: JsonObject | undefined = r, body: string | null = null; const seen = new Set<string>();
      while (current) {
        if (typeof current.bodyId === 'string') body = current.bodyId;
        const parent: string | undefined = typeof current.parentId === 'string' ? current.parentId : undefined;
        if (!parent || seen.has(parent)) break;
        if (selected.has(parent)) return true;
        seen.add(parent); current = m.collections.get('visuals')?.byId.get(parent);
      }
      return body !== null && selected.has(body);
    }
    let current: JsonObject | undefined = r; const seen = new Set<string>();
    while (current) {
      const a: JsonValue | undefined = current.anchor;
      const id: string | undefined = typeof current.parentId === 'string' ? current.parentId : typeof current.bodyId === 'string' ? current.bodyId : typeof current.ownerBodyId === 'string' ? current.ownerBodyId
        : isObject(a) ? (a.entityId ?? a.bodyId ?? a.footholdId) as string | undefined : undefined;
      if (!id || seen.has(id)) return false;
      if (selected.has(id)) return true;
      seen.add(id);
      current = m.collections.get('entities')?.byId.get(id) ?? m.collections.get('visuals')?.byId.get(id) ?? m.collections.get('footholds')?.byId.get(id);
    }
    return false;
  };
  for (const k of expanded) {
    const r = recordOf(m, k); if (!r) throw new Error('Selection changed');
    const set = (member: string, v: JsonValue): void => { ops.push(setOp(m, k.collection, k.id, member, v)); };
    if (['layers', 'routes'].includes(k.collection) || follows(r)) continue;
    if (k.collection === 'bodies' || k.collection === 'prefabPlacements') set('position', plus(r.position!, delta));
    else if (k.collection === 'visuals' && isObject(r.transform)) {
      // Convert the world delta through the inverse parent linear transform; body frames translate only.
      let d: Vec2 = delta; const parents: JsonObject[] = []; let id = r.parentId; const seen = new Set<string>();
      while (typeof id === 'string' && !seen.has(id)) { seen.add(id); const p = m.collections.get('visuals')?.byId.get(id); if (!p) break; parents.push(p); id = p.parentId; }
      for (const p of parents.reverse()) {
        const t = p.transform as JsonObject, s = t.scale as number[], angle = -(t.rotation as number) * Math.PI / 180;
        const x = d[0] * Math.cos(angle) - d[1] * Math.sin(angle), y = d[0] * Math.sin(angle) + d[1] * Math.cos(angle);
        d = [x / (s[0]! * (t.mirrorX ? -1 : 1)), y / (s[1]! * (t.mirrorY ? -1 : 1))];
      }
      set('transform', { ...r.transform, position: plus(r.transform.position!, d) });
    } else if (k.collection === 'footholds') {
      if (r.mode === 'solid') throw new Error('Move a solid foothold by selecting its owner body');
      set('a', plus(r.a!, delta)); set('b', plus(r.b!, delta));
    } else if (k.collection === 'regions' && isObject(r.shape)) {
      const s = r.shape;
      if (s.kind === 'rect') { const rect = s.rect as number[]; set('shape', { ...s, rect: [quantize(rect[0]! + delta[0]), quantize(rect[1]! + delta[1]), rect[2]!, rect[3]!] }); }
      else if (s.kind === 'circle') set('shape', { ...s, center: plus(s.center!, delta) });
      else set('shape', { ...s, points: (s.points as JsonValue[]).map((p) => plus(p, delta)) });
    } else if (isObject(r.anchor)) {
      if (r.anchor.kind === 'surface') {
        const f = m.collections.get('footholds')?.byId.get(r.anchor.footholdId as string);
        if (!f || !point(f.a) || !point(f.b)) throw new Error('Surface anchor requires an explicit reference repair');
        const dx = f.b[0] - f.a[0], dy = f.b[1] - f.a[1], length = Math.hypot(dx, dy);
        const u = Math.round(((r.anchor.u as number) + (delta[0] * dx + delta[1] * dy) / (length * length)) * 65536) / 65536;
        if (u < 0 || u > 1) throw new Error('Movement leaves the referenced surface; explicitly retarget the anchor first');
        set('anchor', { ...r.anchor, u, normalOffset: quantize((r.anchor.normalOffset as number) + (delta[0] * dy - delta[1] * dx) / length) });
      } else set('anchor', { ...r.anchor, point: plus(r.anchor.point!, delta) });
    } else if (k.collection === 'traversals' && Array.isArray(r.points)) {
      set('points', r.points.map((p) => plus(p, delta)));
      // Access anchors remain attached to their source supports; geometry validation refuses incompatible edits.
    } else throw new Error(`${k.id} has no independent position`);
  }
  return transaction('Move objects', ops);
}

export interface ClipboardDocument { readonly format: 'maplab.clipboard'; readonly version: 1; readonly mapId: string; readonly items: readonly PasteItem[] }
export function copySelection(m: MapModel, keys: readonly ObjectKey[]): string {
  return JSON.stringify({ format: 'maplab.clipboard', version: 1, mapId: m.id, items: moveKeys(m, keys).map((k) => ({ collection: k.collection, record: recordOf(m, k) })) });
}
export function readClipboard(text: string): ClipboardDocument {
  const parsed = parseJson(text);
  if (!parsed.ok) throw new Error('Clipboard is not bounded valid JSON');
  const v = parsed.value;
  if (!isObject(v) || v.format !== 'maplab.clipboard' || v.version !== 1 || typeof v.mapId !== 'string' || !Array.isArray(v.items) || v.items.length > 20000 || !v.items.every((i) => isObject(i) && OBJECT_COLLECTIONS.includes(i.collection as ObjectCollection) && isObject(i.record) && typeof i.record.id === 'string')) throw new Error('Expected a version 1 MapLab clipboard document');
  return v as unknown as ClipboardDocument;
}
export function pasteSelection(m: MapModel, text: string, repairs: ReadonlyMap<string, string> = new Map(), offset: Vec2 = [32, 32]): { tx: Transaction; keys: ObjectKey[] } {
  const clip = readClipboard(text);
  const rehome = (v: JsonValue): JsonValue => {
    if (Array.isArray(v)) return v.map(rehome);
    if (!isObject(v)) return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'mapId' && x === clip.mapId ? m.id : rehome(x)]));
  };
  const items = clip.items.map((i) => ({ ...i, record: rewriteRefs(rehome(i.record), m.id, (id) => repairs.get(id)) as JsonObject }));
  const plan = planPaste(m, items);
  if (plan.unresolved.length) throw new Error(`Repair clipboard references first: ${plan.unresolved.map((u) => `${u.path} → ${u.id}`).join('; ')}`);
  const pasted = pasteTransaction(m, plan), inserted = candidate(m, pasted);
  const keys = plan.items.map((i) => ({ collection: i.collection, id: i.record.id as string }));
  const ids = new Set(keys.map((k) => k.id));
  const positioned = keys.filter((k) => {
    const r = recordOf(inserted, k)!;
    if (['bodies', 'regions', 'visuals', 'prefabPlacements'].includes(k.collection)) return true;
    if (k.collection === 'footholds') return r.mode === 'oneWay' || ids.has(r.ownerBodyId as string);
    if (isObject(r.anchor)) return r.anchor.kind !== 'surface' || ids.has(r.anchor.footholdId as string);
    return k.collection === 'traversals' && Array.isArray(r.points);
  });
  const moved = moveSelection(inserted, positioned, offset);
  return { tx: transaction('Paste remapped objects', [...pasted.ops, ...moved.ops]), keys };
}
export function candidate(m: MapModel, tx: Transaction): MapModel {
  const r = applyTransaction(m, tx); if (!r.ok) throw new Error(r.problem.message); return r.model;
}
