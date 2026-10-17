// Evaluates the closed JSON Schema 2020-12 subset MapLab publishes. Every `$ref` must point
// into the same document's `$defs`; nothing is ever fetched. A schema using any other keyword,
// a remote reference or an inexact `multipleOf` is refused when it is compiled (fail closed).
// Diagnostic codes are `<innermost $defs name>.<keyword>`, or `<root name>.<keyword>`.
import { error, type Diagnostic, type PathSegment } from './diagnostics';
import type { JsonValue } from './json';

export const SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

type SchemaObject = { readonly [keyword: string]: JsonValue };
type SchemaNode = boolean | SchemaObject;

const CODES: Readonly<Record<string, string>> = {
  type: 'type', const: 'const', enum: 'enum', required: 'required', additionalProperties: 'additional-property',
  items: 'items', minItems: 'min-items', maxItems: 'max-items', uniqueItems: 'unique-items', minimum: 'minimum',
  maximum: 'maximum', exclusiveMinimum: 'exclusive-minimum', exclusiveMaximum: 'exclusive-maximum',
  multipleOf: 'multiple-of', pattern: 'pattern', minLength: 'min-length', maxLength: 'max-length',
};
const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', '$defs', '$ref', 'properties', 'prefixItems']);
const TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);
const LOCAL_REF = /^#\/\$defs\/([A-Za-z0-9_-]+)$/;
const count = (v: JsonValue): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const SHAPES: Readonly<Record<string, (v: JsonValue) => boolean>> = {
  minimum: (v) => typeof v === 'number', maximum: (v) => typeof v === 'number',
  exclusiveMinimum: (v) => typeof v === 'number', exclusiveMaximum: (v) => typeof v === 'number',
  minItems: count, maxItems: count, minLength: count, maxLength: count,
  uniqueItems: (v) => typeof v === 'boolean', enum: Array.isArray, prefixItems: Array.isArray,
  required: (v) => Array.isArray(v) && v.every((name) => typeof name === 'string'),
  properties: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
};

export class SchemaError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface CompiledSchema {
  readonly root: SchemaObject;
  readonly rootName: string;
  readonly defs: ReadonlyMap<string, SchemaNode>;
  readonly patterns: ReadonlyMap<string, RegExp>;
}

const isObject = (v: unknown): v is { readonly [key: string]: JsonValue } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function compileSchema(schema: JsonValue, rootName: string): CompiledSchema {
  if (!isObject(schema) || schema.$schema !== SCHEMA_DIALECT) throw new SchemaError('schema.dialect', 'Root schema must declare JSON Schema 2020-12');
  const rawDefs = schema.$defs ?? {};
  if (!isObject(rawDefs)) throw new SchemaError('schema.invalid', '$defs must be an object');
  const defs = new Map<string, SchemaNode>();
  for (const [name, def] of Object.entries(rawDefs)) defs.set(name, node(def, `$defs/${name}`));
  const patterns = new Map<string, RegExp>();
  const check = (n: SchemaNode, at: string): void => {
    if (typeof n === 'boolean') return;
    for (const [keyword, value] of Object.entries(n)) {
      if (!ANNOTATIONS.has(keyword) && !Object.hasOwn(CODES, keyword)) throw new SchemaError('schema.unsupported-keyword', `Unsupported keyword ${keyword} at ${at}`);
      if ((keyword === '$schema' || keyword === '$defs') && at !== '#') throw new SchemaError('schema.invalid', `Nested ${keyword} at ${at}`);
      const expected = SHAPES[keyword];
      if (expected && !expected(value)) throw new SchemaError('schema.invalid', `Malformed ${keyword} at ${at}`);
      if (keyword === '$ref') {
        const local = typeof value === 'string' ? LOCAL_REF.exec(value) : null;
        if (!local) throw new SchemaError('schema.remote-ref', `Only local #/$defs references are allowed: ${String(value)} at ${at}`);
        if (!defs.has(local[1] as string)) throw new SchemaError('schema.unresolved-ref', `Unknown definition ${String(value)} at ${at}`);
      }
      if (keyword === 'type' && !(typeof value === 'string' && TYPES.has(value))) throw new SchemaError('schema.invalid', `Invalid type at ${at}`);
      if (keyword === 'additionalProperties' && value !== false) throw new SchemaError('schema.invalid', `additionalProperties must be false at ${at}`);
      if (keyword === 'multipleOf' && !(typeof value === 'number' && value > 0 && value === 2 ** Math.round(Math.log2(value)))) {
        throw new SchemaError('schema.invalid', `multipleOf must be an exact power of two at ${at}`);
      }
      if (keyword === 'pattern') {
        if (typeof value !== 'string') throw new SchemaError('schema.invalid', `Invalid pattern at ${at}`);
        try { patterns.set(value, new RegExp(value, 'u')); } catch { throw new SchemaError('schema.invalid', `Invalid pattern at ${at}`); }
      }
    }
    for (const [name, sub] of Object.entries(isObject(n.properties) ? n.properties : {})) check(node(sub, `${at}/properties/${name}`), `${at}/properties/${name}`);
    if (Array.isArray(n.prefixItems)) n.prefixItems.forEach((sub, i) => check(node(sub, `${at}/prefixItems/${i}`), `${at}/prefixItems/${i}`));
    if (n.items !== undefined) check(node(n.items, `${at}/items`), `${at}/items`);
  };
  const root = node(schema, '#');
  check(root, '#');
  for (const [name, def] of defs) check(def, `#/$defs/${name}`);
  return { root: schema, rootName, defs, patterns };
}

