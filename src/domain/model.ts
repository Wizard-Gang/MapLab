// Normalized authored map model (adopted H2, R1 H2): records keyed by persistent ID plus ordered ID
// lists, every other member as frozen JSON, and terrain cells in sparse packed chunks. Normalizing
// and denormalizing is lossless. Content validation stays in src/contracts. Pure: no React, DOM,
// storage or network.
import { canonical, isId, type JsonValue, type TerrainChunk } from '../contracts';
import { storeFromChunks, storeToChunks, chunkKey, type CellStore } from './paint';

export type JsonObject = { readonly [key: string]: JsonValue };

/** Top-level arrays of records in the map's object namespace. */
export const OBJECT_COLLECTIONS = ['assets', 'presentations', 'layers', 'visuals', 'materials', 'bodies', 'footholds', 'traversals',
  'regions', 'entities', 'waypoints', 'routes', 'triggers', 'encounters', 'flags', 'prefabPlacements'] as const;
export type ObjectCollection = (typeof OBJECT_COLLECTIONS)[number];
/** Dependencies name other documents, so their IDs form a separate namespace. */
export type CollectionName = ObjectCollection | 'dependencies';
export const COLLECTIONS: readonly CollectionName[] = [...OBJECT_COLLECTIONS, 'dependencies'];
/** Members a transaction may never set: the document identity. */
export const FIXED_MEMBERS: ReadonlySet<string> = new Set(['format', 'version', 'id']);
/** Members the model holds as collections or terrain rather than as plain JSON fields. */
export const STRUCTURED: ReadonlySet<string> = new Set([...COLLECTIONS, 'terrain']);

/** Arrays inside a record or a document member whose items carry nested persistent IDs. */
const NESTED: Readonly<Record<string, readonly string[]>> = {
  bodies: ['shapes'], traversals: ['access'], camera: ['zones'], environment: ['zones'], navigation: ['modeVolumes', 'links', 'overrides'],
};

export interface Collection { readonly order: readonly string[]; readonly byId: ReadonlyMap<string, JsonObject> }
export interface TerrainLayerModel { readonly settings: JsonObject; readonly cells: CellStore }
export interface MapModel {
  readonly id: string;
  /** Every member other than the collections and `terrain`, in source order. */
  readonly fields: ReadonlyMap<string, JsonValue>;
  /** Collections present in the source; an absent one stays absent. */
  readonly collections: ReadonlyMap<CollectionName, Collection>;
  /** Terrain layers keyed by `layerId`, or null when the source has no `terrain` member. */
  readonly terrain: Readonly<{ order: readonly string[]; byLayer: ReadonlyMap<string, TerrainLayerModel> }> | null;
  /** Object namespace: each top-level and nested persistent ID and its owner. */
  readonly owners: ReadonlyMap<string, string>;
}
export interface ModelProblem { readonly code: string; readonly path: string; readonly message: string }
export type NormalizeResult = { readonly ok: true; readonly model: MapModel } | { readonly ok: false; readonly problems: readonly ModelProblem[] };

export const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const same = (a: JsonValue | undefined, b: JsonValue | undefined): boolean => (a === undefined || b === undefined ? a === b : canonical(a) === canonical(b));

/** Freezes a JSON value in place, all the way down, so a model can share it without copying. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}

/** Nested persistent IDs under `owner` (a collection name or a document member), with their JSON paths. */
export function nestedIds(owner: string, value: JsonValue | undefined, at: string): [string, string][] {
  const out: [string, string][] = [];
  for (const member of NESTED[owner] ?? []) {
    const items = isObject(value) ? value[member] : undefined;
    if (Array.isArray(items)) items.forEach((item, i) => { if (isObject(item) && typeof item.id === 'string') out.push([item.id, `${at}.${member}[${i}].id`]); });
  }
  return out;
}

/** The persistent IDs a record brings into the object namespace: its own and its nested ones. */
export const recordIds = (collection: ObjectCollection, record: JsonObject, at = '$'): [string, string][] =>
  [[record.id as string, `${at}.id`], ...nestedIds(collection, record, at)];

