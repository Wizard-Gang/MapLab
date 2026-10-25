import { test, expect, beforeAll, afterAll, vi } from 'vitest';
import { cpSync, mkdtempSync, realpathSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join, dirname } from 'node:path'; import { execFileSync } from 'node:child_process';
import { exportLibrary } from '../src/library/export'; import { sha256, type ExportBundle } from '../src/export/bundle'; import { canonical } from '../src/contracts';
vi.setConfig({ hookTimeout: 20000, testTimeout: 15000 });
const root = 'conformance/prefabs', scratch = mkdtempSync(join(realpathSync(tmpdir()), 'maplab-prefabs-')), library = join(scratch, 'library'), dir = join(scratch, 'bundle'); let bundle: ExportBundle;
const read = (p: string): any => JSON.parse(readFileSync(join(root, p), 'utf8'));
function put(p: string, bytes: Uint8Array | string): void { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, bytes); }
const invoke = (): any => JSON.parse(execFileSync(process.execPath, [join(scratch, 'prefab-consumer.mjs'), dir, join(scratch, 'schemas')], { cwd: scratch, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
beforeAll(async () => {
  const documents = [];
  for (const p of ['catalogs/core.catalog.json', 'movement/player.movement.json', 'movement/ground.movement.json', 'prefabs/tree-marker.prefab.json', 'maps/two-placements.map.json']) {
    const input = p.startsWith('prefabs/') ? join(root, p) : p.startsWith('maps/') ? join(root, 'two-placements.expected.map.json') : join('placeholder-library', p), bytes = readFileSync(input), value = JSON.parse(bytes.toString());
    put(join(library, p), bytes); documents.push({ id: value.id, kind: value.format.slice(7), path: p, sha256: sha256(bytes) });
  }
  put(join(library, 'assets/22347f62eb64/22347f62eb6490be9371fe3d9f92a98684bbdef8e2b2f0bba1d096580419d3a1.svg'), readFileSync(join(root, 'assets/22347f62eb64/22347f62eb6490be9371fe3d9f92a98684bbdef8e2b2f0bba1d096580419d3a1.svg')));
  put(join(library, 'maplab.project.json'), JSON.stringify({ format: 'maplab.project', version: 1, id: 'project.prefabs', name: 'Prefab proof', defaults: { movementId: 'movement.player', tileSize: [32, 32], snap: [16, 16] }, documents }));
  bundle = await exportLibrary({ dir: library, label: 'Owned prefab proof', placeholder: false }, 'map.two-placements', sha256(readFileSync(join(library, 'maps/two-placements.map.json'))));
  for (const [p, bytes] of bundle.files) put(join(dir, p), bytes);
  cpSync('tests/consumer/reader', join(scratch, 'reader'), { recursive: true }); cpSync('schemas', join(scratch, 'schemas'), { recursive: true }); cpSync('tests/consumer/prefab-consumer.mjs', join(scratch, 'prefab-consumer.mjs'));
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
test('owned corpus hashes are exhaustive and repeat export bytes match pinned golden', async () => {
  const index = read('index.json'); expect(index.license).toBe('CC0-1.0');
  const walk = (p: string): string[] => readdirSync(join(root, p), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${p}${e.name}/`) : [`${p}${e.name}`]);
  expect(index.files.map((f: any) => f.path).sort()).toEqual(walk('').filter(p => p !== 'index.json').sort());
  for (const f of index.files) expect(sha256(readFileSync(join(root, f.path)))).toBe(f.sha256);
  const again = await exportLibrary({ dir: library, label: 'Repeat', placeholder: false }, 'map.two-placements', sha256(readFileSync(join(library, 'maps/two-placements.map.json'))));
  expect(again.zip).toEqual(bundle.zip); expect({ digest: bundle.digest, zipSha256: sha256(bundle.zip), files: bundle.files.size, bytes: bundle.zip.length }).toEqual(read('export.expected.json'));
  expect(invoke()).toEqual(read('consumer.expected.json'));
});
test('isolated final-byte consumer rejects coherent cross-placement flags/assets and geometry forgeries', () => {
  expect(invoke().verified).toBe(true); const path = join(dir, 'maps/two-placements.map.json'), original = readFileSync(path), manifestPath = join(dir, 'manifest.json'), manifestBytes = readFileSync(manifestPath);
  for (const mutate of [(m: any) => { m.triggers[0].actions[0].params.flag.ref.id = 'pp.b:visited'; }, (m: any) => { m.visuals.find((v: any) => v.id === 'pp.a:trunk').source.assetId = 'pp.b:image'; }, (m: any) => { m.bodies.find((v: any) => v.id === 'pp.a:body').position[0]++; }]) {
    const value = JSON.parse(original.toString()); mutate(value); const bytes = Buffer.from(canonical(value)); put(path, bytes);
    const manifest = JSON.parse(manifestBytes.toString()), f = manifest.files.find((f: any) => f.path === 'maps/two-placements.map.json'); f.bytes = bytes.length; f.sha256 = sha256(bytes); put(manifestPath, canonical(manifest)); expect(invoke).toThrow(); put(path, original); put(manifestPath, manifestBytes);
  }
  expect(invoke()).toEqual(read('consumer.expected.json'));
});
