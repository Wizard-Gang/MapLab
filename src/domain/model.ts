// Normalized authored map model (adopted H2, R1 H2): records keyed by persistent ID plus ordered ID
// lists, every other member as frozen JSON, and terrain cells in sparse packed chunks. Normalizing
// and denormalizing is lossless. Content validation stays in src/contracts. Pure: no React, DOM,
// storage or network.
import { canonical, isId, type JsonValue, type TerrainChunk } from '../contracts';
import { intentEntries, storeFromChunks, storeFromIntents, storeToChunks, chunkKey, type CellStore, type IntentEntry } from './paint';

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
/**
 * One terrain layer: its plain settings, its packed cells and its packed terrain intent (ML-014). Settings hold every
 * member except `chunks` and `terrainIntent`; intent entries serialize in row-then-column order.
 */
export interface TerrainLayerModel { readonly settings: JsonObject; readonly cells: CellStore; readonly intent: CellStore }
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
  /**
   * Groups share that namespace (ML-006): each implicit group named by an entity or encounter `groupId`,
   * and each group-kind layer, with its member count. Members may share a group; nothing else may.
   */
  readonly groups: ReadonlyMap<string, number>;
}
export interface ModelProblem { readonly code: string; readonly path: string; readonly message: string }
export type NormalizeResult = { readonly ok: true; readonly model: MapModel } | { readonly ok: false; readonly problems: readonly ModelProblem[] };

/** Defines an own data member, even one named `__proto__`, never invoking a prototype setter. */
export const setOwn = (o: Record<string, JsonValue>, key: string, value: JsonValue): void => {
  Object.defineProperty(o, key, { value, enumerable: true, writable: true, configurable: true });
};
/** Only own members count: `constructor` or `__proto__` never read through to a prototype. */
export const ownMember = (o: JsonObject, key: string): JsonValue | undefined => (Object.hasOwn(o, key) ? o[key] : undefined);

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
  // Own keys only: a member named like a built-in (`constructor`) has no nested IDs (ML-008 review note R2-1).
  for (const member of Object.hasOwn(NESTED, owner) ? (NESTED[owner] as readonly string[]) : []) {
    const items = isObject(value) ? value[member] : undefined;
    if (Array.isArray(items)) items.forEach((item, i) => { if (isObject(item) && typeof item.id === 'string') out.push([item.id, `${at}.${member}[${i}].id`]); });
  }
  return out;
}

/** The persistent IDs a record brings into the object namespace: its own and its nested ones. */
export const recordIds = (collection: ObjectCollection, record: JsonObject, at = '$'): [string, string][] =>
  [[record.id as string, `${at}.id`], ...nestedIds(collection, record, at)];

/** What a record or document member claims in the namespace: unique IDs with owners, and group memberships. */
export interface Claim {
  readonly ids: readonly (readonly [id: string, owner: string, path: string])[];
  readonly groups: readonly (readonly [id: string, path: string])[];
  /** A group-kind layer is both a unique layer ID and its own group. */
  readonly groupLayer: string | null;
}
const own = ownMember;

export function recordClaim(collection: ObjectCollection, record: JsonObject, at = '$'): Claim {
  const id = record.id as string;
  const ids = recordIds(collection, record, at).map(([n, p], i) => [n, i === 0 ? collection : `${collection}/${id}`, p] as const);
  const groupLayer = collection === 'layers' && own(record, 'kind') === 'group' ? id : null;
  const groups: (readonly [string, string])[] = groupLayer === null ? [] : [[id, `${at}.id`]];
  const groupId = own(record, 'groupId');
  if ((collection === 'entities' || collection === 'encounters') && typeof groupId === 'string') groups.push([groupId, `${at}.groupId`]);
  return { ids, groups, groupLayer };
}
export const fieldClaim = (member: string, value: JsonValue | undefined, at = `$.${member}`): Claim =>
  ({ ids: nestedIds(member, value, at).map(([n, p]) => [n, member, p] as const), groups: [], groupLayer: null });

export interface Collision { readonly code: 'id' | 'duplicate'; readonly path: string; readonly message: string }

/** Mutable working copy of a model's namespace; a model only ever publishes a finished copy. */
export class Namespace {
  readonly owners: Map<string, string>;
  readonly groups: Map<string, number>;
  constructor(from?: Pick<MapModel, 'owners' | 'groups'>) { this.owners = new Map(from?.owners); this.groups = new Map(from?.groups); }

  release(c: Claim): void {
    for (const [id] of c.ids) this.owners.delete(id);
    for (const [g] of c.groups) { const n = (this.groups.get(g) ?? 0) - 1; if (n > 0) this.groups.set(g, n); else this.groups.delete(g); }
  }

