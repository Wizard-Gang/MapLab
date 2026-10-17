import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test, vi } from 'vitest';
import {
  MAP_SCHEMA, SCHEMA_DIALECT, SchemaError, canonical, compileSchema, evaluate, loadMapHeader, type JsonValue,
} from '../src/contracts';

const root = fileURLToPath(new URL('../', import.meta.url));
const schemaText = readFileSync(join(root, 'schemas/maplab.map.v1.schema.json'), 'utf8');
const schema = JSON.parse(schemaText) as Record<string, JsonValue>;
const tiny = (extra: Record<string, JsonValue>, defs: Record<string, JsonValue> = {}): JsonValue =>
  ({ $schema: SCHEMA_DIALECT, $defs: defs, type: 'object', ...extra });
const refusal = (s: JsonValue): string => {
  try { compileSchema(s, 't'); return 'compiled'; } catch (e) { return e instanceof SchemaError ? e.code : 'other'; }
};
afterEach(() => { vi.unstubAllGlobals(); });

test('the published schema is closed, local-only and in library form', () => {
  expect(schemaText).toBe(`${JSON.stringify(schema, null, 2)}\n`);
  expect(schema.$schema).toBe(SCHEMA_DIALECT);
  expect(String(schema.$id)).toMatch(/^urn:maplab:/);
  const refs = [...schemaText.matchAll(/"\$ref": "([^"]+)"/g)].map((m) => m[1]);
  expect(refs.length).toBeGreaterThan(20);
  expect(refs.every((r) => /^#\/\$defs\/[a-z-]+$/.test(r ?? ''))).toBe(true);
  expect(Object.keys(schema.properties as object)).toEqual(['format', 'version', 'id', 'metadata', 'requiredFeatures',
    'coordinates', 'bounds', 'collisionContract', 'dependencies', 'assets', 'presentations', 'layers', 'terrain', 'visuals',
    'materials', 'bodies', 'footholds', 'traversals', 'regions', 'entities', 'waypoints', 'routes', 'triggers', 'encounters',
    'camera', 'environment', 'navigation', 'flags', 'prefabPlacements']);
  expect(schema.required).toEqual(Object.keys(schema.properties as object));
  const closed = (node: JsonValue): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (node.type === 'object' && node.properties) expect(node.additionalProperties).toBe(false);
    Object.values(node).forEach(closed);
  };
  closed(schema);
});

test('compilation fails closed on remote references, unknown keywords and inexact arithmetic', () => {
  expect(refusal(tiny({}))).toBe('compiled');
  for (const ref of ['https://example.com/s.json', 'other.json#/$defs/a', '#/definitions/a', '#/$defs/a/b', '//example.com/s']) {
    expect(refusal(tiny({ properties: { a: { $ref: ref } } }, { a: true })), ref).toBe('schema.remote-ref');
  }
  expect(refusal(tiny({ properties: { a: { $ref: '#/$defs/missing' } } }))).toBe('schema.unresolved-ref');
  for (const keyword of ['if', 'format', 'allOf', 'anyOf', '$dynamicRef', 'unevaluatedProperties', 'patternProperties', 'x-maplab']) {
    expect(refusal(tiny({ properties: { a: { [keyword]: {} } } })), keyword).toBe('schema.unsupported-keyword');
  }
  expect(refusal(tiny({ properties: { a: { multipleOf: 0.1 } } }))).toBe('schema.invalid');
  expect(refusal(tiny({ properties: { a: { multipleOf: 3 } } }))).toBe('schema.invalid');
  expect(refusal(tiny({ additionalProperties: true }))).toBe('schema.invalid');
  expect(refusal(tiny({ properties: { a: { $defs: {} } } }))).toBe('schema.invalid');
  expect(refusal(tiny({ properties: { a: { minItems: -1 } } }))).toBe('schema.invalid');
  expect(refusal(tiny({ properties: { a: { pattern: '(' } } }))).toBe('schema.invalid');
  expect(refusal({ ...(tiny({}) as object), $schema: 'http://json-schema.org/draft-07/schema#' })).toBe('schema.dialect');
});

test('codes name the innermost definition, stop at the cap and treat key order as irrelevant', () => {
  const compiled = compileSchema(tiny({ properties: { a: { $ref: '#/$defs/n' } }, required: ['a', 'b'], additionalProperties: false },
    { n: { type: 'number', maximum: 1 } }), 'root');
  expect(evaluate(compiled, { a: 2, c: 1 }).map((d) => `${d.code}@${d.jsonPath}`)).toEqual(
    ['root.required@$.b', 'n.maximum@$.a', 'root.additional-property@$.c']);
  expect(evaluate(compiled, { a: 2, c: 1 }, 1)).toHaveLength(1);
  expect(canonical({ b: 1, a: [1, { d: 0, c: -0 }] })).toBe(canonical({ a: [1, { c: 0, d: 0 }], b: 1 }));
  expect(evaluate(MAP_SCHEMA, [])).toEqual([expect.objectContaining({ code: 'map.type', jsonPath: '$' })]);
  const tuple = compileSchema(tiny({ properties: { t: { type: 'array', prefixItems: [true], items: false }, f: false } }), 'root');
  expect(evaluate(tuple, { t: [1, 2], f: 1 }).map((d) => `${d.code}@${d.jsonPath}`)).toEqual(['root.items@$.t[1]', 'root.forbidden@$.f']);
  const extra = loadMapHeader(readFileSync(join(root, 'conformance/map-header/invalid/extra-member.map.json')));
  expect(extra.ok ? null : extra.diagnostics[0]?.documentId).toBe('map.conformance.header');
});

test('loading never touches the network', () => {
  const fetch = vi.fn(() => { throw new Error('network'); });
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('XMLHttpRequest', vi.fn());
  const maps = 'docs/specifications/2026-10-17-maplab-r1/examples/forest/maps';
  for (const file of readdirSync(join(root, maps))) expect(loadMapHeader(readFileSync(join(root, maps, file))).ok).toBe(true);
  expect(loadMapHeader('{"format":"maplab.map","version":1,"$ref":"https://example.com/x"}').ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

test('src/contracts stays pure: relative imports and the local schema only, no I/O APIs', () => {
  const dir = join(root, 'src/contracts');
  let specifiers = 0;
  for (const file of readdirSync(dir)) {
    const source = readFileSync(join(dir, file), 'utf8');
    for (const [, specifier] of source.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/gm)) {
      specifiers++;
      expect(specifier === '../../schemas/maplab.map.v1.schema.json' || /^\.\/[a-z-]+$/.test(specifier ?? ''), `${file}: ${specifier}`).toBe(true);
    }
    expect(source, file).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|\bimport\(|\brequire\(|process\.|document\.|window\.|localStorage|indexedDB/);
    expect(source.replaceAll(SCHEMA_DIALECT, ''), file).not.toMatch(/https?:\/\//);
  }
  expect(specifiers).toBeGreaterThanOrEqual(12);
});
