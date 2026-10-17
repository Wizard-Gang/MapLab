// Independent evaluator for the closed JSON Schema 2020-12 subset MapLab publishes in schemas/.
// Written from the dialect, not from src/contracts: unknown keywords, nested $defs, remote or
// unresolved $ref and non-power-of-two multipleOf are refused when a schema is compiled.
import { ReaderError, jcs, pathText } from './json.mjs';

export const DIALECT = 'https://json-schema.org/draft/2020-12/schema';
const ANNOTATION = new Set(['$schema', '$id', '$comment', 'title', 'description', '$defs']);
const ASSERTION = new Set(['type', 'const', 'enum', 'required', 'properties', 'additionalProperties', 'propertyNames', 'maxProperties',
  'prefixItems', 'items', 'minItems', 'maxItems', 'uniqueItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'multipleOf', 'pattern', 'minLength', 'maxLength', 'oneOf', '$ref']);
const REF = /^#\/\$defs\/([A-Za-z0-9_-]+)$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Compiles one published schema. `name` labels diagnostics. Throws ReaderError on any unsupported construct. */
export function compile(schema, name) {
  const bad = (message) => { throw new ReaderError('schema.unsupported', `${name}: ${message}`); };
  if (!isObject(schema) || schema.$schema !== DIALECT) bad('root must declare JSON Schema 2020-12');
  const defs = isObject(schema.$defs) ? schema.$defs : schema.$defs === undefined ? {} : bad('$defs must be an object');
  const patterns = new Map();
  const visit = (node, at) => {
    if (typeof node === 'boolean') return;
    if (!isObject(node)) bad(`schema expected at ${at}`);
    for (const [k, v] of Object.entries(node)) {
      if (!ANNOTATION.has(k) && !ASSERTION.has(k)) bad(`unsupported keyword ${k} at ${at}`);
      if ((k === '$defs' || k === '$schema') && at !== '#') bad(`nested ${k} at ${at}`);
      if (k === '$ref' && !(typeof v === 'string' && REF.test(v) && Object.hasOwn(defs, REF.exec(v)[1]))) bad(`non-local or unresolved $ref at ${at}`);
      if (k === 'multipleOf' && !(typeof v === 'number' && v > 0 && 2 ** Math.round(Math.log2(v)) === v)) bad(`inexact multipleOf at ${at}`);
      if (k === 'pattern') { try { patterns.set(v, new RegExp(v, 'u')); } catch { bad(`invalid pattern at ${at}`); } }
    }
    if (isObject(node.properties)) for (const [k, v] of Object.entries(node.properties)) visit(v, `${at}/properties/${k}`);
    if (Array.isArray(node.prefixItems)) node.prefixItems.forEach((v, i) => visit(v, `${at}/prefixItems/${i}`));
    if (Array.isArray(node.oneOf)) node.oneOf.forEach((v, i) => visit(v, `${at}/oneOf/${i}`));
    for (const k of ['items', 'propertyNames']) if (node[k] !== undefined) visit(node[k], `${at}/${k}`);
    if (isObject(node.additionalProperties)) visit(node.additionalProperties, `${at}/additionalProperties`);
    else if (node.additionalProperties !== undefined && node.additionalProperties !== false) bad(`additionalProperties must be false or a schema at ${at}`);
  };
  visit(schema, '#');
  for (const [k, v] of Object.entries(defs)) visit(v, `#/$defs/${k}`);
  return { name, root: schema, defs, patterns };
}

const typeOk = (type, v) => {
  switch (type) {
    case 'null': return v === null;
    case 'boolean': return typeof v === 'boolean';
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number';
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'array': return Array.isArray(v);
    case 'object': return isObject(v);
    default: return false;
  }
};

/** Returns at most `limit` violations `{keyword, path}` for `value` against the compiled schema. */
export function validate(compiled, value, limit = 20) {
  const out = [];
  const run = (node, v, path, sink) => {
    if (sink.length >= limit) return;
    if (node === true) return;
    if (node === false) { sink.push({ keyword: 'false', path: pathText(path) }); return; }
    const fail = (keyword, at = path) => { if (sink.length < limit) sink.push({ keyword, path: pathText(at) }); };
    if (node.$ref !== undefined) run(compiled.defs[REF.exec(node.$ref)[1]], v, path, sink);
    if (node.type !== undefined && !typeOk(node.type, v)) { fail('type'); return; }
    if (node.const !== undefined && jcs(node.const) !== jcs(v)) fail('const');
    if (node.enum !== undefined && !node.enum.some((e) => jcs(e) === jcs(v))) fail('enum');
    if (typeof v === 'number') {
      if (node.minimum !== undefined && v < node.minimum) fail('minimum');
      if (node.maximum !== undefined && v > node.maximum) fail('maximum');
      if (node.exclusiveMinimum !== undefined && v <= node.exclusiveMinimum) fail('exclusiveMinimum');
      if (node.exclusiveMaximum !== undefined && v >= node.exclusiveMaximum) fail('exclusiveMaximum');
      if (node.multipleOf !== undefined && !Number.isInteger(v / node.multipleOf)) fail('multipleOf');
    }
    if (typeof v === 'string') {
      const length = [...v].length;
      if (node.minLength !== undefined && length < node.minLength) fail('minLength');
      if (node.maxLength !== undefined && length > node.maxLength) fail('maxLength');
      if (node.pattern !== undefined && !compiled.patterns.get(node.pattern).test(v)) fail('pattern');
    }
    if (Array.isArray(v)) {
      if (node.minItems !== undefined && v.length < node.minItems) fail('minItems');
      if (node.maxItems !== undefined && v.length > node.maxItems) fail('maxItems');
      if (node.uniqueItems === true && new Set(v.map(jcs)).size !== v.length) fail('uniqueItems');
      const prefix = Array.isArray(node.prefixItems) ? node.prefixItems : [];
      v.forEach((item, i) => {
        const sub = i < prefix.length ? prefix[i] : node.items;
        if (sub !== undefined) run(sub, item, [...path, i], sink);
      });
    }
    if (isObject(v)) {
      const keys = Object.keys(v);
      const props = isObject(node.properties) ? node.properties : {};
      if (node.maxProperties !== undefined && keys.length > node.maxProperties) fail('maxProperties');
      for (const r of node.required ?? []) if (!Object.hasOwn(v, r)) fail('required', [...path, r]);
      for (const k of keys) {
        if (node.propertyNames !== undefined) { const s = []; run(node.propertyNames, k, [...path, k], s); if (s.length) fail('propertyNames', [...path, k]); }
        if (Object.hasOwn(props, k)) run(props[k], v[k], [...path, k], sink);
        else if (node.additionalProperties === false) fail('additionalProperties', [...path, k]);
        else if (isObject(node.additionalProperties)) run(node.additionalProperties, v[k], [...path, k], sink);
      }
    }
    if (Array.isArray(node.oneOf)) {
      const passing = node.oneOf.filter((sub) => { const s = []; run(sub, v, path, s); return s.length === 0; }).length;
      if (passing !== 1) fail('oneOf');
    }
  };
  run(compiled.root, value, [], out);
  return out;
}
