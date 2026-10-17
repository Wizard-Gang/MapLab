import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync } from 'node:child_process';
import { expect, test, vi } from 'vitest';
import { loadMovement, validateMovement, movementProfileDigest, movementProfileJcs, MovementValidationError,
  MOVEMENT_SCHEMA, REFERENCE_CAPABILITIES, defaultJsonLimits, evaluate, type JsonValue, type MovementDocument } from '../src/contracts';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p: string): string => readFileSync(join(root, p), 'utf8');
const r1 = 'docs/specifications/2026-10-17-maplab-r1/examples/forest/movement/';
const player = (): MovementDocument => JSON.parse(read(r1 + 'player.movement.json')) as MovementDocument;
type ExpectedDiagnostic = { code: string; jsonPath: string };
const index = JSON.parse(read('conformance/movement/cases.json')) as { license: string;
  cases: { file: string; sha256: string; profileSha256?: string; expect: { valid: true; unsupported: ExpectedDiagnostic[] } | ExpectedDiagnostic }[] };
const codes = (ds: readonly ExpectedDiagnostic[]): ExpectedDiagnostic[] => ds.map(({ code, jsonPath }) => ({ code, jsonPath }));

test('owned movement golden bytes and independently generated canonical digest vectors are complete', () => {
  expect(index.license).toBe('CC0-1.0');
  const files = index.cases.map((c) => c.file);
  expect(new Set(files).size).toBe(files.length);
  const all = ['valid', 'invalid'].flatMap((dir) => readdirSync(join(root, 'conformance/movement', dir)).map((f) => `conformance/movement/${dir}/${f}`));
  expect(files.filter((f) => f.startsWith('conformance/')).sort()).toEqual(all.sort());
  expect(files.filter((f) => f.includes('/examples/'))).toHaveLength(6);
  for (const c of index.cases) expect(createHash('sha256').update(read(c.file)).digest('hex'), c.file).toBe(c.sha256);
});

test.each(index.cases.map((c) => [c.file, c] as const))('%s', async (_file, c) => {
  const result = loadMovement(read(c.file));
  if ('valid' in c.expect) {
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(evaluate(MOVEMENT_SCHEMA, JSON.parse(read(c.file)) as JsonValue)).toEqual([]);
    expect(codes(result.compatibility.diagnostics)).toEqual(c.expect.unsupported);
    expect(result.compatibility.contractSupported).toBe(c.expect.unsupported.length === 0);
    expect(result.compatibility.runtimeImplemented).toBe(false);
    expect(result.compatibility.canCertify).toBe(false);
    expect(await movementProfileDigest(result.document)).toBe(c.profileSha256);
    expect(createHash('sha256').update(movementProfileJcs(result.document)).digest('hex')).toBe(c.profileSha256);
  } else {
    expect(result.ok).toBe(false); expect('document' in result).toBe(false);
    if (!result.ok) expect(codes(result.diagnostics)).toEqual([c.expect]);
  }
});

test('registry covers every family/mode and keeps the future solver boundary explicit', () => {
  const p = loadMovement(read('conformance/movement/valid/all-families.movement.json'));
  if (!p.ok) throw new Error(JSON.stringify(p.diagnostics));
  expect(p.document.abilities.map((a) => `${a.kind}:${a.kind === 'dash' ? a.mode : ''}`).sort()).toEqual(
    REFERENCE_CAPABILITIES.abilities.map((a) => `${a.kind}:${a.mode ?? ''}`).sort());
  expect(REFERENCE_CAPABILITIES.abilities).toHaveLength(13);
  expect(REFERENCE_CAPABILITIES.controller).toEqual({ key: 'maplab.reference-controller', version: 1 });
  expect(REFERENCE_CAPABILITIES.collision).toEqual({ key: 'maplab.collision', version: 1 });
  expect(REFERENCE_CAPABILITIES.units).toEqual({ subunitsPerWU: 256, ticksPerSecond: 60 });
  expect(REFERENCE_CAPABILITIES.maximumAdditionalAirJumps).toBe(0);
  expect(REFERENCE_CAPABILITIES.runtimeImplemented).toBe(false);
  expect(REFERENCE_CAPABILITIES.unsupportedSolvers.externalSolverLoading).toBe(false);
  expect(Object.isFrozen(REFERENCE_CAPABILITIES.abilities[0])).toBe(true);
  expect(Object.isFrozen(REFERENCE_CAPABILITIES.resourceRules)).toBe(true);
});

