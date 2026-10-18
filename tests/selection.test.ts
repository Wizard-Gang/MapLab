import type { JsonValue } from '../src/contracts';
import { expect, test } from 'vitest';
import { cpSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// @ts-expect-error Existing JavaScript fixture materializer has no declaration file.
import { materialize } from './consumer/mutate.mjs';
import { createHash } from 'node:crypto';
import { candidate, cascade, copySelection, deleteSelection, dependents, editProblems, moveSelection, numericEdit, pasteSelection, readClipboard, recordOf, type ObjectKey } from '../src/editor/editing';
import { SelectionSession } from '../src/editor/selection';
import { commit, openDocument, undo, redo } from '../src/editor/history';
import { encode } from '../src/domain/model';
import { PickIndex, contains, selectionPrimitives } from '../src/render/picking';
import { buildScene, primitive } from '../src/render/scene';
import { ViewportSession } from '../src/editor/viewport';
import { worldToCss } from '../src/render/transform';
import { forestModel } from './history-support';
import { validateSourceGraph } from '../src/contracts';
import { denormalize, normalize } from '../src/domain/model';
import { shortcut } from '../src/editor/shortcuts';
const key = (collection: ObjectKey['collection'], id: string): ObjectKey => ({ collection, id });
const body = key('bodies', 'body.west'), region = key('regions', 'region.boss-enter');
const m = forestModel();

test('owned selection fixture is pinned and supplies independent movement and inspector expectations', () => {
  const dir = new URL('../conformance/selection/', import.meta.url), bytes = readFileSync(new URL('cases.json', dir));
  const manifest = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.files[0].sha256);
  const cases = JSON.parse(bytes.toString());
  for (const c of cases.moves) {
    const k = key(c.collection, c.id), next = candidate(m, moveSelection(m, [k], c.delta));
    expect(recordOf(next, k)?.[c.member]).toEqual(c.expected);
  }
});

test('mixed selection moves once, owned footholds follow bodies, undo and redo restore exact bytes', () => {
  const keys = [body, key('footholds', 'fh.west'), region];
  const tx = moveSelection(m, keys, [32, -16]), next = candidate(m, tx);
  expect(recordOf(next, body)?.position).toEqual([32, -16]);
  expect(recordOf(next, key('footholds', 'fh.west'))).toBe(recordOf(m, key('footholds', 'fh.west')));
  expect(editProblems(next)).toEqual([]);
  const before = openDocument(m), result = commit(before, tx); expect(result.outcome).toBe('recorded');
  expect(result.state.past).toHaveLength(1); expect(encode(undo(result.state).model)).toBe(encode(m));
  expect(encode(redo(undo(result.state)).model)).toBe(encode(next));
});

test('no-op moves record nothing; unsupported mixed selection refuses atomically', () => {
  const state = openDocument(m); expect(commit(state, moveSelection(m, [body], [0, 0])).outcome).toBe('noop');
  expect(() => moveSelection(m, [body, key('materials', 'material.earth')], [16, 0])).toThrow('independent position');
  expect(encode(state.model)).toBe(encode(m));
  expect(() => moveSelection(m, [key('footholds', 'fh.west')], [16, 0])).toThrow('owner body');
});

test('delete reports nested and document dependents, explicit retarget and cascade undo atomically', () => {
  const refs = dependents(m, [body]); expect(refs.some((d) => d.id === 'shape.west')).toBe(true);
  expect(() => deleteSelection(m, [body])).toThrow('References remain');
  expect(cascade(m, [key('regions', 'region.boss-camera')]).blocked.length).toBeGreaterThan(0);
  const plan = cascade(m, [region]); expect(plan.keys.map((k) => k.id)).toContain('trigger.boss-enter');
  const tx = deleteSelection(m, plan.keys), deleted = candidate(m, tx); expect(editProblems(deleted)).toEqual([]);
  const retargeted = candidate(m, deleteSelection(m, [region], 'region.boss'));
  expect(recordOf(retargeted, key('triggers', 'trigger.boss-enter'))?.regionId).toBe('region.boss');
  expect(editProblems(retargeted)).toEqual([]);
  expect(encode(undo(commit(openDocument(m), tx).state).model)).toBe(encode(m));
});

test('numeric inspector preserves nested siblings and rejects nonfinite/invalid geometry before commit', () => {
  const next = candidate(m, numericEdit(m, body, ['position', 0], -32)); expect(recordOf(next, body)?.position).toEqual([-32, 0]);
  expect(recordOf(next, body)?.shapes).toBe(recordOf(m, body)?.shapes);
  expect(() => numericEdit(m, body, ['position', 0], Infinity)).toThrow('finite');
  expect(editProblems(candidate(m, numericEdit(m, body, ['position', 0], 0.01))).length).toBeGreaterThan(0);
  expect(editProblems(candidate(m, numericEdit(m, body, ['shapes', 0, 'rect', 2], -1))).length).toBeGreaterThan(0);
});

