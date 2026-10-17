// ML-007: the independent final-byte reader runs as its own Node process from a scratch copy that
// holds only consumer/ and the published schemas, so it cannot reach src/, the editor or the repo.
import { expect, test } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { materialize } from './consumer/mutate.mjs';
import { parseStrict, jcs } from '../consumer/json.mjs';
import { compile, validate } from '../consumer/schema.mjs';
import { checkReferences } from '../consumer/references.mjs';

const root = resolve(import.meta.dirname, '..');
const index = JSON.parse(readFileSync(join(root, 'conformance/bundle/cases.json'), 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const scratch = mkdtempSync(join(tmpdir(), 'maplab-reader-'));
cpSync(join(root, 'consumer'), join(scratch, 'reader/consumer'), { recursive: true });
cpSync(join(root, 'schemas'), join(scratch, 'reader/schemas'), { recursive: true });
const golden = join(root, index.golden.export.path);

const run = (bundle, extra = []) => {
  const out = spawnSync(process.execPath, [join(scratch, 'reader/consumer/read-bundle.mjs'), '--schemas', join(scratch, 'reader/schemas'), ...extra, bundle],
    { cwd: join(scratch, 'reader'), encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
  return { status: out.status, stderr: out.stderr, report: out.stdout ? JSON.parse(out.stdout) : null };
};

test('the reader source imports only Node built-ins and its own folder: no src/, editor, React or network', () => {
  const files = readdirSync(join(root, 'consumer')).sort();
  expect(files).toEqual(['bundle.mjs', 'json.mjs', 'read-bundle.mjs', 'references.mjs', 'schema.mjs']);
  for (const file of files) {
    const source = readFileSync(join(root, 'consumer', file), 'utf8');
    const specifiers = [...source.matchAll(/^import\b[^;]*?\bfrom\s+'([^']+)'/gm)].map((m) => m[1]);
    for (const s of specifiers) expect(/^node:(?:fs|crypto|path|url)$/.test(s) || /^\.\/[a-z-]+\.mjs$/.test(s), `${file}: ${s}`).toBe(true);
    expect(source, file).not.toMatch(/\bimport\(|\brequire\(|\bfetch\(|node:(?:http|https|net|child_process|vm|worker_threads)|\beval\(|new Function/);
  }
});

test('golden source bytes are pinned with declared schemas and validate under the independent evaluator', () => {
  const project = readFileSync(join(root, index.golden.projectIndex.path));
  expect(sha(project)).toBe(index.golden.projectIndex.sha256);
  const declared = new Map(parseStrict(project).documents.map((d) => [d.path, d.sha256]));
  expect(index.golden.source.map((s) => s.path.split('/forest/')[1]).sort()).toEqual([...declared.keys()].sort());
  for (const s of index.golden.source) {
    const bytes = readFileSync(join(root, s.path));
    expect(sha(bytes), s.path).toBe(s.sha256);
    expect(declared.get(s.path.split('/forest/')[1]), s.path).toBe(s.sha256);
    const doc = parseStrict(bytes);
    const schema = parseStrict(readFileSync(join(root, s.schema)));
    expect(schema.$id).toBe(`urn:maplab:schema:${doc.format}:${doc.version}`);
    expect(validate(compile(schema, s.schema), doc), s.path).toEqual([]);
  }
});

test('a separate process reads both maps of the golden export bundle and resolves the portal cycle', () => {
  const { status, report } = run(golden, ['--expect-digest', index.golden.export.bundleSha256]);
  expect(status).toBe(0);
  expect(report.ok).toBe(true);
  expect(report.stage).toBe('complete');
  expect(report.bundleSha256).toBe(index.golden.export.bundleSha256);
  expect(report.maps.map((m) => m.id)).toEqual(index.golden.export.maps);
  expect(report.portals.map(({ from, to }) => ({ from, to }))).toEqual(index.golden.export.portals);
  const manifest = parseStrict(readFileSync(join(golden, 'manifest.json')));
  expect(report.documents.map(({ sha256, ...d }) => d)).toEqual(manifest.documents);
  for (const d of report.documents) expect(d.sha256).toBe(manifest.files.find((f) => f.path === d.path).sha256);
  expect(report.claims).toEqual({ bytesVerified: true, schemasValidated: true, referencesResolved: true, worldConstructed: false, engineExecuted: false, navigationExecuted: false });
  expect(report.diagnostics).toEqual([]);
});

test('the conformance index is closed: unique case IDs, every group covered, golden export bytes pinned', () => {
  const ids = index.cases.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(index.cases.map((c) => c.group))).toEqual(new Set(['inventory', 'manifest', 'document', 'closure', 'reference', 'positive']));
  expect(sha(readFileSync(join(golden, 'manifest.json')))).toBe(index.golden.export.bundleSha256);
  for (const code of ['document.version', 'json.duplicate-key', 'object.duplicate', 'reference.dangling', 'portal.map', 'asset.path', 'asset.extension', 'asset.missing']) {
    expect(index.cases.some((c) => c.expect.code === code), code).toBe(true);
  }
});

test.each(index.cases.map((c) => [c.id, c]))('conformance case %s', (id, record) => {
  const dir = join(scratch, 'cases', id);
  materialize(golden, dir, record, join(root, 'schemas'));
  const { status, report, stderr } = run(dir, record.trustedDigest ? ['--expect-digest', index.golden.export.bundleSha256] : []);
  expect(stderr).toBe('');
  if (record.expect.ok) {
    expect(report.diagnostics).toEqual([]);
    expect(status).toBe(0);
    return;
  }
  expect(status).toBe(1);
  expect(report.ok).toBe(false);
  expect(report.claims.referencesResolved).toBe(false);
  expect(report.diagnostics.map(({ code, file, path }) => ({ code, file, path }))).toEqual([{ code: record.expect.code, file: record.expect.file, path: record.expect.path }]);
  rmSync(dir, { recursive: true, force: true });
});

test('usage errors and a non-directory bundle never produce an accepting report', () => {
  const missing = spawnSync(process.execPath, [join(scratch, 'reader/consumer/read-bundle.mjs'), golden], { encoding: 'utf8' });
  expect(missing.status).toBe(2);
  expect(missing.stdout).toBe('');
  writeFileSync(join(scratch, 'not-a-bundle'), '{}');
  const file = run(join(scratch, 'not-a-bundle'));
  expect(file.status).toBe(1);
  expect(file.report.diagnostics[0].code).toBe('bundle.root');
});

test('reference members the published schemas do not define fail closed instead of passing silently', () => {
  const manifest = parseStrict(readFileSync(join(golden, 'manifest.json')));
  const docs = new Map(manifest.documents.map((d) => [d.id, { entry: d, value: parseStrict(readFileSync(join(golden, d.path))) }]));
  const forest = docs.get('map.forest').value;
  forest.entities[0].lootId = 'loot.gold';
  const diagnostics = [];
  checkReferences(manifest, docs, diagnostics);
  expect(diagnostics).toEqual([{ code: 'reference.unclassified', file: 'maps/forest.map.json', path: '$.entities[0].lootId', message: 'Unclassified reference member lootId' }]);
  expect(jcs(forest)).toContain('lootId');
});

test('the strict parser enforces exact byte boundaries independently of the bundle cases', () => {
  const code = (text) => { try { parseStrict(Buffer.from(text, 'utf8')); return 'ok'; } catch (e) { return e.code; } };
  expect(code('['.repeat(64) + ']'.repeat(64))).toBe('ok');
  expect(code('['.repeat(65) + ']'.repeat(65))).toBe('json.limit');
  expect(code('{"a":1,"a":1}')).toBe('json.duplicate-key');
  expect(code('"\\ud83d\\ude00"')).toBe('ok');
  expect(code('"\\ude00"')).toBe('json.surrogate');
  expect(code('1e400')).toBe('json.number');
  expect(code('01')).toBe('json.syntax');
  expect(code('{"a":1,}')).toBe('json.syntax');
  expect(code('"\t"')).toBe('json.syntax');
  const proto = parseStrict(Buffer.from('{"__proto__":{"polluted":true}}'));
  expect(Object.hasOwn(proto, '__proto__')).toBe(true);
  expect({}.polluted).toBeUndefined();
  expect(jcs(parseStrict(Buffer.from('{"b":[1,0.5,-0],"a":"é"}')))).toBe('{"a":"é","b":[1,0.5,0]}');
});