test('one slot per kind/mode, timer charge recovery, permission and shape invariants reject precisely', () => {
  const source = JSON.parse(read('conformance/movement/valid/air-dash.movement.json'));
  source.abilities[0].cooldownTicks = 0;
  const timer = validateMovement(source);
  expect(timer.ok ? [] : codes(timer.diagnostics)).toEqual([{ code: 'movement.dash-reset', jsonPath: '$.abilities[0].cooldownTicks' }]);
  const climb = JSON.parse(read('conformance/movement/valid/climb.movement.json'));
  climb.abilities[0].ladder = false; climb.abilities[0].rope = false;
  const disabled = validateMovement(climb);
  expect(disabled.ok ? [] : codes(disabled.diagnostics)).toEqual([{ code: 'movement.climb-permissions', jsonPath: '$.abilities[0]' }]);
  const capsule = JSON.parse(read('conformance/movement/valid/capsule.movement.json'));
  capsule.collider.height = 16;
  const body = validateMovement(capsule);
  expect(body.ok ? [] : codes(body.diagnostics)).toEqual([{ code: 'movement.capsule-height', jsonPath: '$.collider.height' }]);
  source.abilities[0].cooldownTicks = 30; source.abilities.push({ ...source.abilities[0] });
  const duplicate = validateMovement(source);
  expect(duplicate.ok ? [] : codes(duplicate.diagnostics)).toEqual([{ code: 'movement.duplicate-ability', jsonPath: '$.abilities[1]' }]);
});

test('all same-version coefficient edits and effective-profile edits invalidate the digest', async () => {
  const source = player(), before = await movementProfileDigest(source);
  const change = JSON.parse(JSON.stringify(source)); change.ground.runSpeed++;
  expect(change.id).toBe(source.id); expect(change.version).toBe(source.version);
  expect(await movementProfileDigest(change)).not.toBe(before);
  for (const section of ['ground', 'air'] as const) {
    for (const [key, value] of Object.entries(source[section])) if (typeof value === 'number') {
      const p = JSON.parse(JSON.stringify(source)); p[section][key]++;
      expect(await movementProfileDigest(p), `${section}.${key}`).not.toBe(before);
    }
  }
  const effective = JSON.parse(JSON.stringify(source)); effective.air.gravity = 48;
  expect(await movementProfileDigest(effective)).not.toBe(before);
  expect(await movementProfileDigest(source)).toBe(before);
});

test('domain normalization and JCS preserve sequences and ignore property/set ordering without mutating input', async () => {
  const source = JSON.parse(read('conformance/movement/valid/all-families.movement.json'));
  const original = JSON.stringify(source);
  const before = await movementProfileDigest(source);
  source.abilities.reverse(); source.abilityTags.reverse(); source.mask.reverse();
  source.abilities.find((a: { kind: string }) => a.kind === 'wall').permissions.reverse();
  source.abilities.find((a: { kind: string }) => a.kind === 'modifier').allowed.reverse();
  const reordered = Object.fromEntries(Object.entries(source).reverse()) as unknown as MovementDocument;
  expect(await movementProfileDigest(reordered)).toBe(before);
  const change = JSON.parse(original); change.abilities.find((a: { kind: string }) => a.kind === 'climb').jumpOff.reverse();
  expect(await movementProfileDigest(change)).not.toBe(before);
  const p = player(), untouched = JSON.stringify(p); movementProfileJcs(p);
  expect(JSON.stringify(p)).toBe(untouched);
  expect(movementProfileJcs(p)).not.toMatch(/\n$/);
  expect(JSON.parse(movementProfileJcs(p)).abilities.map((a: { kind: string }) => a.kind)).toEqual(['climb', 'jump']);
});

