// Library form (adopted F5, R1 F4): the bytes MapLab writes into a library folder. UTF-8, LF, a trailing
// newline and 2-space indentation; keys in the published schema's `properties` order; domain-ordered
// arrays; shortest round-trip numbers. Deterministic, so equal content always has one digest. Pure.
import catalogSchema from '../../schemas/maplab.catalog.v1.schema.json' with { type: 'json' };
import mapSchema from '../../schemas/maplab.map.v1.schema.json' with { type: 'json' };
import movementSchema from '../../schemas/maplab.movement.v1.schema.json' with { type: 'json' };
import prefabSchema from '../../schemas/maplab.prefab.v1.schema.json' with { type: 'json' };
import projectSchema from '../../schemas/maplab.project.v1.schema.json' with { type: 'json' };
import tilesetSchema from '../../schemas/maplab.tileset.v1.schema.json' with { type: 'json' };
import type { JsonValue } from './json';

type JsonObject = { readonly [key: string]: JsonValue };
type Schema = { readonly [key: string]: JsonValue };

/** The formats a library may hold, each with its published schema. */
export const LIBRARY_SCHEMAS: ReadonlyMap<string, Schema> = new Map<string, Schema>([
  ['maplab.map', mapSchema as Schema], ['maplab.prefab', prefabSchema as Schema], ['maplab.tileset', tilesetSchema as Schema],
  ['maplab.movement', movementSchema as Schema], ['maplab.catalog', catalogSchema as Schema], ['maplab.project', projectSchema as Schema],
]);

const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const put = (o: Record<string, JsonValue>, key: string, value: JsonValue): void => {
  Object.defineProperty(o, key, { value, enumerable: true, writable: true, configurable: true });
};

function resolve(node: JsonValue | undefined, root: Schema): Schema {
  let n = node;
  for (let hops = 0; isObject(n) && typeof n.$ref === 'string'; hops++) {
    const name = /^#\/\$defs\/([^/]+)$/.exec(n.$ref)?.[1];
    const defs = root.$defs;
    if (hops > 64 || name === undefined || !isObject(defs)) return {};
    n = defs[name];
  }
  return isObject(n) ? n : {};
}

function typeFits(type: JsonValue | undefined, v: JsonValue): boolean {
  if (type === undefined) return true;
  const one = (t: JsonValue): boolean => t === 'null' ? v === null : t === 'array' ? Array.isArray(v) : t === 'object' ? isObject(v)
    : t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' : typeof v === t;
  return Array.isArray(type) ? type.some(one) : one(type);
}

/** The `oneOf` branch a value belongs to: the type fits, required members exist and every const/enum member agrees. */
function branch(options: readonly JsonValue[], v: JsonValue, root: Schema): Schema {
  let best: Schema = {}, score = -1;
  for (const option of options) {
    const node = resolve(option, root);
    if (!typeFits(node.type, v)) continue;
    let s = 0, fits = true;
    if (isObject(v)) {
      const required = Array.isArray(node.required) ? node.required : [];
      if (!required.every((k) => typeof k === 'string' && Object.hasOwn(v, k))) fits = false;
      const props = isObject(node.properties) ? node.properties : {};
      for (const [k, p] of Object.entries(props)) {
        const want = resolve(p, root);
        if (!Object.hasOwn(v, k) || !('const' in want || Array.isArray(want.enum))) continue;
        const has = v[k] as JsonValue;
        if ('const' in want ? want.const === has : (want.enum as JsonValue[]).includes(has)) s++;
        else fits = false;
      }
    }
    if (fits && s > score) { best = node; score = s; }
  }
  return best;
}

/** Reorders every object's keys to its schema's `properties` order; members the schema does not name follow, sorted. */
function orderKeys(v: JsonValue, node: Schema, root: Schema): JsonValue {
  let n = node;
  if (Array.isArray(n.oneOf)) n = branch(n.oneOf, v, root);
  if (Array.isArray(v)) {
    const prefix = Array.isArray(n.prefixItems) ? n.prefixItems : [];
    return v.map((item, i) => orderKeys(item, resolve(prefix[i] ?? n.items, root), root));
  }
  if (!isObject(v)) return v;
  const props = isObject(n.properties) ? n.properties : {};
  const extra = isObject(n.additionalProperties) ? resolve(n.additionalProperties, root) : {};
  const out: Record<string, JsonValue> = {};
  for (const k of Object.keys(props)) if (Object.hasOwn(v, k)) put(out, k, orderKeys(v[k] as JsonValue, resolve(props[k], root), root));
  for (const k of Object.keys(v).filter((key) => !Object.hasOwn(props, key)).sort()) put(out, k, orderKeys(v[k] as JsonValue, extra, root));
  return out;
}

const text = (v: JsonValue | undefined): string => (typeof v === 'string' ? v : '');
const num = (v: JsonValue | undefined): number => (typeof v === 'number' ? v : 0);
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byId = (a: JsonValue, b: JsonValue): number => cmp(text(isObject(a) ? a.id : undefined), text(isObject(b) ? b.id : undefined));
type Order = (a: JsonValue, b: JsonValue) => number;
const field = (v: JsonValue, k: string): JsonValue | undefined => (isObject(v) ? v[k] : undefined);