function node(value: JsonValue | undefined, at: string): SchemaNode {
  if (typeof value === 'boolean' || isObject(value)) return value;
  throw new SchemaError('schema.invalid', `Schema expected at ${at}`);
}

/** Canonical text for JSON equality (key order irrelevant; 0 equals −0). */
export function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k] as JsonValue)}`).join(',')}}`;
  return JSON.stringify(value);
}

function typeMatches(type: string, v: JsonValue): boolean {
  switch (type) {
    case 'null': return v === null;
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'object': return isObject(v);
    case 'array': return Array.isArray(v);
    default: return typeof v === type;
  }
}

export function evaluate(schema: CompiledSchema, value: JsonValue, limit = 100): Diagnostic[] {
  const out: Diagnostic[] = [];
  const report = (prefix: string, keyword: string, path: readonly PathSegment[], message: string): void => {
    if (out.length < limit) out.push(error(`${prefix}.${CODES[keyword] ?? keyword}`, path, message));
  };
  const visit = (n: SchemaNode, v: JsonValue, path: PathSegment[], prefix: string): void => {
    if (out.length >= limit || n === true) return;
    if (n === false) return report(prefix, 'items', path, 'No value is allowed here');
    if (typeof n.$ref === 'string') {
      const name = (LOCAL_REF.exec(n.$ref) as RegExpExecArray)[1] as string;
      visit(schema.defs.get(name) as SchemaNode, v, path, name);
    }
    if (typeof n.type === 'string' && !typeMatches(n.type, v)) return report(prefix, 'type', path, `Expected ${n.type}`);
    if (n.const !== undefined && canonical(v) !== canonical(n.const)) report(prefix, 'const', path, `Expected ${JSON.stringify(n.const)}`);
    if (Array.isArray(n.enum) && !n.enum.some((e) => canonical(e) === canonical(v))) report(prefix, 'enum', path, `Expected one of ${n.enum.map((e) => JSON.stringify(e)).join(', ')}`);
    if (typeof v === 'number') {
      if (typeof n.minimum === 'number' && v < n.minimum) report(prefix, 'minimum', path, `Below minimum ${n.minimum}`);
      if (typeof n.maximum === 'number' && v > n.maximum) report(prefix, 'maximum', path, `Above maximum ${n.maximum}`);
      if (typeof n.exclusiveMinimum === 'number' && v <= n.exclusiveMinimum) report(prefix, 'exclusiveMinimum', path, `Must exceed ${n.exclusiveMinimum}`);
      if (typeof n.exclusiveMaximum === 'number' && v >= n.exclusiveMaximum) report(prefix, 'exclusiveMaximum', path, `Must be below ${n.exclusiveMaximum}`);
      if (typeof n.multipleOf === 'number' && !Number.isInteger(v / n.multipleOf)) report(prefix, 'multipleOf', path, `Not a multiple of ${n.multipleOf}`);
    }
    if (typeof v === 'string') {
      const length = [...v].length;
      if (typeof n.minLength === 'number' && length < n.minLength) report(prefix, 'minLength', path, `Shorter than ${n.minLength}`);
      if (typeof n.maxLength === 'number' && length > n.maxLength) report(prefix, 'maxLength', path, `Longer than ${n.maxLength}`);
      if (typeof n.pattern === 'string' && !(schema.patterns.get(n.pattern) as RegExp).test(v)) report(prefix, 'pattern', path, `Does not match ${n.pattern}`);
    }
    if (Array.isArray(v)) {
      if (typeof n.minItems === 'number' && v.length < n.minItems) report(prefix, 'minItems', path, `Fewer than ${n.minItems} items`);
      if (typeof n.maxItems === 'number' && v.length > n.maxItems) report(prefix, 'maxItems', path, `More than ${n.maxItems} items`);
      if (n.uniqueItems === true && new Set(v.map(canonical)).size !== v.length) report(prefix, 'uniqueItems', path, 'Items must be unique');
      const tuple = Array.isArray(n.prefixItems) ? n.prefixItems : [];
      v.forEach((item, i) => {
        const sub = i < tuple.length ? tuple[i] : n.items;
        if (sub !== undefined) visit(sub as SchemaNode, item, [...path, i], prefix);
      });
    }
    if (isObject(v)) {
      if (Array.isArray(n.required)) {
        for (const name of n.required) if (typeof name === 'string' && !Object.hasOwn(v, name)) report(prefix, 'required', [...path, name], `Missing required member ${JSON.stringify(name)}`);
      }
      const properties = isObject(n.properties) ? n.properties : {};
      for (const [name, sub] of Object.entries(properties)) if (Object.hasOwn(v, name)) visit(sub as SchemaNode, v[name] as JsonValue, [...path, name], prefix);
      if (n.additionalProperties === false) {
        for (const name of Object.keys(v)) if (!Object.hasOwn(properties, name)) report(prefix, 'additionalProperties', [...path, name], `Unknown member ${JSON.stringify(name)}`);
      }
    }
  };
  visit(schema.root, value, [], schema.rootName);
  return out;
}
