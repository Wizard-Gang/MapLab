import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  COORDINATE_LIMIT, COORDINATE_QUANTUM, ID_PATTERN, LENGTH_LIMIT, MAX_PATH_BYTES, SAFE_PATH_PATTERN, SUBUNITS_PER_WU,
  TICKS_PER_SECOND, checkSafePath, isCatalogKey, isCoordinate, isId, isLength, isTicks, toSubunits,
} from '../src/contracts';

const schema = JSON.parse(readFileSync(new URL('../schemas/maplab.map.v1.schema.json', import.meta.url), 'utf8'));

test('ID and catalog-key grammar matches R1 exactly', () => {
  for (const id of ['a', '0', 'map.forest', 'core.flag.set', 'a:b', 'a-b', 'a_b', 'm'.repeat(96), 'start.arrival']) expect(isId(id), id).toBe(true);
  for (const id of ['', 'A', 'mapForest', 'map.forestClearing', '.a', '-a', ':a', '_a', 'a b', 'é', 'a/b', 'm'.repeat(97), 7, null]) {
    expect(isId(id), String(id)).toBe(false);
  }
  expect(isCatalogKey('maplab.reference-controller')).toBe(true);
  expect(isCatalogKey('maplab.Collision')).toBe(false);
});

test('every authored coordinate on the 1/16 WU quantum within ±2^17 is exact in float32 (exhaustive)', () => {
  const steps = COORDINATE_LIMIT / COORDINATE_QUANTUM;
  expect(steps).toBe(2 ** 21);
  let checked = 0;
  for (let n = -steps; n <= steps; n++) {
    const v = n / 16;
    if (!isCoordinate(v) && !Object.is(v, -0)) throw new Error(`rejected ${v}`);
    if (Math.fround(v) !== v) throw new Error(`not binary32-exact: ${v}`);
    checked++;
  }
  expect(checked).toBe(2 ** 22 + 1);
});

test('off-quantum 1/256 values, out-of-range edges and non-finite values are rejected', () => {
  for (let k = -4096; k <= 4096; k++) expect(isCoordinate(k / 256)).toBe(k % 16 === 0 && k !== 0 ? true : k === 0);
  for (const v of [131072, -131072, 0.0625, -0.0625, 65535.9375]) expect(isCoordinate(v), String(v)).toBe(true);
  for (const v of [131072.0625, -131072.0625, 2 ** 20, 0.00390625, 0.1, -0, Number.NaN, Infinity, '1', null]) expect(isCoordinate(v), String(v)).toBe(false);
  expect(isLength(0.0625) && isLength(LENGTH_LIMIT)).toBe(true);
  for (const v of [0, -0.0625, LENGTH_LIMIT + 0.0625, 0.03125]) expect(isLength(v), String(v)).toBe(false);
});

test('controller sub-units stay inside the safe-integer bound at the range extremes', () => {
  expect(SUBUNITS_PER_WU).toBe(256);
  expect(TICKS_PER_SECOND).toBe(60);
  expect(toSubunits(COORDINATE_LIMIT)).toBe(2 ** 25);
  expect(toSubunits(-COORDINATE_LIMIT)).toBe(-(2 ** 25));
  expect(() => toSubunits(0.00390625)).toThrow(RangeError);
  const span = toSubunits(COORDINATE_LIMIT) - toSubunits(-COORDINATE_LIMIT);
  expect(span).toBe(2 ** 26);
  expect(span * span).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  // Orientation predicates (b−a)×(c−a) are exact Number arithmetic; compare with BigInt.
  const corners = [-COORDINATE_LIMIT, -0.0625, 0, 0.0625, COORDINATE_LIMIT - 0.0625, COORDINATE_LIMIT].map(toSubunits);
  for (const ax of corners) for (const by of corners) for (const cx of corners) for (const cy of corners) {
    const [a, b, c] = [[ax, corners[0] as number], [corners[5] as number, by], [cx, cy]] as const;
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const exact = (BigInt(b[0]) - BigInt(a[0])) * (BigInt(c[1]) - BigInt(a[1])) - (BigInt(b[1]) - BigInt(a[1])) * (BigInt(c[0]) - BigInt(a[0]));
    expect(Number.isSafeInteger(cross) || Math.abs(cross) <= 2 ** 53).toBe(true);
    expect(BigInt(cross)).toBe(exact);
  }
});