test('clipboard paste remaps nested IDs, self links and cycles and each repeated paste gets fresh IDs', () => {
  const keys = [body, key('footholds', 'fh.west')], text = copySelection(m, keys), before = encode(m);
  const p = pasteSelection(m, text), once = candidate(m, p.tx);
  expect(p.keys.map((k) => k.id)).toEqual(['body.west-2', 'fh.west-2']);
  const fh = recordOf(once, key('footholds', 'fh.west-2'))!;
  expect(fh.ownerBodyId).toBe('body.west-2'); expect(fh.solidEdge).toEqual({ bodyId: 'body.west-2', shapeId: 'shape.west-2', edgeIndex: 0 });
  expect(pasteSelection(once, text).keys[0]?.id).toBe('body.west-3'); expect(encode(m)).toBe(before);
  const self = readClipboard(copySelection(m, [key('entities', 'portal.clearing')]));
  const rec = { ...self.items[0]!.record, id: 'portal.loop', destination: { mapId: m.id, entityId: 'portal.loop' } };
  const remapped = pasteSelection(m, JSON.stringify({ ...self, items: [{ collection: 'entities', record: rec }] }));
  expect((remapped.tx.ops[0] as any).entries[0].record.destination).toEqual({ mapId: m.id, entityId: 'portal.loop-2' });
  const cyclic = { ...self, items: ['a', 'b'].map((id, i) => ({ collection: 'entities', record: { ...rec, id, destination: { mapId: m.id, entityId: i ? 'a' : 'b' } } })) };
  const cycle = pasteSelection(m, JSON.stringify(cyclic));
  expect((cycle.tx.ops[0] as any).entries.map((e: any) => e.record.destination.entityId)).toEqual(['b-2', 'a-2']);
});

test('clipboard rejects versions, duplicate IDs, missing targets, malformed JSON; repair is explicit', () => {
  const clip = readClipboard(copySelection(m, [region]));
  expect(() => readClipboard('{"format":"maplab.clipboard","version":2}')).toThrow('version 1');
  expect(() => readClipboard('{"version":1,"version":2}')).toThrow('valid JSON');
  expect(() => pasteSelection(m, JSON.stringify({ ...clip, items: [...clip.items, ...clip.items] }))).toThrow('repeated');
  const bad = readClipboard(copySelection(m, [key('triggers', 'trigger.boss-enter')]));
  const broken = JSON.stringify({ ...bad, items: [{ ...bad.items[0], record: { ...bad.items[0]!.record, regionId: 'region.missing' } }] });
  expect(() => pasteSelection(m, broken)).toThrow('Repair clipboard references');
  const fixed = pasteSelection(m, broken, new Map([['region.missing', 'region.boss']])); expect(editProblems(candidate(m, fixed.tx))).toEqual([]);
});

function setup() {
  let state = openDocument(m); const view = new ViewportSession(); view.resize([1000, 600], [0, 0, 1280, 720]);
  view.snap({ free: true, spacing: [32, 32], origin: [0, 0] });
  const index = new PickIndex(m, buildScene(m));
  const session = new SelectionSession(() => state.model, (tx) => { state = commit(state, tx).state; return true; }, () => true);
  return { session, view, index, state: () => state };
}
test('pointer preview is session-only; Escape/cancel restores selection/source/history and release commits once', () => {
  const t = setup(), at = worldToCss(t.view.getSnapshot().view, [64, 660]);
  t.session.mode('Collision'); t.session.select([body]);
  const before = encode(t.state().model);
  for (let n = 0; n < 3; n++) {
    t.session.down(at, t.index, t.view.getSnapshot(), false, false); t.session.move([at[0] + 48, at[1] - 16]);
    expect(t.session.getSnapshot().delta[0]).not.toBe(0); expect(encode(t.state().model)).toBe(before); t.session.cancel();
    expect(t.session.getSnapshot().delta).toEqual([0, 0]); expect(t.state().past).toHaveLength(0);
  }
  t.session.down(at, t.index, t.view.getSnapshot(), false, false);
  for (let x = 1; x <= 48; x++) t.session.move([at[0] + x, at[1]]);
  t.session.end(); expect(t.state().past).toHaveLength(1); expect(encode(undo(t.state()).model)).toBe(before);
});

test('picking excludes camera backgrounds, filters modes, honors hidden art, exact polygons and CSS handles', () => {
  const t = setup(), state = t.view.getSnapshot(), at = worldToCss(state.view, [64, 640]);
  expect(t.index.pick(at, state, 'Collision').map((k) => k.id)).toContain('body.west');
  expect(t.index.pick(at, state, 'Platforms').map((k) => k.id)).toContain('fh.west');
  expect(t.index.pick(at, state, 'Objects').every((k) => k.collection === 'visuals')).toBe(true);
  expect(t.index.items.filter((p) => p.pass === 'Art').every((p) => t.index.scene.art.find((a) => a.layer.id === p.layerId)?.layer.kind !== 'background')).toBe(true);
  const triangle = primitive([[0, 0], [10, 0], [0, 10]], '#ffffff', '', true);
  expect(contains(triangle, [9, 9], 0.1)).toBe(false); expect(contains(triangle, [2, 2], 0.1)).toBe(true);
  const h = selectionPrimitives(t.index, [body], { ...state.view, zoom: 2 }); expect(h[1]!.bounds[2] * 2).toBe(6);
  expect(t.index.marquee([0, 630], [480, 720], state, 'Collision').map((k) => k.id)).toContain('body.west');
});

