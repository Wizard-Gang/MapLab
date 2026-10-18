// ML-009: the R1 H4 save algorithm and torn-save recovery, called directly so every filesystem step is observable.
import { mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { readLibrary, snapshot } from '../src/library/folder';
import { libraryForm } from '../src/library/library-form';
import { recoverDocument, writeSave, type WriteStep } from '../src/library/writer';
import { CLEARING, FOREST, backups, cleanup, file, indexOf, json, put, renamed, scratchLibrary, sha256, text, tree } from './library-support';

afterEach(cleanup);
const NOW = new Date('2026-10-18T12:00:00.000Z');
const ID = '0123456789abcdef0123456789abcdef';

describe('a successful save', () => {
  test('backs up every replaced file and the index before writing, writes each file by temp and rename, and writes the index last', async () => {
    const f = scratchLibrary();
    const forest = file(f, FOREST), clearing = file(f, CLEARING), index = file(f, 'maplab.project.json');
    const steps: WriteStep[] = [];
    const r = await writeSave(f, { documents: [renamed(f, FOREST, 'Forest A'), renamed(f, CLEARING, 'Clearing A')] }, ID, NOW, { onStep: (s) => steps.push(s) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stamp = '20261018T120000000Z-01234567';
    expect(steps.map((s) => `${s.step} ${s.path}`)).toEqual([
      `backup ${FOREST}`, `backup ${CLEARING}`, 'backup maplab.project.json',
      `write ${FOREST}`, `rename ${FOREST}`, `write ${CLEARING}`, `rename ${CLEARING}`, 'index maplab.project.json', 'rename maplab.project.json',
    ]);
    expect(steps.filter((s) => s.step === 'write').every((s) => 'temp' in s && /\/\.[a-z]+\.map\.json\.[0-9a-f]+\.tmp$/.test(s.temp))).toBe(true);
    expect([file(f, `backups/${stamp}/${FOREST}`), file(f, `backups/${stamp}/${CLEARING}`), file(f, `backups/${stamp}/maplab.project.json`)]).toEqual([forest, clearing, index]);
    expect(r.result.written.map((w) => [w.path, w.digest])).toEqual([[FOREST, sha256(file(f, FOREST))], [CLEARING, sha256(file(f, CLEARING))]]);
    const entries = new Map(indexOf(f).documents.map((d) => [d.path, d.sha256]));
    expect([entries.get(FOREST), entries.get(CLEARING)]).toEqual([sha256(file(f, FOREST)), sha256(file(f, CLEARING))]);
    expect(text(f, 'maplab.project.json')).toBe(libraryForm(indexOf(f) as never));
    expect(json(f, FOREST).metadata.name).toBe('Forest A');
    expect((await snapshot(await readLibrary(f))).documents.every((d) => d.state === 'ok')).toBe(true);
  });

  test('writes a new document at its derived path and indexes it; removal deletes a file only after the index', async () => {
    const f = scratchLibrary();
    const copy = json(f, CLEARING);
    copy.id = 'map.glade';
    const steps: WriteStep[] = [];
    const glade = { id: 'map.glade', kind: 'map' as const, text: libraryForm(copy as never), baseDigest: null };
    const r = await writeSave(f, { documents: [glade] }, ID, NOW, { onStep: (s) => steps.push(s) });
    expect(r.ok && r.result.written[0]?.path).toBe('maps/glade.map.json');
    expect(indexOf(f).documents.find((d) => d.id === 'map.glade')?.sha256).toBe(sha256(file(f, 'maps/glade.map.json')));
    expect(steps.map((s) => s.step)).toEqual(['backup', 'write', 'rename', 'index', 'rename']);
    const removal: WriteStep[] = [];
    const gone = await writeSave(f, { documents: [], remove: [{ id: 'map.glade', baseDigest: sha256(file(f, 'maps/glade.map.json')) }] }, ID.replace('0', '1'), NOW, { onStep: (s) => removal.push(s) });
    expect(gone.ok).toBe(true);
    expect(removal.map((s) => `${s.step} ${s.path}`)).toEqual(['backup maps/glade.map.json', 'backup maplab.project.json', 'index maplab.project.json', 'rename maplab.project.json', 'remove maps/glade.map.json']);
    expect(indexOf(f).documents.some((d) => d.id === 'map.glade')).toBe(false);
  });
});

describe('a refused save writes nothing', () => {
  const refusedWith = async (prepare: (f: ReturnType<typeof scratchLibrary>) => unknown, status: number, code: string, placeholder = false) => {
    const f = { ...scratchLibrary(), placeholder };
    const request = prepare(f);
    const before = tree(f.dir);
    const steps: WriteStep[] = [];
    const r = await writeSave(f, request, ID, NOW, { onStep: (s) => steps.push(s) });
    expect(r.ok ? 'ok' : [r.status, r.refusal.code]).toEqual([status, code]);
    expect(steps).toEqual([]);
    expect(tree(f.dir)).toEqual(before);
    return r;
  };

  test('the placeholder library is read-only', () => refusedWith((f) => ({ documents: [renamed(f, FOREST, 'X')] }), 403, 'library.read-only', true));
  test('a stale base digest conflicts and reports the current digest', async () => {
    const r = await refusedWith((f) => { const d = renamed(f, FOREST, 'X'); put(f, FOREST, text(f, FOREST).replace('Forest acceptance world', 'Outside')); return { documents: [d] }; }, 409, 'save.stale-base');
    if (!r.ok) expect(r.refusal.conflicts?.[0]).toMatchObject({ id: 'map.forest', path: FOREST });
  });
  test('a new document whose file already exists conflicts', () => refusedWith((f) => {
    const copy = json(f, CLEARING); copy.id = 'map.glade'; put(f, 'maps/glade.map.json', '{}');
    return { documents: [{ id: 'map.glade', kind: 'map', text: libraryForm(copy as never), baseDigest: null }] };
  }, 409, 'save.stale-base'));
  test('a new document reusing an indexed ID conflicts', () => refusedWith((f) => ({ documents: [{ ...renamed(f, FOREST, 'X'), baseDigest: null }] }), 409, 'save.stale-base'));
  test('another document torn by an interrupted save blocks every save until it is resolved', () =>
    refusedWith((f) => { put(f, CLEARING, text(f, CLEARING).replace('Clearing destination', 'Half')); return { documents: [renamed(f, FOREST, 'X')] }; }, 409, 'library.torn'));
  test('a torn document is never saved over implicitly, even from its own current bytes', () =>
    refusedWith((f) => { put(f, CLEARING, text(f, CLEARING).replace('Clearing destination', 'Outside')); return { documents: [renamed(f, CLEARING, 'Mine')] }; }, 409, 'library.torn'));
  test('a removal must name a real digest', () =>
    refusedWith(() => ({ documents: [], remove: [{ id: 'map.clearing', baseDigest: null }] }), 400, 'save.request'));
  test('text that is not library form', () => refusedWith((f) => ({ documents: [{ ...renamed(f, FOREST, 'X'), text: text(f, FOREST) }] }), 422, 'save.invalid'));
  test('a document whose identity disagrees with the request', () =>
    refusedWith((f) => ({ documents: [{ ...renamed(f, FOREST, 'X'), id: 'map.clearing', baseDigest: sha256(file(f, CLEARING)) }] }), 422, 'save.invalid'));
  test('a merged library with a dangling required dependency', () => refusedWith((f) => {
    const doc = json(f, FOREST) as unknown as Record<string, unknown> & { dependencies: { id: string }[] };
    doc.dependencies = doc.dependencies.map((d) => (d.id === 'catalog.core' ? { ...d, id: 'catalog.absent', path: 'catalogs/absent.catalog.json' } : d));
    return { documents: [{ id: 'map.forest', kind: 'map', text: libraryForm(doc as never), baseDigest: sha256(file(f, FOREST)) }] };
  }, 422, 'save.invalid'));
  test('a dependency path that disagrees with the project index', () => refusedWith((f) => {
    const doc = json(f, CLEARING) as unknown as Record<string, unknown> & { dependencies: { id: string; path: string }[] };
    doc.dependencies = doc.dependencies.map((d) => (d.id === 'map.forest' ? { ...d, path: 'maps/elsewhere.map.json' } : d));
    return { documents: [{ id: 'map.clearing', kind: 'map', text: libraryForm(doc as never), baseDigest: sha256(file(f, CLEARING)) }] };
  }, 422, 'save.invalid'));
  test('a document over the 64 MiB bound', () => refusedWith((f) => ({ documents: [{ ...renamed(f, FOREST, 'x'.repeat(64 * 1024 * 1024)) }] }), 422, 'save.invalid'));
  test('palettes, malformed requests and empty saves', async () => {
    await refusedWith((f) => ({ documents: [{ id: 'palette.x', kind: 'palette', text: '{}', baseDigest: null }] }), 422, 'save.invalid');
    await refusedWith(() => ({ documents: 'all' }), 400, 'save.request');
    await refusedWith(() => ({ documents: [] }), 400, 'save.empty');
    await refusedWith((f) => ({ documents: [renamed(f, FOREST, 'X'), renamed(f, FOREST, 'Y')] }), 400, 'save.request');
  });
  test('an index path that goes through a symbolic link out of the library', async () => {
    const f = scratchLibrary();
    const outside = join(f.dir, '..', 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'forest.map.json'), file(f, FOREST));
    const r0 = await readLibrary(f);
    expect(r0.documents.length).toBeGreaterThan(0);
    // Replace the maps folder with a link to a folder outside the library.
    renameSync(join(f.dir, 'maps'), join(f.dir, 'maps-real'));
    symlinkSync(outside, join(f.dir, 'maps'));
    await expect(readLibrary(f)).rejects.toMatchObject({ code: 'library.symlink' });
    const r = await writeSave(f, { documents: [renamed(f, 'maps-real/forest.map.json', 'X', 'map.forest')] }, ID, NOW);
    expect(r.ok ? 'ok' : r.refusal.code).toBe('library.symlink');
  });
});

describe('interrupted new documents and missing files', () => {
  test('a retry of an interrupted new-document save may replace its stray file only with identical bytes', async () => {
    const f = scratchLibrary();
    const copy = json(f, CLEARING);
    copy.id = 'map.glade';
    const glade = { id: 'map.glade', kind: 'map' as const, text: libraryForm(copy as never), baseDigest: null };
    const crash = (s: WriteStep): void => { if (s.step === 'index') throw new Error('power cut'); };
    await expect(writeSave(f, { documents: [glade] }, ID, NOW, { onStep: crash })).rejects.toThrow('power cut');
    expect((await readLibrary(f)).unindexed).toEqual(['maps/glade.map.json']);
    const different = { ...glade, text: libraryForm({ ...copy, metadata: { ...copy.metadata, name: 'Other' } } as never) };
    const refused = await writeSave(f, { documents: [different] }, ID, NOW);
    expect(refused.ok ? 'ok' : refused.refusal.code).toBe('save.stale-base');
    const steps: WriteStep[] = [];
    const retried = await writeSave(f, { documents: [glade] }, ID.replace('0', '3'), NOW, { onStep: (s) => steps.push(s) });
    expect(retried.ok).toBe(true);
    expect(steps.map((s) => `${s.step} ${s.path}`).slice(0, 2)).toEqual(['backup maps/glade.map.json', 'backup maplab.project.json']);
    expect(indexOf(f).documents.find((d) => d.id === 'map.glade')?.sha256).toBe(sha256(file(f, 'maps/glade.map.json')));
  });

  test('a file deleted outside MapLab can be removed from the index by the user, after which saves work again', async () => {
    const f = scratchLibrary();
    const { rmSync } = await import('node:fs');
    rmSync(join(f.dir, 'prefabs/tree.prefab.json'));
    expect(await recoverDocument(f, { id: 'prefab.tree', action: 'keep', digest: null }, ID, NOW)).toMatchObject({ ok: false, refusal: { code: 'recover.missing' } });
    expect(await recoverDocument(f, { id: 'map.forest', action: 'forget', digest: sha256(file(f, FOREST)) }, ID, NOW)).toMatchObject({ ok: false, refusal: { code: 'recover.not-torn' } });
    const blocked = await writeSave(f, { documents: [renamed(f, CLEARING, 'Y')] }, ID, NOW);
    expect(blocked.ok ? 'ok' : blocked.refusal.code).toBe('library.torn');
    const forgot = await recoverDocument(f, { id: 'prefab.tree', action: 'forget', digest: null }, ID, NOW);
    expect(forgot).toMatchObject({ ok: true, result: { id: 'prefab.tree', digest: null } });
    expect(indexOf(f).documents.some((d) => d.id === 'prefab.tree')).toBe(false);
    expect(file(f, `backups/${backups(f)[0]}/maplab.project.json`)).toBeTruthy();
    // The forest map lists the prefab as optional, so the library still validates and saves succeed again.
    expect((await writeSave(f, { documents: [renamed(f, CLEARING, 'Saves again')] }, ID.replace('0', '4'), NOW)).ok).toBe(true);
  });

  test('a backup that is a symbolic link never stops the backup search', async () => {
    const f = scratchLibrary();
    const forest = file(f, FOREST);
    put(f, `backups/20261018T000000000Z-good0000/${FOREST}`, forest);
    mkdirSync(join(f.dir, 'backups/20261019T000000000Z-link0000/maps'), { recursive: true });
    symlinkSync(join(f.dir, FOREST), join(f.dir, `backups/20261019T000000000Z-link0000/${FOREST}`));
    put(f, FOREST, text(f, FOREST).replace('Forest acceptance world', 'Torn'));
    const snap = await snapshot(await readLibrary(f));
    expect(snap.documents.find((d) => d.id === 'map.forest')).toMatchObject({ state: 'torn', restorable: true });
    expect((await recoverDocument(f, { id: 'map.forest', action: 'restore', digest: sha256(file(f, FOREST)) }, ID, NOW)).ok).toBe(true);
    expect(file(f, FOREST)).toEqual(forest);
  });
});

describe('torn saves', () => {
  test('a save interrupted before the index is detected from the index digests and restored from its backup', async () => {
    const f = scratchLibrary();
    const forest = file(f, FOREST);
    const crash = (s: WriteStep): void => { if (s.step === 'index') throw new Error('power cut'); };
    await expect(writeSave(f, { documents: [renamed(f, FOREST, 'Half')] }, ID, NOW, { onStep: crash })).rejects.toThrow('power cut');
    const snap = await snapshot(await readLibrary(f));
    const torn = snap.documents.filter((d) => d.state !== 'ok');
    expect(torn.map((d) => [d.id, d.state, d.restorable])).toEqual([['map.forest', 'torn', true]]);
    expect(snap.documents.find((d) => d.id === 'map.forest')?.digest).toBe(sha256(file(f, FOREST)));
    // A later save of another document is refused until the user decides.
    const blocked = await writeSave(f, { documents: [renamed(f, CLEARING, 'Y')] }, ID, NOW);
    expect(blocked.ok ? 'ok' : blocked.refusal.code).toBe('library.torn');
    // Recovery needs the digest the user saw, then restores the newest backup that matches the index.
    expect(await recoverDocument(f, { id: 'map.forest', action: 'restore', digest: sha256(forest) }, ID, NOW)).toMatchObject({ ok: false, refusal: { code: 'recover.changed' } });
    const r = await recoverDocument(f, { id: 'map.forest', action: 'restore', digest: sha256(file(f, FOREST)) }, ID.replace('0', '2'), NOW);
    expect(r.ok).toBe(true);
    expect(file(f, FOREST)).toEqual(forest);
    expect((await snapshot(await readLibrary(f))).documents.every((d) => d.state === 'ok')).toBe(true);
    expect(backups(f)).toHaveLength(2);
  });

  test('keep records the file as it is; restore without a matching backup is refused; an intact document has nothing to recover', async () => {
    const f = scratchLibrary();
    put(f, CLEARING, text(f, CLEARING).replace('Clearing destination', 'Edited elsewhere'));
    const digest = sha256(file(f, CLEARING));
    expect(await recoverDocument(f, { id: 'map.clearing', action: 'restore', digest }, ID, NOW)).toMatchObject({ ok: false, refusal: { code: 'recover.no-backup' } });
    expect(await recoverDocument(f, { id: 'map.forest', action: 'keep', digest: sha256(file(f, FOREST)) }, ID, NOW)).toMatchObject({ ok: false, refusal: { code: 'recover.not-torn' } });
    expect(await recoverDocument({ ...f, placeholder: true }, { id: 'map.clearing', action: 'keep', digest }, ID, NOW)).toMatchObject({ ok: false, status: 403 });
    const r = await recoverDocument(f, { id: 'map.clearing', action: 'keep', digest }, ID, NOW);
    expect(r.ok).toBe(true);
    expect(indexOf(f).documents.find((d) => d.id === 'map.clearing')?.sha256).toBe(digest);
    expect(json(f, CLEARING).metadata.name).toBe('Edited elsewhere');
  });
});
