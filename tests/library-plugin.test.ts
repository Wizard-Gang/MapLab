// ML-009: the library plugin on a real Vite dev server. Wrong Host/Origin/site/method/type requests are refused
// before anything is read or written; the placeholder refuses writes; saves and reads go through the endpoints.
import { cpSync, mkdirSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { chooseLibrary } from '../src/library/folder';
import { guardRefusal } from '../src/library/guard';
import { RecentWrites, watchedPath } from '../src/library/plugin';
import { REQUEST_LIMIT } from '../src/library/protocol';
import { FOREST, call, cleanup, file, placeholderDir, renamed, repoRoot, scratchLibrary, sha256, startServer, text, tree, type Server } from './library-support';

describe('the request guard', () => {
  const ok = { method: 'POST', headers: { host: '127.0.0.1:5182', origin: 'http://127.0.0.1:5182', 'content-type': 'application/json' } };
  test.each([
    ['localhost', { host: 'localhost:5182', origin: 'http://localhost:5182' }, null],
    ['IPv6 loopback', { host: '[::1]:5182', origin: 'http://[::1]:5182' }, null],
    ['charset parameter', { 'content-type': 'application/json; charset=utf-8' }, null],
    ['same-origin fetch metadata', { 'sec-fetch-site': 'same-origin' }, null],
    ['a DNS-rebound name', { host: 'evil.example:5182', origin: 'http://evil.example:5182' }, 'guard.host'],
    ['a loopback-looking name', { host: '127.0.0.1.nip.io:5182', origin: 'http://127.0.0.1.nip.io:5182' }, 'guard.host'],
    ['no Host', { host: undefined }, 'guard.host'],
    ['another origin', { origin: 'http://localhost:5182' }, 'guard.origin'],
    ['another port', { origin: 'http://127.0.0.1:5191' }, 'guard.origin'],
    ['https origin', { origin: 'https://127.0.0.1:5182' }, 'guard.origin'],
    ['null origin', { origin: 'null' }, 'guard.origin'],
    ['no Origin', { origin: undefined }, 'guard.origin'],
    ['repeated Origin', { origin: ['http://127.0.0.1:5182', 'http://127.0.0.1:5182'] }, 'guard.origin'],
    ['cross-site fetch metadata', { 'sec-fetch-site': 'cross-site' }, 'guard.site'],
    ['same-site fetch metadata', { 'sec-fetch-site': 'same-site' }, 'guard.site'],
    ['a form post', { 'content-type': 'application/x-www-form-urlencoded' }, 'guard.content-type'],
    ['text/plain', { 'content-type': 'text/plain' }, 'guard.content-type'],
    ['no content type', { 'content-type': undefined }, 'guard.content-type'],
  ])('%s', (_label, headers, code) => {
    expect(guardRefusal({ ...ok, headers: { ...ok.headers, ...headers } })?.code ?? null).toBe(code);
  });
  test('only POST', () => expect(guardRefusal({ ...ok, method: 'GET' })?.code).toBe('guard.method'));
});

describe('the plugin on a dev server', () => {
  let writable: Server, placeholder: Server, f: ReturnType<typeof scratchLibrary>;
  beforeAll(async () => {
    f = scratchLibrary();
    [writable, placeholder] = await Promise.all([startServer(f.dir), startServer(placeholderDir)]);
  });
  afterAll(async () => { await Promise.all([writable.close(), placeholder.close()]); cleanup(); });
  afterEach(() => { writable.steps = []; writable.fault = null; });

  test('identity and the library snapshot answer MapLab\'s own page', async () => {
    const who = await call(writable.port, '/__maplab/identity');
    expect(who.body).toMatchObject({ app: 'maplab', pid: process.pid, library: f.label });
    const lib = await call(writable.port, '/__maplab/library');
    expect(lib.status).toBe(200);
    expect(lib.body).toMatchObject({ ok: true, readOnly: false, projectId: 'project.forest-example' });
    expect((lib.body.documents as { id: string; state: string }[]).map((d) => d.state)).toEqual(Array(8).fill('ok'));
    const read = await call(writable.port, '/__maplab/read', { body: { ids: ['map.forest'] } });
    expect(read.body).toMatchObject({ ok: true, documents: [{ id: 'map.forest', path: FOREST, digest: sha256(file(f, FOREST)), text: text(f, FOREST) }] });
    expect((await call(writable.port, '/__maplab/read', { body: { ids: ['map.absent'] } })).status).toBe(404);
    expect((await call(writable.port, '/__maplab/nothing')).body.code).toBe('route.unknown');
  });

  test.each([
    ['a foreign Host (refused by Vite before the plugin)', { host: 'evil.example' }, 403, null],
    ['a cross-origin page', { origin: 'http://127.0.0.1:1' }, 403, 'guard.origin'],
    ['no Origin', { origin: null }, 403, 'guard.origin'],
    ['cross-site fetch metadata', { 'sec-fetch-site': 'cross-site' }, 403, 'guard.site'],
    ['a text/plain form-style post', { 'content-type': 'text/plain' }, 415, 'guard.content-type'],
  ])('a save from %s is refused and writes nothing', async (_label, headers, status, code) => {
    const before = tree(f.dir);
    const r = await call(writable.port, '/__maplab/save', { headers: headers as Record<string, string | null>, body: { documents: [renamed(f, FOREST, 'Hostile')] } });
    expect([r.status, r.body.code ?? null]).toEqual([status, code]);
    expect(writable.steps).toEqual([]);
    expect(tree(f.dir)).toEqual(before);
  });

  test('GET, oversized and malformed requests are refused', async () => {
    expect((await call(writable.port, '/__maplab/library', { method: 'GET', body: '' })).body.code).toBe('guard.method');
    expect((await call(writable.port, '/__maplab/library', { body: 'x'.repeat(REQUEST_LIMIT + 1) })).status).toBe(413);
    expect((await call(writable.port, '/__maplab/save', { body: '{not json' })).body.code).toBe('request.json');
  });

  test('the placeholder library refuses saves and recovery and is never written', async () => {
    const before = tree(placeholderDir);
    const save = await call(placeholder.port, '/__maplab/save', { body: { documents: [renamed({ dir: placeholderDir, label: '', placeholder: true }, FOREST, 'X')] } });
    expect([save.status, save.body.code]).toEqual([403, 'library.read-only']);
    const recover = await call(placeholder.port, '/__maplab/recover', { body: { id: 'map.forest', action: 'keep', digest: null } });
    expect([recover.status, recover.body.code]).toEqual([403, 'library.read-only']);
    expect((await call(placeholder.port, '/__maplab/library')).body).toMatchObject({ readOnly: true, placeholder: true, label: 'placeholder library' });
    expect(tree(placeholderDir)).toEqual(before);
  });

  test('a save through the endpoint writes, then a stale one is refused', async () => {
    const doc = renamed(f, FOREST, 'Through the endpoint');
    const r = await call(writable.port, '/__maplab/save', { body: { documents: [doc] } });
    expect(r.body).toMatchObject({ ok: true, written: [{ id: 'map.forest', path: FOREST, digest: sha256(file(f, FOREST)) }] });
    expect(writable.steps.at(-1)).toMatchObject({ step: 'rename', path: 'maplab.project.json' });
    const again = await call(writable.port, '/__maplab/save', { body: { documents: [doc] } });
    expect([again.status, again.body.code]).toEqual([409, 'save.stale-base']);
  });
});

describe('library resolution', () => {
  afterEach(cleanup);
  test('MAPLAB_LIBRARY wins, then ~/Documents/MapLab with an index, then the read-only placeholder', () => {
    const home = scratchLibrary().dir.replace(/\/library$/, '');
    const placeholder = chooseLibrary({ repoRoot, home, env: undefined });
    expect(placeholder).toMatchObject({ placeholder: true, label: 'placeholder library' });
    const mine = scratchLibrary();
    expect(chooseLibrary({ repoRoot, home, env: mine.dir })).toMatchObject({ dir: mine.dir, placeholder: false });
    expect(chooseLibrary({ repoRoot, home, env: placeholderDir })).toMatchObject({ placeholder: true });
    expect(() => chooseLibrary({ repoRoot, home, env: 'relative/library' })).toThrow('absolute');
    expect(() => chooseLibrary({ repoRoot, home, env: home })).toThrow('maplab.project.json');
    mkdirSync(`${home}/Documents`, { recursive: true });
    cpSync(placeholderDir, `${home}/Documents/MapLab`, { recursive: true });
    expect(chooseLibrary({ repoRoot, home, env: '' })).toMatchObject({ label: '~/Documents/MapLab', placeholder: false });
  });
});

describe('watcher filtering', () => {
  test('only document and index files count, and this server\'s own recent writes are ignored', () => {
    const f = { dir: '/lib', label: 'lib', placeholder: false };
    expect(['/lib/maplab.project.json', '/lib/maps/a.map.json', '/lib/maps/.a.map.json.x.tmp', '/lib/backups/s/maps/a.map.json', '/lib/maps/sub/a.json', '/lib/notes.txt', '/other/maps/a.map.json']
      .map((p) => watchedPath(f, p))).toEqual(['maplab.project.json', 'maps/a.map.json', null, null, null, null, null]);
    let now = 0;
    const recent = new RecentWrites(() => now);
    recent.add(['/lib/maps/a.map.json']);
    expect(recent.owns('/lib/maps/a.map.json')).toBe(true);
    now = 2_001;
    expect(recent.owns('/lib/maps/a.map.json')).toBe(false);
  });
});
