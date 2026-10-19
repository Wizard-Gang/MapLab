import { exportLibrary, pinnedSchemas } from '../src/library/export';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { exportValue, sha256, verifyFiles, type ExportBundle } from '../src/export/bundle';
import { importAsset } from '../src/library/assets';
import { BundleError, readStoreZip, storeZip } from '../src/export/zip';
import { canonical, type JsonValue } from '../src/contracts';

// Complete bundle validation competes with the full parallel contract suite on CI.
vi.setConfig({ testTimeout: 15_000, hookTimeout: 20_000 });

const root = join(import.meta.dirname, '..'), scratch = mkdtempSync(join(realpathSync(tmpdir()), 'maplab-export-'));
const folder = { dir: join(scratch, 'library'), label: 'export scratch', placeholder: false };
let bundle: ExportBundle;
const cases = JSON.parse(readFileSync(join(root, 'conformance/export/cases.json'), 'utf8')) as { inventory: string[]; archive: string[]; forged: string[] };

const base = (): string => sha256(readFileSync(join(folder.dir, 'maps/forest.map.json')));
function save(path: string, v: unknown): void {
  writeFileSync(join(folder.dir, path), JSON.stringify(v));
  const indexPath = join(folder.dir, 'maplab.project.json'), index = JSON.parse(readFileSync(indexPath, 'utf8'));
  index.documents.find((d: { path: string }) => d.path === path).sha256 = sha256(readFileSync(join(folder.dir, path)));
  writeFileSync(indexPath, JSON.stringify(index));
}
function reset(): void { rmSync(folder.dir, { recursive: true, force: true }); cpSync(join(root, 'placeholder-library'), folder.dir, { recursive: true }); }
beforeAll(async () => {
  reset(); bundle = await exportLibrary(folder, 'map.forest', base());
  cpSync(join(root, 'tests/consumer/reader'), join(scratch, 'reader'), { recursive: true });
  cpSync(join(root, 'schemas'), join(scratch, 'schemas'), { recursive: true });
  cpSync(join(root, 'tests/consumer/verify-export.py'), join(scratch, 'verify-export.py'));
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test('forest/clearing closed bundle has all schemas, no project/prefab/cache and repeat bytes are identical', async () => {
  expect(bundle.manifest.documents.map((d) => d.id)).toEqual(['catalog.core', 'map.clearing', 'map.forest', 'movement.flyer', 'movement.ground', 'movement.player', 'tileset.forest']);
  expect(bundle.manifest.files.filter((f) => f.role === 'schema')).toHaveLength(5);
  expect([...bundle.files.keys()].some((p) => /prefab|project|cache/.test(p))).toBe(false);
  expect((await exportLibrary(folder, 'map.forest', base())).zip).toEqual(bundle.zip);
  expect(verifyFiles(readStoreZip(bundle.zip), pinnedSchemas, bundle.digest)).toEqual(bundle.manifest);
});
test('property/domain-set reorder keeps exact bytes; sequence edits change them', async () => {
  const map = JSON.parse(readFileSync(join(folder.dir, 'maps/forest.map.json'), 'utf8'));
  for (const k of ['dependencies', 'visuals', 'layers', 'entities', 'bodies', 'footholds', 'requiredFeatures']) map[k].reverse();
  save('maps/forest.map.json', Object.fromEntries(Object.entries(map).reverse()));
  expect((await exportLibrary(folder, 'map.forest', base())).zip).toEqual(bundle.zip);
  map.triggers.find((t: { actions: unknown[] }) => t.actions.length > 1).actions.reverse();
  save('maps/forest.map.json', map);
  expect((await exportLibrary(folder, 'map.forest', base())).zip).not.toEqual(bundle.zip);
  reset();
});
test('domain sets reject duplicate tags and canonical numbers/Unicode remain unchanged', () => {
  const value = JSON.parse(readFileSync(join(folder.dir, 'maps/forest.map.json'), 'utf8'));
  value.metadata.name = 'Forêt 🌲';
  expect(canonical(exportValue(value))).toContain('Forêt 🌲');
  value.metadata.tags.push(value.metadata.tags[0]);
  expect(() => exportValue(value)).toThrow(/Duplicate set/);
  const n = JSON.parse(readFileSync(join(folder.dir, 'movement/player.movement.json'), 'utf8'));
  expect(canonical(exportValue(n))).not.toContain('\n');
});
test('stale, torn, missing transitive dependency, mismatched ID/path and dangling portal refuse', async () => {
  await expect(exportLibrary(folder, 'map.forest', '0'.repeat(64))).rejects.toMatchObject({ code: 'export.stale' });
  for (const corruption of ['torn', 'missing', 'identity', 'path', 'portal']) {
    reset(); const p = 'maps/clearing.map.json', v = JSON.parse(readFileSync(join(folder.dir, p), 'utf8'));
    if (corruption === 'torn') writeFileSync(join(folder.dir, p), JSON.stringify(v));
    if (corruption === 'missing') rmSync(join(folder.dir, p));
    if (corruption === 'identity') { v.id = 'map.other'; save(p, v); }
    if (corruption === 'path') { const m = JSON.parse(readFileSync(join(folder.dir, 'maps/forest.map.json'), 'utf8')); m.dependencies[0].path = 'maps/wrong.map.json'; save('maps/forest.map.json', m); }
    if (corruption === 'portal') { v.entities.find((e: { kind: string }) => e.kind === 'portal').destination.entityId = 'missing'; save(p, v); }
    await expect(exportLibrary(folder, 'map.forest', base()), corruption).rejects.toBeInstanceOf(Error);
  }
  reset();
});
function mutateManifest(files: Map<string, Uint8Array>, change: (m: ExportBundle['manifest']) => void): void {
  const m = JSON.parse(Buffer.from(files.get('manifest.json')!).toString()); change(m); files.set('manifest.json', Buffer.from(canonical(m as unknown as JsonValue)));
}
test.each(cases.inventory)('final inventory rejects %s', (kind) => {
  const f = new Map(bundle.files);
  if (kind === 'path') mutateManifest(f, (m) => { (m.files[0] as { path: string }).path = '../escape'; });
  if (kind === 'size') mutateManifest(f, (m) => { (m.files[0] as { bytes: number }).bytes++; });
  if (kind === 'digest') mutateManifest(f, (m) => { (m.files[0] as { sha256: string }).sha256 = '0'.repeat(64); });
  if (kind === 'unlisted') f.set('extra.txt', Buffer.from('unlisted'));
  if (kind === 'missing') f.delete(bundle.manifest.files[0]!.path);
  if (kind === 'duplicate') mutateManifest(f, (m) => { (m.files as unknown[]).push(m.files[0]); });
  if (kind === 'self') mutateManifest(f, (m) => { (m.files[0] as { path: string }).path = 'manifest.json'; });
  if (kind === 'missing-dependency') {
    f.delete('maps/clearing.map.json'); mutateManifest(f, (m) => {
      (m as unknown as { files: unknown[] }).files = m.files.filter((x) => x.path !== 'maps/clearing.map.json');
      (m as unknown as { documents: unknown[] }).documents = m.documents.filter((x) => x.id !== 'map.clearing');
    });
  }
  expect(() => verifyFiles(f, pinnedSchemas), kind).toThrow(BundleError);
});
test.each(cases.archive)('STORE reader rejects %s', (kind) => {
  let b = Buffer.from(bundle.zip); const end = b.length - 22, c = b.readUInt32LE(end + 16);
  if (kind === 'compression') b.writeUInt16LE(8, c + 10);
  if (kind === 'bomb') b.writeUInt32LE(0xffffffff, c + 24);
  if (kind === 'crc') b[100] = b[100]! ^ 1;
  if (kind === 'offset') b.writeUInt32LE(3, c + 42);
  if (kind === 'symlink') b.writeUInt32LE(0xa1ff0000, c + 38);
  if (kind === 'trailing') b = Buffer.concat([b, Buffer.from('x')]);
  if (kind === 'truncated') b = b.subarray(0, b.length - 1);
  if (kind === 'extra') b.writeUInt16LE(1, c + 30);
  if (kind === 'name') b[30] = 0x2f;
  expect(() => readStoreZip(b)).toThrow(BundleError);
});
test.each(['../escape', '/absolute', 'maps/CON.json', 'a.zip', 'a//b', 'a/./b', 'a\\b', 'a/../b'])('writer refuses %s', (p) => expect(() => storeZip(new Map([[p, new Uint8Array()]]))).toThrow());
test('writer refuses duplicate aliases and file/directory aliases', () => {
  for (const names of [['a', 'A'], ['a', 'a/b']]) expect(() => storeZip(new Map(names.map((p) => [p, new Uint8Array()])))).toThrow();
});
test('separate isolated consumer verifies actual ZIP final bytes and corruption matrix', () => {
  const path = join(scratch, 'bundle.zip'); writeFileSync(path, bundle.zip);
  const run = spawnSync('python3', [join(scratch, 'verify-export.py'), '--node', process.execPath, '--reader', join(scratch, 'reader/read-bundle.mjs'), '--schemas', join(scratch, 'schemas'), '--expect-digest', bundle.digest, '--self-test', path], { cwd: scratch, encoding: 'utf8' });
  expect(run.stderr).toBe(''); expect(run.status, run.stdout).toBe(0);
  const report = JSON.parse(run.stdout); expect(report.ok).toBe(true); expect(report.negativeCases).toBeGreaterThanOrEqual(8);
  const evidence = process.env.MAPLAB_EXPORT_EVIDENCE;
  if (evidence) { mkdirSync(evidence, { recursive: true }); writeFileSync(join(evidence, 'bundle.zip'), bundle.zip); writeFileSync(join(evidence, 'consumer-result.json'), run.stdout); for (const [p, b] of bundle.files) { mkdirSync(dirname(join(evidence, 'bundle', p)), { recursive: true }); writeFileSync(join(evidence, 'bundle', p), b); } }
});

test('approved map and tileset art travels verbatim; missing/corrupt assets reject', async () => {
  reset();
  const approved = importAsset(folder, { mediaType: 'image/png', base64: readFileSync(join(root, 'conformance/visuals/owned.png')).toString('base64') });
  const map = JSON.parse(readFileSync(join(folder.dir, 'maps/forest.map.json'), 'utf8'));
  map.assets.push(approved.asset); map.visuals[0].source = { kind: 'asset', assetId: approved.asset.id, pivot: [0, 0] };
  save('maps/forest.map.json', map);
  const art = await exportLibrary(folder, 'map.forest', base());
  expect(Buffer.from(art.files.get(approved.asset.path)!)).toEqual(Buffer.from(approved.base64, 'base64'));
  const missing = new Map(art.files); missing.delete(approved.asset.path);
  mutateManifest(missing, (m) => { (m as unknown as { files: unknown[] }).files = m.files.filter((f) => f.path !== approved.asset.path); });
  expect(() => verifyFiles(missing, pinnedSchemas)).toThrow(/Missing asset/);
  writeFileSync(join(folder.dir, approved.asset.path), 'corrupt');
  await expect(exportLibrary(folder, 'map.forest', base())).rejects.toThrow(/digest/);
  reset();
});
test('used optional catalog and movement are included, unused prefab stays excluded', async () => {
  reset(); const map = JSON.parse(readFileSync(join(folder.dir, 'maps/forest.map.json'), 'utf8'));
  for (const d of map.dependencies) if (['catalog', 'movement', 'tileset'].includes(d.kind)) d.required = false;
  save('maps/forest.map.json', map);
  const optional = await exportLibrary(folder, 'map.forest', base());
  expect(optional.manifest.documents).toHaveLength(7);
  expect(optional.manifest.requiredContracts).toContainEqual({ key: 'core.body.set-enabled', version: 1 });
  reset();
});
test.each(cases.forged)('rehashing does not legitimize forged %s', (kind) => {
  const f = new Map(bundle.files);
  if (kind === 'contracts') mutateManifest(f, (m) => { (m as unknown as { requiredContracts: unknown[] }).requiredContracts = []; });
  if (kind === 'schema') {
    const path = 'schemas/maplab.map.v1.schema.json'; f.set(path, Buffer.from('{}'));
    mutateManifest(f, (m) => { const e = m.files.find((e) => e.path === path)! as { bytes: number; sha256: string }; e.bytes = 2; e.sha256 = sha256(f.get(path)!); });
  }
  if (kind === 'dependency-path') {
    const path = 'maps/forest.map.json', doc = JSON.parse(Buffer.from(f.get(path)!).toString()); doc.dependencies.find((d: { id: string }) => d.id === 'map.clearing').path = 'maps/other.map.json'; f.set(path, Buffer.from(canonical(doc)));
    mutateManifest(f, (m) => { const e = m.files.find((e) => e.path === path)! as { bytes: number; sha256: string }; e.bytes = f.get(path)!.length; e.sha256 = sha256(f.get(path)!); });
  }
  if (kind === 'document-order') mutateManifest(f, (m) => { (m.documents as unknown[]).reverse(); });
  expect(() => verifyFiles(f, pinnedSchemas)).toThrow();
});

test('owned export cases are pinned', () => { const index = JSON.parse(readFileSync(join(root, 'conformance/export/index.json'), 'utf8')); expect(sha256(readFileSync(join(root, 'conformance/export/cases.json')))).toBe(index.files[0].sha256); });

test('export endpoint enforces origin/host/JSON/method and leaves the library unchanged', async () => {
  const { startServer, call, tree } = await import('./library-support');
  reset(); const before = tree(folder.dir), server = await startServer(folder.dir);
  try {
    const body = { entryMapId: 'map.forest', baseDigest: base() };
    for (const options of [{ headers: { origin: 'https://example.invalid' } }, { headers: { host: 'evil.invalid' } }, { method: 'GET' }, { headers: { 'content-type': 'text/plain' } }]) {
      expect((await call(server.port, '/__maplab/export', { ...options, body })).status).toBeGreaterThanOrEqual(400);
    }
    for (const body of [{}, { entryMapId: '../escape', baseDigest: 'bad' }]) expect((await call(server.port, '/__maplab/export', { body })).status).toBe(400);
    const refused = await call(server.port, '/__maplab/export', { body: { ...body, baseDigest: '0'.repeat(64) } }); expect(refused.body.code).toBe('export.stale');
    expect(tree(folder.dir)).toEqual(before);
  } finally { await server.close(); }
});

test('declaring and rehashing arbitrary schema files still refuses', () => {
  const f = new Map(bundle.files), path = 'unexpected.json', data = Buffer.from('{}'); f.set(path, data);
  mutateManifest(f, (m) => { (m.files as unknown[]).push({ path, bytes: data.length, sha256: sha256(data), role: 'schema' }); });
  expect(() => verifyFiles(f, pinnedSchemas)).toThrow(/Unexpected schema/);
});

test('movement same-kind modes, wall permissions and modifier refs use authoritative canonical order', async () => {
  reset(); const path = 'movement/player.movement.json', profile = JSON.parse(readFileSync(join(folder.dir, path), 'utf8'));
  const all = JSON.parse(readFileSync(join(root, 'conformance/movement/valid/all-families.movement.json'), 'utf8'));
  profile.abilities.push(...all.abilities.filter((a: { kind: string }) => ['dash', 'wall', 'modifier'].includes(a.kind)));
  const catalogPath = 'catalogs/core.catalog.json', catalog = JSON.parse(readFileSync(join(folder.dir, catalogPath), 'utf8'));
  for (const key of ['core.slow', 'core.fast']) catalog.entries.push({ key, version: 1, kind: 'modifier', stage: 'planned', fields: [], stateNames: [] });
  save(catalogPath, catalog);
  save(path, profile); const first = await exportLibrary(folder, 'map.forest', base());
  profile.abilities.reverse(); profile.abilities.find((a: { kind: string }) => a.kind === 'wall').permissions.reverse();
  profile.abilities.find((a: { kind: string }) => a.kind === 'modifier').allowed.reverse();
  save(path, profile); const second = await exportLibrary(folder, 'map.forest', base()); expect(second.zip).toEqual(first.zip);
  reset();
});
test('tileset local shape IDs and quarter-turn permissions normalize without disturbing weighted choices', async () => {
  reset(); const path = 'tilesets/forest.tileset.json', tileset = JSON.parse(readFileSync(join(folder.dir, path), 'utf8'));
  const tile = tileset.tiles[0]; tile.traceShapes = [{ id: 'trace.a', kind: 'rect', rect: [0, 0, 8, 8] }, { id: 'trace.b', kind: 'rect', rect: [8, 8, 8, 8] }];
  tile.allowedQuarterTurns = [0, 1, 2, 3]; save(path, tileset); const first = await exportLibrary(folder, 'map.forest', base());
  tile.traceShapes.reverse(); tile.allowedQuarterTurns.reverse(); save(path, tileset);
  expect((await exportLibrary(folder, 'map.forest', base())).zip).toEqual(first.zip); reset();
});

test('unrelated object IDs do not load optional profiles, and profile-only catalog bindings do', async () => {
  reset(); const mapPath = 'maps/forest.map.json', map = JSON.parse(readFileSync(join(folder.dir, mapPath), 'utf8'));
  // A broken optional movement document must remain unused when only a flag shares its ID.
  map.dependencies.push({ id: 'movement.unused', kind: 'movement', path: 'movement/unused.movement.json', required: false });
  map.flags.push({ id: 'movement.unused', initial: false }); save(mapPath, map);
  expect((await exportLibrary(folder, 'map.forest', base())).manifest.documents).toHaveLength(7);
  const profilePath = 'movement/player.movement.json', profile = JSON.parse(readFileSync(join(folder.dir, profilePath), 'utf8'));
  profile.abilities.push({ kind: 'modifier', version: 1, allowed: [{ key: 'review.speed', version: 1 }], stacking: 'replace' }); save(profilePath, profile);
  map.dependencies.find((d: { kind: string }) => d.kind === 'catalog').required = false;
  const catalogPath = 'catalogs/modifiers.catalog.json', catalog = { format: 'maplab.catalog', version: 1, id: 'catalog.modifiers', entries: [{ key: 'review.speed', version: 1, kind: 'modifier', stage: 'planned', fields: [], stateNames: [] }] };
  writeFileSync(join(folder.dir, catalogPath), JSON.stringify(catalog));
  const indexPath = join(folder.dir, 'maplab.project.json'), index = JSON.parse(readFileSync(indexPath, 'utf8'));
  index.documents.push({ id: catalog.id, kind: 'catalog', path: catalogPath, sha256: sha256(readFileSync(join(folder.dir, catalogPath))) }); writeFileSync(indexPath, JSON.stringify(index));
  map.dependencies.push({ id: catalog.id, kind: 'catalog', path: catalogPath, required: false }); save(mapPath, map);
  const exported = await exportLibrary(folder, 'map.forest', base()); expect(exported.manifest.requiredContracts).toContainEqual({ key: 'review.speed', version: 1 });
  expect(exported.manifest.documents.some((d) => d.id === 'movement.unused')).toBe(false); reset();
});
