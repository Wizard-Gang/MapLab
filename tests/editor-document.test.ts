// ML-009: the document session around ML-008's history. Dirty compares digests (R1 H3), save tickets complete
// with the written digest, revert and draft restore keep the right base, and Save As/New map make valid documents.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadSourceGraph, type JsonValue } from '../src/contracts';
import { normalize, type MapModel } from '../src/domain/model';
import { duplicateMap, mapName, modelDigest, modelText, newMapDocument, objectIds, openFromFile, refreshDigest, renameMap, stageMap } from '../src/editor/document';
import { beginSave, completeSave, digestKnown, isDirty, noteDigest, openDocument, revert, restoreDraft, undo, type DocumentState } from '../src/editor/history';
import { libraryForm } from '../src/library/library-form';
import { placeholderDir, sha256 } from './library-support';

const read = (path: string): string => readFileSync(join(placeholderDir, path), 'utf8');
const library = (JSON.parse(read('maplab.project.json')) as { documents: { path: string }[] }).documents.map((d) => read(d.path));
const forestText = read('maps/forest.map.json');
const model = (text: string): MapModel => { const s = stageMap(text); if (!s.ok) throw new Error('stage'); return s.model; };
const renamed = (s: DocumentState, name: string): DocumentState => { const r = renameMap(s, name); if (r.outcome !== 'recorded') throw new Error(r.outcome); return r.state; };

describe('dirty state compares digests', () => {
  test('a file opens clean with its library-form digest as saved and its file digest as base', async () => {
    const s = await openFromFile(model(forestText), sha256(forestText));
    expect([isDirty(s), s.saved?.digest, s.baseDigest]).toEqual([false, await modelDigest(s.model), sha256(forestText)]);
    expect(s.saved?.digest).not.toBe(s.baseDigest);
  });

  test('a different edit that recreates the saved content is dirty until its digest is known, then clean', async () => {
    const s0 = await openFromFile(model(forestText), sha256(forestText));
    const s2 = renamed(renamed(s0, 'Elsewhere'), mapName(s0.model));
    expect([isDirty(s2), digestKnown(s2)]).toEqual([true, false]);
    const checked = await refreshDigest(s2);
    expect([isDirty(checked), digestKnown(checked)]).toEqual([false, true]);
    expect(isDirty(undo(checked))).toBe(true);
    // A digest for content the document has moved past is ignored.
    expect(noteDigest(checked, s0.contentId, 'x')).toBe(checked);
  });

  test('a completed save makes the written digest both saved and base; edits during the save stay dirty', async () => {
    const s0 = await openFromFile(model(forestText), sha256(forestText));
    const s1 = renamed(s0, 'A');
    const ticket = beginSave(s1);
    const digest = sha256(modelText(ticket.model));
    const done = completeSave(s1, ticket, digest);
    if (!done.ok) throw new Error(done.code);
    expect([done.state.saved?.digest, done.state.baseDigest, isDirty(done.state)]).toEqual([digest, digest, false]);
    const during = renamed(s1, 'B');
    const late = completeSave(during, ticket, digest);
    if (!late.ok) throw new Error(late.code);
    expect(isDirty(late.state)).toBe(true);
    expect(isDirty(await refreshDigest(renamed(late.state, 'A')))).toBe(false);
  });

  test('revert keeps the base on disk; a restored draft is dirty and keeps the base it was edited from', async () => {
    const s0 = await openFromFile(model(forestText), sha256(forestText));
    const s1 = renamed(s0, 'A');
    const reverted = revert(s1, s0.model);
    expect([isDirty(reverted), reverted.baseDigest, reverted.past.length]).toEqual([false, sha256(forestText), 0]);
    const draft = renamed(s0, 'Draft').model;
    const restored = restoreDraft(s0, draft, 'old-base');
    expect([isDirty(restored), restored.baseDigest, mapName(restored.model), restored.past.length, restored.session]).toEqual([true, 'old-base', 'Draft', 0, s0.session]);
    expect(completeSave(restored, beginSave(s0), 'x')).toMatchObject({ ok: false, code: 'save.stale-base' });
    expect(() => restoreDraft(s0, model(read('maps/clearing.map.json')), null)).toThrow(RangeError);
    expect(() => openDocument(s0.model, { savedDigest: null, baseDigest: 'x' })).toThrow(RangeError);
  });
});

describe('Save As / Duplicate and New map', () => {
  test('a duplicate has a new map identity, keeps every local ID, retargets self-portals and keeps links to other maps', () => {
    const clearing = JSON.parse(read('maps/clearing.map.json')) as { entities: { kind: string; destination?: { mapId: string; entityId: string } }[] };
    const portal = clearing.entities.find((e) => e.kind === 'portal');
    if (!portal?.destination) throw new Error('portal');
    portal.destination = { mapId: 'map.clearing', entityId: 'start.arrival' };
    const original = model(JSON.stringify(clearing));
    const dup = duplicateMap(original, 'map.glade', 'Glade', (id) => id === 'map.forest');
    if (!dup.ok) throw new Error(dup.message);
    expect([dup.model.id, dup.path, mapName(dup.model)]).toEqual(['map.glade', 'maps/glade.map.json', 'Glade']);
    expect([...objectIds(dup.model)]).toEqual([...objectIds(original)]);
    const text = modelText(dup.model);
    expect(text).toContain('"mapId": "map.glade"');
    expect(text).not.toContain('"map.clearing"');
    expect(text).toContain('"id": "map.forest"');
    const forestDup = duplicateMap(model(forestText), 'map.forest-2', 'Forest 2', () => false);
    if (!forestDup.ok) throw new Error(forestDup.message);
    expect(modelText(forestDup.model)).toContain('"mapId": "map.clearing"');
    expect(loadSourceGraph([...library, modelText(forestDup.model)]).ok).toBe(true);
    expect(duplicateMap(original, 'map.forest', 'x', (id) => id === 'map.forest')).toMatchObject({ ok: false });
    expect(duplicateMap(original, 'map:bad', 'x', () => false)).toMatchObject({ ok: false });
  });

  test.each([false, true])('a new map validates with the library on its own (tiles: %s)', (tiles) => {
    const doc = newMapDocument({ id: 'map.meadow', name: 'Meadow', width: 960, height: 544, movement: { id: 'movement.player', path: 'movement/player.movement.json' },
      ...(tiles ? { tiles: { tilesetId: 'tileset.forest', path: 'tilesets/forest.tileset.json', size: 32 } } : {}) });
    const graph = loadSourceGraph([...library, libraryForm(doc as JsonValue)]);
    expect(graph.ok ? [] : graph.diagnostics).toEqual([]);
    const n = normalize(doc as JsonValue);
    expect(n.ok && isDirty(openDocument(n.model))).toBe(true);
  });
});
