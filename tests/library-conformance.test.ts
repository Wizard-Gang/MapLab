// ML-009: interprets the owned conformance/library step scripts against the real plugin on a Vite dev server.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { JsonValue } from '../src/contracts';
import type { LibraryFolder } from '../src/library/folder';
import { libraryForm } from '../src/library/library-form';
import { backups, call, cleanup, file, indexOf, placeholderDir, put, repoRoot, scratchLibrary, sha256, startServer, text, tree, type Reply, type Server } from './library-support';

interface Step {
  readonly do: 'save' | 'reopen' | 'outside-edit' | 'recover' | 'request';
  readonly rename?: Record<string, string>;
  readonly crashAt?: { step: string; path: string };
  readonly path?: string;
  readonly name?: string;
  readonly id?: string;
  readonly action?: 'keep' | 'restore';
  readonly label?: string;
  readonly headers?: Record<string, string | null>;
  readonly expect?: Record<string, JsonValue>;
}
interface Case { readonly id: string; readonly library?: 'placeholder'; readonly steps: readonly Step[] }
const index = JSON.parse(readFileSync(join(repoRoot, 'conformance/library/cases.json'), 'utf8')) as { base: { folder: string; copyOf: string; files: Record<string, string> }; cases: Case[] };
const COLLECTIONS = ['layers', 'visuals', 'materials', 'bodies', 'footholds', 'traversals', 'regions', 'entities', 'waypoints', 'routes', 'triggers', 'encounters', 'flags', 'prefabPlacements'];
const ids = (doc: Record<string, unknown>): string[] => COLLECTIONS.flatMap((c) => ((doc[c] as { id: string }[] | undefined) ?? []).map((r) => `${c}:${r.id}`)).sort();

test('the base library is pinned file by file and is a byte-identical copy of the R1 forest example', () => {
  const listed = Object.keys(index.base.files).sort();
  const onDisk = Object.keys(tree(join(repoRoot, index.base.folder))).sort();
  expect(onDisk).toEqual(listed);
  for (const [path, digest] of Object.entries(index.base.files)) {
    expect(sha256(readFileSync(join(repoRoot, index.base.folder, path)))).toBe(digest);
    expect(readFileSync(join(repoRoot, index.base.copyOf, path))).toEqual(readFileSync(join(repoRoot, index.base.folder, path)));
  }
  expect(readdirSync(join(repoRoot, index.base.copyOf)).sort()).toEqual(readdirSync(join(repoRoot, index.base.folder)).sort());
  expect(index.cases.map((c) => c.id)).toEqual(['two-map-library-reopen', 'stale-base-digest-conflict', 'torn-save', 'backup-before-replacement', 'wrong-host-origin-request', 'placeholder-write-refusal']);
});