export function normalize(document: JsonValue): NormalizeResult {
  const problems: ModelProblem[] = [];
  const problem = (code: string, path: string, message: string): void => { problems.push({ code, path, message }); };
  if (!isObject(document) || document.format !== 'maplab.map' || document.version !== 1 || !isId(document.id)) {
    return { ok: false, problems: [{ code: 'model.format', path: '$', message: 'Expected a maplab.map v1 document with a valid ID' }] };
  }
  const doc = deepFreeze(structuredClone(document) as JsonObject);
  const owners = new Map<string, string>();
  const claim = (id: string, owner: string, path: string): void => {
    if (!isId(id)) problem('model.id', path, `${JSON.stringify(id)} is not a persistent ID`);
    else if (owners.has(id)) problem('model.duplicate-id', path, `${id} is already used by ${owners.get(id)}`);
    else owners.set(id, owner);
  };
  const fields = new Map<string, JsonValue>();
  const collections = new Map<CollectionName, Collection>();
  for (const [member, value] of Object.entries(doc)) {
    if (!STRUCTURED.has(member)) {
      fields.set(member, value);
      for (const [id, path] of nestedIds(member, value, `$.${member}`)) claim(id, member, path);
      continue;
    }
    if (member === 'terrain') continue;
    if (!Array.isArray(value) || !value.every((r) => isObject(r) && typeof r.id === 'string')) { problem('model.shape', `$.${member}`, `${member} must be an array of records with IDs`); continue; }
    const records = value as readonly JsonObject[];
    const byId = new Map<string, JsonObject>();
    records.forEach((record, i) => {
      const at = `$.${member}[${i}]`;
      const id = record.id as string;
      if (member === 'dependencies') {
        if (byId.has(id)) problem('model.duplicate-dependency', `${at}.id`, `Dependency ${id} is listed twice`);
      } else for (const [nested, path] of recordIds(member as ObjectCollection, record, at)) claim(nested, nested === id ? member : `${member}/${id}`, path);
      byId.set(id, record);
    });
    collections.set(member as CollectionName, { order: Object.freeze(records.map((r) => r.id as string)), byId });
  }
  let terrain: MapModel['terrain'] = null;
  if (Object.hasOwn(doc, 'terrain')) {
    const layers = doc.terrain;
    const byLayer = new Map<string, TerrainLayerModel>();
    if (!Array.isArray(layers) || !layers.every((t) => isObject(t) && typeof t.layerId === 'string' && Array.isArray(t.chunks))) problem('model.shape', '$.terrain', 'terrain must be an array of layers with chunks');
    else layers.forEach((t, i) => {
      const { chunks, ...settings } = t as JsonObject & { chunks: readonly TerrainChunk[] };
      const keys = new Set<string>();
      chunks.forEach((c, j) => {
        const key = chunkKey(c.column, c.row);
        if (keys.has(key) || !Array.isArray(c.cells) || c.cells.length !== 1024) problem('model.chunk', `$.terrain[${i}].chunks[${j}]`, `Chunk ${key} is repeated or malformed`);
        keys.add(key);
      });
      if (byLayer.has(settings.layerId as string)) problem('model.duplicate-terrain', `$.terrain[${i}].layerId`, `Terrain for ${settings.layerId} is listed twice`);
      else if (problems.length === 0) byLayer.set(settings.layerId as string, { settings: Object.freeze(settings), cells: storeFromChunks(chunks) });
    });
    terrain = { order: Object.freeze([...byLayer.keys()]), byLayer };
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, model: { id: doc.id as string, fields, collections, terrain, owners } };
}

/** The authored document this model represents. */
export function denormalize(model: MapModel): JsonObject {
  const out: Record<string, JsonValue> = Object.fromEntries(model.fields);
  for (const [name, c] of model.collections) out[name] = c.order.map((id) => c.byId.get(id) as JsonObject);
  if (model.terrain) {
    out.terrain = model.terrain.order.map((layerId) => {
      const t = model.terrain?.byLayer.get(layerId) as TerrainLayerModel;
      return { ...t.settings, chunks: storeToChunks(t.cells) as unknown as JsonValue };
    });
  }
  return out;
}

/** RFC 8785 text of the authored document: equal models encode equal content. */
export const encode = (model: MapModel): string => canonical(denormalize(model) as JsonValue);