test('tick durations are non-negative safe integers at 60 Hz', () => {
  for (const v of [0, 1, 60, 3600, Number.MAX_SAFE_INTEGER]) expect(isTicks(v), String(v)).toBe(true);
  for (const v of [-1, 1.5, -0, Number.NaN, 2 ** 53, '60', null]) expect(isTicks(v), String(v)).toBe(false);
});

test('safe paths: each H4 rule has a reason, and the portable schema pattern agrees', () => {
  const cases: Array<[unknown, string | null]> = [
    ['maps/forest.map.json', null], ['assets/0123456789ab/tree.png', null], ['a', null], ['_x/y-z', null], ['a-', null],
    ['m'.repeat(MAX_PATH_BYTES), null], ['m'.repeat(MAX_PATH_BYTES + 1), 'length'], ['', 'length'], [42, 'type'],
    ['/maps/a.json', 'absolute'], ['https://example.com/a.json', 'scheme'], ['C:/a.json', 'scheme'], ['maps\\a.json', 'backslash'],
    ['maps/a b.json', 'charset'], ['maps/%2e%2e/a.json', 'charset'], ['maps/forêt.json', 'charset'], ['a\u0000b', 'charset'],
    ['maps//a.json', 'empty-component'], ['maps/', 'empty-component'], ['../a.json', 'dot-component'], ['maps/./a.json', 'dot-component'],
    ['.maplab/cache.json', 'hidden-component'], ['maps/-rf.json', 'leading-hyphen'], ['maps./a.json', 'trailing-dot'],
    ['maps/a.', 'trailing-dot'], ['CON', 'reserved-name'], ['maps/con.map.json', 'reserved-name'], ['lpt9.json', 'reserved-name'],
    ['com0.json', null], ['console.json', null],
  ];
  const pattern = new RegExp(SAFE_PATH_PATTERN);
  for (const [path, reason] of cases) {
    expect(checkSafePath(path), String(path)).toBe(reason);
    if (typeof path === 'string' && reason !== 'type' && reason !== 'length') expect(pattern.test(path), path).toBe(reason === null || reason === 'reserved-name');
  }
  const alphabet = ['a', 'Z', '0', '.', '-', '_', '/', '\\', ':', '%', ' ', 'é'];
  let seed = 7;
  for (let i = 0; i < 20000; i++) {
    let path = '';
    for (let n = 1 + (i % 12); n > 0; n--) { seed = (seed * 1103515245 + 12345) % 2147483648; path += alphabet[seed % alphabet.length]; }
    const problem = checkSafePath(path);
    expect(pattern.test(path), path).toBe(problem === null || problem === 'reserved-name');
  }
});

test('the published schema states the same grammar constants', () => {
  const defs = schema.$defs;
  expect(defs.id.pattern).toBe(ID_PATTERN);
  expect(defs.key.pattern).toBe(ID_PATTERN);
  expect(defs.path).toMatchObject({ pattern: SAFE_PATH_PATTERN, maxLength: MAX_PATH_BYTES, minLength: 1 });
  expect(defs.coordinate).toMatchObject({ multipleOf: COORDINATE_QUANTUM, minimum: -COORDINATE_LIMIT, maximum: COORDINATE_LIMIT });
  expect(defs.length).toMatchObject({ multipleOf: COORDINATE_QUANTUM, exclusiveMinimum: 0, maximum: LENGTH_LIMIT });
  expect(defs.coordinates.properties).toMatchObject({ quantum: { const: COORDINATE_QUANTUM }, ticksPerSecond: { const: TICKS_PER_SECOND } });
  expect(defs.ticks).toMatchObject({ type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
});