test('shortcut table matches modifiers and leaves unrelated field bindings to the UI guard', () => {
  expect(shortcut({ key: 'd', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe('duplicate');
  expect(shortcut({ key: 'd', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBeUndefined();
  expect(shortcut({ key: 'z', ctrlKey: false, metaKey: true, altKey: false, shiftKey: true })).toBe('redo');
});

test('pasted owned geometry passes the independent full source-graph validator', () => {
  const root = new URL('../placeholder-library/', import.meta.url);
  const sources = ['maps', 'movement', 'catalogs', 'tilesets', 'prefabs'].flatMap((dir) => readdirSync(new URL(dir + '/', root)).map((file) => JSON.parse(readFileSync(new URL(dir + '/' + file, root), 'utf8'))));
  const next = candidate(m, pasteSelection(m, copySelection(m, [body, key('footholds', 'fh.west')])).tx);
  const result = validateSourceGraph(sources.map((d) => d.id === m.id ? denormalize(next) : d));
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
});


test('isolated independent reader accepts final pasted bytes and rejects a corrupted remapped reference', () => {
  const root = fileURLToPath(new URL('../', import.meta.url)), scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maplab-selection-consumer-')));
  try {
    cpSync(join(root, 'tests/consumer/reader'), join(scratch, 'reader'), { recursive: true }); cpSync(join(root, 'schemas'), join(scratch, 'schemas'), { recursive: true });
    const index = JSON.parse(readFileSync(join(root, 'conformance/bundle/cases.json'), 'utf8')), golden = join(root, index.golden.export.path);
    const normalized = normalize(JSON.parse(readFileSync(join(golden, 'maps/forest.map.json'), 'utf8'))); if (!normalized.ok) throw new Error('invalid golden');
    const base = normalized.model, next = candidate(base, pasteSelection(base, copySelection(base, [body, key('footholds', 'fh.west')])).tx), doc = denormalize(next);
    const edits = [{ file: 'maps/forest.map.json', set: '/bodies', value: doc.bodies }, { file: 'maps/forest.map.json', set: '/footholds', value: doc.footholds }];
    const run = (mutations: unknown[]) => {
      materialize(golden, join(scratch, 'bundle'), { id: 'ML-011-paste', edits: mutations }, join(scratch, 'schemas'));
      const r = spawnSync(process.execPath, [join(scratch, 'reader/read-bundle.mjs'), '--schemas', join(scratch, 'schemas'), join(scratch, 'bundle')], { cwd: scratch, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
      expect(r.stderr).toBe(''); return { status: r.status, report: JSON.parse(r.stdout) };
    };
    const good = run(edits); expect(good.status).toBe(0); expect(good.report.claims.referencesResolved).toBe(true);
    const count = (doc.footholds as JsonValue[]).length;
    const bad = run([...edits, { file: 'maps/forest.map.json', set: `/footholds/${count - 1}/solidEdge/bodyId`, value: 'body.missing' }]);
    expect(bad.status).toBe(1); expect(bad.report.diagnostics.some((d: { code: string }) => d.code === 'reference.dangling')).toBe(true);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('surface-anchor movement retains its reference, quantizes u/offset and requires retarget beyond the segment', () => {
  const k = key('entities', 'start.player'), next = candidate(m, moveSelection(m, [k], [60, 0]));
  expect(recordOf(next, k)?.anchor).toEqual({ kind: 'surface', footholdId: 'fh.west', u: 0.25, normalOffset: 0 });
  expect(() => moveSelection(m, [k], [-1000, 0])).toThrow('retarget');
  expect(recordOf(m, k)?.anchor).toEqual({ kind: 'surface', footholdId: 'fh.west', u: 0.125, normalOffset: 0 });
});


test('body plus parented attached visual translates once and inverse parent transforms preserve world movement', () => {
  const source = JSON.parse(encode(m));
  const child = source.visuals.find((v: any) => v.id === 'visual.gate'), parent = source.visuals.find((v: any) => v.id === 'visual.front');
  child.parentId = parent.id;
  parent.transform.rotation = 90; parent.transform.scale = [2, 1];
  const normalized = normalize(source); if (!normalized.ok) throw new Error('invalid fixture');
  const base = normalized.model, k = key('visuals', child.id), gate = key('bodies', 'body.gate');
  const both = candidate(base, moveSelection(base, [k, gate], [32, 16]));
  expect(recordOf(both, k)?.transform).toEqual(child.transform);
  const only = candidate(base, moveSelection(base, [k], [32, 16]));
  const points = (model: typeof base) => buildScene(model).art.flatMap((a) => a.commands).find((p) => p.objectId === k.id)!.points;
  points(base).forEach((p, i) => { expect(points(only)[i]![0] - p[0]).toBeCloseTo(32, 10); expect(points(only)[i]![1] - p[1]).toBeCloseTo(16, 10); });
});
