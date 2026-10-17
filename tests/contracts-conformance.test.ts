import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { DEFERRED_MEMBERS, loadMapHeader, parseJson, validateMapHeader, type JsonValue } from '../src/contracts';

type Expect = { valid: true } | { code: string; jsonPath: string };
type Case = { file: string; sha256: string; expect: Expect };
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file: string): Uint8Array => readFileSync(join(root, file));
const index = JSON.parse(readFileSync(join(root, 'conformance/map-header/cases.json'), 'utf8')) as { license: string; cases: Case[] };
const owned = (dir: string): string[] => readdirSync(join(root, 'conformance/map-header', dir)).map((f) => `conformance/map-header/${dir}/${f}`);

test('the CC0 index lists every owned fixture once and pins its bytes', () => {
  expect(index.license).toBe('CC0-1.0');
  const listed = index.cases.map((c) => c.file);
  expect(new Set(listed).size).toBe(listed.length);
  expect(listed.filter((f) => f.startsWith('conformance/')).sort()).toEqual([...owned('valid'), ...owned('invalid')].sort());
  for (const c of index.cases) expect(createHash('sha256').update(read(c.file)).digest('hex'), c.file).toBe(c.sha256);
});

test('R1 examples and the ML-003 acceptance cases are golden inputs', () => {
  const names = index.cases.map((c) => c.file.split('/').at(-1));
  for (const name of ['forest.map.json', 'clearing.map.json', 'base.map.json', 'extremes.map.json']) expect(names).toContain(name);
  for (const name of ['id-camelcase', 'key-uppercase', 'coordinate-off-quantum', 'adopted-quantum', 'adopted-tick-rate',
    'coordinate-above-range', 'coordinate-below-range', 'bounds-far-edge', 'json-duplicate-key', 'json-duplicate-escaped-key',
    'path-traversal', 'path-backslash', 'path-case-alias', 'version-unknown', 'feature-version-unknown', 'extra-member']) {
    expect(names).toContain(`${name}.map.json`);
  }
});

test.each(index.cases.map((c) => [c.file, c] as const))('%s', (_file, c) => {
  const result = loadMapHeader(read(c.file));
  if ('valid' in c.expect) {
    expect(result.ok ? [] : result.diagnostics).toEqual([]);
  } else {
    // One defect yields exactly one precise diagnostic and no partial document.
    expect(result.ok).toBe(false);
    expect('header' in result).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => [d.code, d.jsonPath])).toEqual([[c.expect.code, c.expect.jsonPath]]);
  }
});

test('a valid load returns only the frozen base subset and names the deferred members', () => {
  const result = loadMapHeader(read('docs/specifications/2026-10-17-maplab-r1/examples/forest/maps/forest.map.json'));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(Object.keys(result.header)).toEqual(['format', 'version', 'id', 'metadata', 'requiredFeatures', 'coordinates',
    'bounds', 'collisionContract', 'dependencies', 'assets']);
  expect(result.header.bounds).toEqual([0, 0, 1280, 800]);
  expect(Object.isFrozen(result.header) && Object.isFrozen(result.header.dependencies[0])).toBe(true);
  expect(result.deferred).toEqual(DEFERRED_MEMBERS);
  expect(result.deferred.length + Object.keys(result.header).length).toBe(29);
});

test('validation never mutates the caller value and returns a detached copy', () => {
  const parsed = parseJson(read('conformance/map-header/valid/base.map.json'));
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  const before = JSON.stringify(parsed.value);
  const freeze = (v: JsonValue): void => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } };
  freeze(parsed.value);
  const result = validateMapHeader(parsed.value);
  expect(result.ok).toBe(true);
  expect(JSON.stringify(parsed.value)).toBe(before);
  if (result.ok) expect(result.header.metadata).not.toBe((parsed.value as { metadata: JsonValue }).metadata);
});
