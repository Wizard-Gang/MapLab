import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { defaultJsonLimits, parseJson, type JsonLimits, type JsonValue } from '../src/contracts';

const root = fileURLToPath(new URL('../', import.meta.url));
const limits = (overrides: Partial<JsonLimits>): JsonLimits => ({ ...defaultJsonLimits, ...overrides });
const codeOf = (input: Uint8Array | string, l?: JsonLimits): string => {
  const r = parseJson(input, l);
  return r.ok ? 'ok' : r.diagnostic.code;
};
// Deterministic PRNG so every run explores the same inputs.
function prng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ALPHABET = ['a', 'Z', '0', ' ', '"', '\\', '/', 'é', '😀', ' ', '\t', '\u0001'];
function randomValue(next: () => number, depth: number): JsonValue {
  const pick = Math.floor(next() * (depth > 4 ? 4 : 7));
  const text = (): string => Array.from({ length: Math.floor(next() * 6) }, () => ALPHABET[Math.floor(next() * ALPHABET.length)]).join('');
  switch (pick) {
    case 0: return null;
    case 1: return next() < 0.5;
    case 2: return [0, -0, 1, -1.5, 1e21, 5e-324, 0.0625, 131072, Number.MAX_SAFE_INTEGER, (next() - 0.5) * 1e6][Math.floor(next() * 10)] as number;
    case 3: return text();
    case 4: case 5: return Array.from({ length: Math.floor(next() * 4) }, () => randomValue(next, depth + 1));
    default: return Object.fromEntries(Array.from({ length: Math.floor(next() * 4) }, (_, i) => [text() + i, randomValue(next, depth + 1)]));
  }
}

test('agrees with JSON.parse on every accepted golden file and on generated documents', () => {
  const files = ['valid', 'invalid'].flatMap((d) => readdirSync(join(root, 'conformance/map-header', d)).map((f) => join(root, 'conformance/map-header', d, f)));
  let accepted = 0;
  for (const file of files) {
    const bytes = readFileSync(file);
    const result = parseJson(bytes);
    if (result.ok) { accepted++; expect(result.value).toEqual(JSON.parse(bytes.toString('utf8'))); }
  }
  expect(accepted).toBeGreaterThan(40);
  const next = prng(3);
  for (let i = 0; i < 2000; i++) {
    const value = randomValue(next, 0);
    const text = JSON.stringify(value, null, [0, 2, '\t'][i % 3]);
    const result = parseJson(i % 2 ? text : new TextEncoder().encode(text));
    expect(result.ok && result.value).toEqual(JSON.parse(text));
  }
});

test('rejects every malformed text JSON.parse rejects, with json.syntax', () => {
  const corpus = ['', ' ', '{', '}', '[1,]', '{"a":1,}', "{'a':1}", '01', '-01', '1.', '.5', '+1', '-', '1e', '1e+', 'NaN', 'Infinity',
    '-Infinity', 'undefined', '"\\x41"', '"a\nb"', ' 1', '\f1', 'tru', 'nul', 'True', '[1 2]', '{"a" 1}', '{1:2}', '"\\u12"',
    '/*c*/1', '1 // c', '[1]]', '{"a":1}}', '"unterminated', '"\\', '[', '[,1]', '{,}', '0x10', '1_000'];
  for (const text of corpus) {
    expect(() => JSON.parse(text), text).toThrow();
    expect(codeOf(text), JSON.stringify(text)).toBe('json.syntax');
  }
});

test('rejects what JSON.parse silently accepts: duplicate keys, lone surrogates, huge literals', () => {
  expect(JSON.parse('{"a":1,"a":2}')).toEqual({ a: 2 });
  expect(codeOf('{"a":1,"a":2}')).toBe('json.duplicate-key');
  expect(codeOf('{"a":1,"\\u0061":2}')).toBe('json.duplicate-key');
  expect(codeOf('{"x":{"a":1},"y":{"a":1}}')).toBe('ok');
  for (const text of ['"\\ud800"', '"\\udc00"', '"\\ud800\\u0041"', '"\\ud800x"']) expect(codeOf(text), text).toBe('json.lone-surrogate');
  expect(codeOf('"\ud800"')).toBe('json.lone-surrogate');
  expect(codeOf('"\\ud83d\\ude00"')).toBe('ok');
  expect(codeOf('1e400')).toBe('json.number-range');
  expect(codeOf(`0.${'1'.repeat(200)}`)).toBe('json.number-range');
  const dup = parseJson('{"a":{"b":1,"b":2}}');
  expect(dup.ok ? '' : dup.diagnostic.jsonPath).toBe('$.a.b');
});