  /** Claims every ID, stopping at the first collision. */
  claim(c: Claim): Collision | null {
    for (const [id, owner, path] of c.ids) {
      if (!isId(id)) return { code: 'id', path, message: `${JSON.stringify(id)} is not a persistent ID` };
      if (this.owners.has(id) || (this.groups.has(id) && c.groupLayer !== id)) return { code: 'duplicate', path, message: `${id} is already used by ${this.owners.get(id) ?? 'a group'}` };
      this.owners.set(id, owner);
    }
    for (const [g, path] of c.groups) {
      if (!isId(g)) return { code: 'id', path, message: `${JSON.stringify(g)} is not a persistent group ID` };
      if (this.owners.has(g) && !this.groups.has(g) && c.groupLayer !== g) return { code: 'duplicate', path, message: `Group ${g} collides with ${this.owners.get(g)}` };
      this.groups.set(g, (this.groups.get(g) ?? 0) + 1);
    }
    return null;
  }
}

export function normalize(source: JsonValue): NormalizeResult {
  const problems: ModelProblem[] = [];
  const problem = (code: string, path: string, message: string): void => { problems.push({ code, path, message }); };
  if (!isObject(source) || source.format !== 'maplab.map' || source.version !== 1 || !isId(source.id)) {
    return { ok: false, problems: [{ code: 'model.format', path: '$', message: 'Expected a maplab.map v1 document with a valid ID' }] };
  }
  const doc = deepFreeze(structuredClone(source) as JsonObject);
  const namespace = new Namespace();
  const claim = (c: Claim): void => {
    const hit = namespace.claim(c);
    if (hit) problem(hit.code === 'id' ? 'model.id' : 'model.duplicate-id', hit.path, hit.message);
  };
  const fields = new Map<string, JsonValue>();
  const collections = new Map<CollectionName, Collection>();
  for (const [member, value] of Object.entries(doc)) {
    if (!STRUCTURED.has(member)) {
      fields.set(member, value);
      claim(fieldClaim(member, value));
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
      } else claim(recordClaim(member as ObjectCollection, record, at));
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
      const { chunks, terrainIntent, ...settings } = t as JsonObject & { chunks: readonly TerrainChunk[]; terrainIntent: unknown };
      const intents = new Set<string>();
      const wellFormed = Array.isArray(terrainIntent) && terrainIntent.every((x) => isObject(x) && Number.isSafeInteger(x.column) && Number.isSafeInteger(x.row) && typeof x.terrainId === 'string');
      if (!wellFormed) problem('model.intent', `$.terrain[${i}].terrainIntent`, 'terrainIntent must be an array of {column, row, terrainId} cells');
      else (terrainIntent as readonly IntentEntry[]).forEach((x, j) => {
        const key = chunkKey(x.column, x.row);
        if (intents.has(key)) problem('model.intent', `$.terrain[${i}].terrainIntent[${j}]`, `Terrain intent for cell ${key} is listed twice`);
        intents.add(key);
      });
      const keys = new Set<string>();
      chunks.forEach((c, j) => {
        const key = chunkKey(c.column, c.row);
        if (keys.has(key) || !Array.isArray(c.cells) || c.cells.length !== 1024) problem('model.chunk', `$.terrain[${i}].chunks[${j}]`, `Chunk ${key} is repeated or malformed`);
        keys.add(key);
      });
      if (byLayer.has(settings.layerId as string)) problem('model.duplicate-terrain', `$.terrain[${i}].layerId`, `Terrain for ${settings.layerId} is listed twice`);
      else if (problems.length === 0) byLayer.set(settings.layerId as string, { settings: Object.freeze(settings), cells: storeFromChunks(chunks), intent: storeFromIntents(terrainIntent as readonly IntentEntry[]) });
    });
    terrain = { order: Object.freeze([...byLayer.keys()]), byLayer };
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, model: { id: doc.id as string, fields, collections, terrain, owners: namespace.owners, groups: namespace.groups } };
}

/** The authored document this model represents. */
export function denormalize(model: MapModel): JsonObject {
  const out: Record<string, JsonValue> = Object.fromEntries(model.fields);
  for (const [name, c] of model.collections) out[name] = c.order.map((id) => c.byId.get(id) as JsonObject);
  if (model.terrain) {
    out.terrain = model.terrain.order.map((layerId) => {
      const t = model.terrain?.byLayer.get(layerId) as TerrainLayerModel;
      return { ...t.settings, chunks: storeToChunks(t.cells) as unknown as JsonValue, terrainIntent: intentEntries(t.intent) as unknown as JsonValue };
    });
  }
  return out;
}

/** RFC 8785 text of the authored document: equal models encode equal content. */
export const encode = (model: MapModel): string => canonical(denormalize(model) as JsonValue);