test('JCS uses UTF-16 key order, preserves Unicode, normalizes negative zero and refuses non-I-JSON inputs', async () => {
  const p = JSON.parse(read('conformance/movement/valid/registered.movement.json'));
  p.abilities[0].definition.params = { '\ufb33': 'Hebrew', '😀': 'Emoji', n: -0, decimal: 0.125 };
  const text = movementProfileJcs(p);
  expect(text.indexOf('"😀"')).toBeLessThan(text.indexOf('"\ufb33"'));
  expect(text).toContain('"n":0'); expect(text).toContain('"decimal":0.125');
  expect(await movementProfileDigest(p)).toBe(createHash('sha256').update(text).digest('hex'));
  p.abilities[0].definition.params.n = NaN;
  await expect(movementProfileDigest(p)).rejects.toBeInstanceOf(MovementValidationError);
  p.abilities[0].definition.params.n = 0; p.name = '\ud800';
  await expect(movementProfileDigest(p)).rejects.toBeInstanceOf(MovementValidationError);
});

test('registered calls accept only bounded scalar/typed-ref envelopes and defer catalog closure explicitly', () => {
  const p = JSON.parse(read('conformance/movement/valid/registered.movement.json'));
  const checked = validateMovement(p);
  expect(checked.ok ? checked.deferred : []).toContain('catalog definitions, parameter field closure and typed reference resolution');
  p.abilities[0].definition.params.target.ref.kind = 'code';
  const invalidRef = validateMovement(p);
  expect(invalidRef.ok ? [] : codes(invalidRef.diagnostics)).toEqual([{ code: 'param-ref.enum', jsonPath: '$.abilities[0].definition.params.target.ref.kind' }]);
  p.abilities[0].definition.params = Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`p${i}`, i]));
  const budget = validateMovement(p);
  expect(budget.ok ? [] : codes(budget.diagnostics)).toEqual([{ code: 'params.max-properties', jsonPath: '$.abilities[0].definition.params' }]);
});

test('bounded parsing, immutability, collision capabilities and no network access remain explicit', () => {
  expect(loadMovement('{"format":"maplab.movement","format":"maplab.movement"}').ok).toBe(false);
  expect(loadMovement(read(r1 + 'player.movement.json'), { ...defaultJsonLimits, maxBytes: 1 }).ok).toBe(false);
  const p = JSON.parse(read(r1 + 'player.movement.json')); const before = JSON.stringify(p);
  const checked = validateMovement(p);
  expect(JSON.stringify(p)).toBe(before);
  if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
  expect(checked.document).not.toBe(p); expect(Object.isFrozen(checked.document.abilities[0])).toBe(true);
  p.category = 'projectile';
  const unknown = validateMovement(p);
  expect(unknown.ok ? codes(unknown.compatibility.diagnostics) : []).toEqual([]);
  expect(REFERENCE_CAPABILITIES.collisionCategoryPolicy).toBe('explicitKeysWithSymmetricMasks');
  const fetch = vi.fn(() => { throw new Error('Network forbidden'); }); vi.stubGlobal('fetch', fetch);
  try { expect(loadMovement(read(r1 + 'player.movement.json')).ok).toBe(true); expect(fetch).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); }
});

test('a separate final-byte consumer validates profiles and computes the same complete digest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maplab-movement-consumer-'));
  try {
    mkdirSync(join(dir, 'src/contracts'), { recursive: true });
    for (const folder of ['schemas', 'contracts']) cpSync(join(root, folder), join(dir, folder), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    for (const file of readdirSync(join(root, 'src/contracts')).filter((f) => f.endsWith('.ts'))) {
      const js = stripTypeScriptTypes(read(`src/contracts/${file}`)).replace(/(from\s+['"])(\.\/[a-z-]+)(['"])/g, '$1$2.js$3');
      writeFileSync(join(dir, 'src/contracts', file.replace(/\.ts$/, '.js')), js);
    }
    cpSync(join(root, 'tests/consumer/movement.mjs'), join(dir, 'consumer.mjs'));
    for (const name of ['player', 'ground', 'flyer']) {
      const output = JSON.parse(execFileSync(process.execPath, [join(dir, 'consumer.mjs'), join(root, r1 + `${name}.movement.json`)], { cwd: dir, encoding: 'utf8' }));
      const golden = index.cases.find((c) => c.file === r1 + `${name}.movement.json`);
      expect(output.profileSha256).toBe(golden?.profileSha256);
      expect(output.canCertify).toBe(false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