test('decodes only strict UTF-8 without a byte order mark', () => {
  expect(codeOf(new Uint8Array([0xef, 0xbb, 0xbf, 0x31]))).toBe('json.bom');
  expect(codeOf('﻿1')).toBe('json.bom');
  for (const bytes of [[0x22, 0xc3, 0x28, 0x22], [0x22, 0xc0, 0xaf, 0x22], [0x22, 0xed, 0xa0, 0x80, 0x22], [0x22, 0xe2, 0x82, 0x22], [0x22, 0xff, 0x22]]) {
    expect(codeOf(new Uint8Array(bytes))).toBe('json.invalid-utf8');
  }
  expect(parseJson(new Uint8Array([0x22, 0xc3, 0xa9, 0x22]))).toEqual({ ok: true, value: 'é' });
});

test('budgets stop input at the boundary, for strings and bytes alike', () => {
  expect(codeOf('[1,2]', limits({ maxBytes: 5 }))).toBe('ok');
  expect(codeOf('[1,2] ', limits({ maxBytes: 5 }))).toBe('json.too-large');
  expect(codeOf(new Uint8Array(6).fill(0x20), limits({ maxBytes: 5 }))).toBe('json.too-large');
  expect(codeOf('"éé"', limits({ maxBytes: 5 }))).toBe('json.too-large');
  expect(codeOf('[[[]]]', limits({ maxDepth: 3 }))).toBe('ok');
  expect(codeOf('[[[[]]]]', limits({ maxDepth: 3 }))).toBe('json.depth');
  expect(codeOf('{"a":{"b":{}}}', limits({ maxDepth: 2 }))).toBe('json.depth');
  expect(codeOf('"abcd"', limits({ maxStringLength: 4 }))).toBe('ok');
  expect(codeOf('"abcde"', limits({ maxStringLength: 4 }))).toBe('json.string-too-long');
  expect(codeOf('"ab\\ncde"', limits({ maxStringLength: 4 }))).toBe('json.string-too-long');
  expect(codeOf('{"abcde":1}', limits({ maxStringLength: 4 }))).toBe('json.string-too-long');
  expect(codeOf('{"a":1,"b":2}', limits({ maxObjectKeys: 2 }))).toBe('ok');
  expect(codeOf('{"a":1,"b":2,"c":3}', limits({ maxObjectKeys: 2 }))).toBe('json.too-many-keys');
  expect(codeOf('[1,2,3]', limits({ maxArrayItems: 3 }))).toBe('ok');
  expect(codeOf('[1,2,3,4]', limits({ maxArrayItems: 3 }))).toBe('json.array-too-long');
  expect(codeOf('[1,2]', limits({ maxValues: 3 }))).toBe('ok');
  expect(codeOf('[1,2,3]', limits({ maxValues: 3 }))).toBe('json.too-many-values');
});

test('wider budgets are clamped to the defaults, so deep input still fails cleanly', () => {
  const deep = '['.repeat(100_000) + ']'.repeat(100_000);
  expect(codeOf(deep, limits({ maxDepth: 1e9, maxBytes: Infinity }))).toBe('json.depth');
  const r = parseJson('[[1]]', limits({ maxDepth: -5 }));
  expect(r.ok ? 'ok' : r.diagnostic.code).toBe('json.depth');
});

test('a surrogate pair split across an escape and a raw code unit is accepted like JSON.parse', () => {
  for (const text of ['"\\ud83d\ude00"', '"\ud83d\\ude00"']) {
    expect(parseJson(text)).toEqual({ ok: true, value: JSON.parse(text) });
  }
  expect(codeOf('"\\ud83d\\ud83d"')).toBe('json.lone-surrogate');
});

test('"__proto__" stays an own data property and nothing global is touched', () => {
  const result = parseJson('{"__proto__":{"polluted":true},"constructor":{"prototype":1}}');
  if (!result.ok) throw new Error(result.diagnostic.message);
  const value = result.value as Record<string, unknown>;
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(Object.keys(value)).toEqual(['__proto__', 'constructor']);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(value).toEqual(JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":1}}'));
});

test('never throws on arbitrary bytes, and anything it accepts JSON.parse accepts identically', () => {
  const next = prng(11);
  const seeds = [...'{}[]",:\\0123456789-+.eEtrufalsn \n'].map((c) => c.charCodeAt(0));
  for (let i = 0; i < 5000; i++) {
    const bytes = new Uint8Array(Array.from({ length: 1 + Math.floor(next() * 24) },
      () => (next() < 0.85 ? seeds[Math.floor(next() * seeds.length)] as number : Math.floor(next() * 256))));
    const result = parseJson(bytes);
    if (result.ok) expect(result.value).toEqual(JSON.parse(new TextDecoder().decode(bytes)));
    else expect(result.diagnostic.code).toMatch(/^json\./);
  }
});

test('syntax diagnostics name the JSON path and the line and column', () => {
  const result = parseJson('{\n  "a": [1,\n  2,,\n]}');
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostic).toMatchObject({ code: 'json.syntax', jsonPath: '$.a[2]', severity: 'error', worldBounds: null });
    expect(result.diagnostic.message).toContain('line 3, column 5');
  }
});