/** Arrays at these members are sorted (stably); every other array keeps its order (R1 F4 "order preserved"). */
const MAP_SORTED: Readonly<Record<string, Order>> = {
  dependencies: byId, assets: byId, presentations: byId, visuals: byId, materials: byId, bodies: byId, footholds: byId, traversals: byId,
  regions: byId, entities: byId, waypoints: byId, routes: byId, triggers: byId, encounters: byId, flags: byId, prefabPlacements: byId,
  layers: (a, b) => num(field(a, 'order')) - num(field(b, 'order')) || byId(a, b),
};
/** Members whose items carry nested IDs that sort by ID. */
const NESTED_SORTED: Readonly<Record<string, readonly string[]>> = {
  bodies: ['shapes'], traversals: ['access'], camera: ['zones'], environment: ['zones'], navigation: ['modeVolumes', 'links', 'overrides'],
};
/** String sets (R1 F4): masks, tags, ability lists, actor categories, profile IDs, body IDs and expanded IDs. */
const STRING_SETS: ReadonlySet<string> = new Set(['mask', 'tags', 'abilityTags', 'forbiddenMaterialTags', 'requiredAbilities', 'actorCategories',
  'profileIds', 'bodyIds', 'expandedIds']);

const sorted = (v: JsonValue | undefined, order: Order): JsonValue | undefined => (Array.isArray(v) ? [...v].sort(order) : v);
const sortStrings = (v: JsonValue | undefined): JsonValue | undefined =>
  (Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...(v as string[])].sort(cmp) : v);

/** Sorts every string set below `v`; override `actions` are a set only inside `navigation` (trigger actions are a sequence). */
function sortSets(v: JsonValue, inNavigation: boolean): JsonValue {
  if (Array.isArray(v)) return v.map((x) => sortSets(x, inNavigation));
  if (!isObject(v)) return v;
  const out: Record<string, JsonValue> = {};
  for (const [k, x] of Object.entries(v)) {
    const set = STRING_SETS.has(k) || (inNavigation && k === 'actions');
    put(out, k, (set ? sortStrings(x) : sortSets(x, inNavigation || k === 'navigation')) as JsonValue);
  }
  return out;
}

function mapContent(doc: JsonObject): JsonObject {
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(doc)) {
    let x: JsonValue = v;
    // Own keys only: a member named like a built-in (`constructor`) is never mistaken for a rule.
    const order = Object.hasOwn(MAP_SORTED, k) ? MAP_SORTED[k] : undefined;
    if (order) x = sorted(x, order) as JsonValue;
    const nested = Object.hasOwn(NESTED_SORTED, k) ? NESTED_SORTED[k] : undefined;
    if (nested) {
      const sortIn = (o: JsonValue): JsonValue => {
        if (!isObject(o)) return o;
        const copy: Record<string, JsonValue> = {};
        for (const [m, y] of Object.entries(o)) put(copy, m, (nested.includes(m) ? sorted(y, byId) : y) as JsonValue);
        return copy;
      };
      x = Array.isArray(x) ? x.map(sortIn) : sortIn(x);
    }
    if (k === 'terrain' && Array.isArray(x)) {
      // Chunks and terrain-intent cells (ML-014) are sets keyed by coordinates: row, then column.
      const byCell: Order = (a, b) => num(field(a, 'row')) - num(field(b, 'row')) || num(field(a, 'column')) - num(field(b, 'column'));
      x = x.map((t) => (isObject(t) && Array.isArray(t.chunks) ? { ...t, chunks: sorted(t.chunks, byCell) as JsonValue } : t))
        .map((t) => (isObject(t) && Array.isArray(t.terrainIntent) ? { ...t, terrainIntent: sorted(t.terrainIntent, byCell) as JsonValue } : t));
    }
    put(out, k, x);
  }
  return out;
}

function domainOrder(doc: JsonObject): JsonObject {
  const swap = (k: string, order: Order): JsonObject => (Array.isArray(doc[k]) ? { ...doc, [k]: sorted(doc[k], order) as JsonValue } : doc);
  switch (doc.format) {
    case 'maplab.map': return mapContent(doc);
    case 'maplab.prefab': {
      const content = isObject(doc.content) ? mapContent(doc.content) : doc.content;
      const out: Record<string, JsonValue> = {};
      for (const [k, v] of Object.entries(doc)) put(out, k, (k === 'content' ? content : k === 'dependencies' ? sorted(v, byId) : v) as JsonValue);
      return out;
    }
    case 'maplab.tileset': return ['tiles', 'terrains', 'rules'].reduce<JsonObject>((d, k) => (Array.isArray(d[k]) ? { ...d, [k]: sorted(d[k], byId) as JsonValue } : d), doc);
    case 'maplab.catalog': return swap('entries', (a, b) => cmp(text(field(a, 'key')), text(field(b, 'key'))) || num(field(a, 'version')) - num(field(b, 'version')));
    case 'maplab.movement': return swap('abilities', (a, b) => cmp(text(field(a, 'kind')), text(field(b, 'kind'))));
    case 'maplab.project': return swap('documents', byId);
    default: return doc;
  }
}

/** The library-form value of `document`: domain-ordered arrays and schema-ordered keys. Throws for an unknown format. */
export function libraryValue(value: JsonValue): JsonValue {
  const schema = isObject(value) && typeof value.format === 'string' ? LIBRARY_SCHEMAS.get(value.format) : undefined;
  if (!schema || !isObject(value)) throw new RangeError('Library form needs a maplab map, prefab, tileset, movement, catalog or project document');
  return orderKeys(sortSets(domainOrder(value), false), schema, schema);
}

/** The exact library-form text of `value`. */
export const libraryForm = (value: JsonValue): string => `${JSON.stringify(libraryValue(value), null, 2)}\n`;