describe.each(index.cases)('$id', (c) => {
  let server: Server;
  let folder: LibraryFolder;
  // The editor's view: content and base digests as opened, updated by its own successful saves.
  const opened = new Map<string, { text: string; digest: string }>();
  beforeAll(async () => {
    folder = c.library === 'placeholder' ? { dir: placeholderDir, label: 'placeholder library', placeholder: true } : scratchLibrary();
    for (const p of Object.keys(index.base.files)) opened.set(p, { text: text(folder, p), digest: sha256(file(folder, p)) });
    server = await startServer(folder.dir);
  });
  afterAll(async () => { await server.close(); cleanup(); });

  const saveBody = (rename: Record<string, string>): object => ({
    documents: Object.entries(rename).map(([path, name]) => {
      const doc = JSON.parse(opened.get(path)?.text as string) as Record<string, JsonValue> & { metadata: Record<string, JsonValue> };
      doc.metadata = { ...doc.metadata, name };
      return { id: doc.id, kind: 'map', text: libraryForm(doc), baseDigest: opened.get(path)?.digest };
    }),
  });
  const fill = (headers: Record<string, string | null>): Record<string, string | null> =>
    Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, v === null ? null : v.replaceAll('{port}', String(server.port))]));

  test.each(c.steps.map((s, i) => [i, s] as const))('step %i', async (_i, step) => {
    const before = tree(folder.dir);
    server.steps = [];
    server.fault = step.crashAt ? (s) => { if (s.step === step.crashAt?.step && s.path === step.crashAt.path) throw new Error('simulated crash'); } : null;
    let reply: Reply | null = null;
    switch (step.do) {
      case 'save': reply = await call(server.port, '/__maplab/save', { body: saveBody(step.rename ?? {}) }); break;
      case 'request': reply = await call(server.port, '/__maplab/save', { headers: fill(step.headers ?? {}), body: saveBody({ 'maps/forest.map.json': 'Hostile request' }) }); break;
      case 'recover': {
        const entry = ((await call(server.port, '/__maplab/library')).body.documents as { id: string; digest: string | null }[] | undefined)?.find((d) => d.id === step.id);
        reply = await call(server.port, '/__maplab/recover', { body: { id: step.id, action: step.action, digest: entry?.digest ?? null } });
        break;
      }
      case 'outside-edit': {
        const doc = JSON.parse(text(folder, step.path as string)) as { metadata: Record<string, JsonValue> };
        doc.metadata.name = step.name as string;
        put(folder, step.path as string, `${JSON.stringify(doc, null, 2)}\n`);
        break;
      }
      case 'reopen': reply = await call(server.port, '/__maplab/library'); break;
      default: throw new Error(`Unknown step ${(step as Step).do}`);
    }
    const e = step.expect ?? {};
    if (e.status !== undefined) expect(reply?.status, step.label).toBe(e.status);
    if (e.code !== undefined) expect(reply?.body.code, step.label).toBe(e.code);
    if (e.unchanged) expect(tree(folder.dir), step.label).toEqual(before);
    if (e.noBackups) expect(backups(folder)).toEqual([]);
    if (e.conflicts) expect((reply?.body.conflicts as { id: string }[]).map((x) => x.id)).toEqual(e.conflicts);
    if (e.written) expect((reply?.body.written as { path: string }[]).map((w) => w.path)).toEqual(e.written);
    if (e.order) expect(server.steps.map((s) => `${s.step} ${s.path}`)).toEqual(e.order);
    if (e.backupMatchesBase) {
      const [stamp] = backups(folder);
      for (const p of e.backupMatchesBase as string[]) expect(sha256(file(folder, `backups/${stamp}/${p}`))).toBe(index.base.files[p]);
    }
    if (reply?.status === 200 && step.do === 'save') {
      for (const w of reply.body.written as { path: string; digest: string }[]) opened.set(w.path, { text: text(folder, w.path), digest: w.digest });
    }
    const documents = reply?.body.documents as { id: string; path: string; state: string; restorable: boolean }[] | undefined;
    if (e.allOk) expect(documents?.map((d) => d.state)).toEqual(documents?.map(() => 'ok'));
    if (e.torn) expect(documents?.filter((d) => d.state !== 'ok').map((d) => d.id)).toEqual(e.torn);
    if (e.restorable) expect(documents?.filter((d) => d.restorable).map((d) => d.id)).toEqual(e.restorable);
    if (e.matchesBase) for (const p of e.matchesBase as string[]) expect(sha256(file(folder, p)), p).toBe(index.base.files[p]);
    if (e.names) for (const [p, name] of Object.entries(e.names as Record<string, string>)) expect(JSON.parse(text(folder, p)).metadata.name).toBe(name);
    if (e.idsAsOpened) {
      for (const p of e.idsAsOpened as string[]) expect(ids(JSON.parse(text(folder, p)))).toEqual(ids(JSON.parse(readFileSync(join(placeholderDir, p), 'utf8'))));
    }
    if (e.indexMatchesFiles) for (const d of indexOf(folder).documents) expect(sha256(file(folder, d.path)), d.path).toBe(d.sha256);
  });
});
