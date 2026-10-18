// ML-008 review regressions: the blocking findings (B1–B4) and the repaired notes of the exact-head
// review at 61856eb, each reproduced as it was reported and now refused or corrected.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { validateSourceGraph, type JsonValue } from '../src/contracts';
import { insertOp, paintOp, rectangle, setOp, transaction } from '../src/domain/commands';
import { encode, normalize, type JsonObject, type MapModel } from '../src/domain/model';
import { planPaste, pasteTransaction, type PasteItem } from '../src/domain/remap';
import { applyTransaction, invertTransaction, type Transaction } from '../src/domain/transaction';
import { beginGesture } from '../src/editor/gesture';
import { NOTICE_LIMIT, beginSave, commit, completeSave, isDirty, openDocument, redo, undo, type DocumentState } from '../src/editor/history';
import { cell, forestDocument, forestModel, modelOf, root } from './history-support';

const recorded = (s: DocumentState, tx: Transaction): DocumentState => {
  const r = commit(s, tx);
  if (r.outcome !== 'recorded') throw new Error(`Expected a recorded entry, got ${r.outcome}`);
  return r.state;
};
const saved = (s: DocumentState, digest: string): DocumentState => {
  const r = completeSave(s, beginSave(s), digest);
  if (!r.ok) throw new Error(r.code);
  return r.state;
};
const apply = (m: MapModel, tx: Transaction): MapModel => { const r = applyTransaction(m, tx); if (!r.ok) throw new Error(JSON.stringify(r.problem)); return r.model; };
const rec = (m: MapModel, c: string, id: string) => m.collections.get(c as never)?.byId.get(id) as JsonObject;

test('B1: Escape keeps a save that completed during the gesture', () => {
  const s0 = openDocument(forestModel(), { savedDigest: 'disk-0' });
  const s1 = saved(recorded(s0, transaction('A', [setOp(s0.model, 'bodies', 'body.gate', 'name', 'A')])), 'disk-1');
  const s2 = undo(s1);
  const drag = beginGesture(s2, 'Drag');
  drag.set('bodies', 'body.gate', 'position', [9, 9]);
  const s3 = saved(s2, 'disk-2');
  const after = drag.cancel(s3);
  expect(after).toBe(s3);
  expect([isDirty(after), after.baseDigest]).toEqual([false, 'disk-2']);
});

test('B2: a save ticket from another open of the same map is refused', () => {
  const first = openDocument(forestModel(), { savedDigest: 'disk-0' });
  const a = recorded(first, transaction('A', [setOp(first.model, 'bodies', 'body.gate', 'name', 'A')]));
  const second = openDocument(forestModel(), { savedDigest: 'disk-0' });
  const b = recorded(second, transaction('B', [setOp(second.model, 'bodies', 'body.gate', 'name', 'B')]));
  expect(a.contentId).toBe(b.contentId);
  const r = completeSave(b, beginSave(a), 'disk-a');
  expect(r).toMatchObject({ ok: false, code: 'save.session' });
  expect(r.state).toBe(b);
  expect(isDirty(r.state)).toBe(true);
});

describe('B3: inherited member names are absent, never read through a prototype', () => {
  test.each(['constructor', 'toString', 'hasOwnProperty'])('%s', (member) => {
    const m = forestModel();
    const op = setOp(m, 'bodies', 'body.gate', member, 'x');
    expect(op).toMatchObject({ before: undefined, after: 'x' });
    const tx = transaction('Set', [op]);
    const next = apply(m, tx);
    expect(Object.hasOwn(rec(next, 'bodies', 'body.gate'), member)).toBe(true);
    const back = apply(next, invertTransaction(tx));
    expect(encode(back)).toBe(encode(m));
    expect(Object.hasOwn(rec(back, 'bodies', 'body.gate'), member)).toBe(false);
  });

  test('__proto__ is an ordinary own member and Object.prototype stays untouched', () => {
    const m = forestModel();
    const tx = transaction('Set', [setOp(m, 'bodies', 'body.gate', '__proto__', { polluted: true })]);
    const next = apply(m, tx);
    const gate = rec(next, 'bodies', 'body.gate');
    expect(Object.hasOwn(gate, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(gate)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.isFrozen(Object.prototype)).toBe(false);
    expect(encode(next)).toContain('"__proto__":{"polluted":true}');
    expect(encode(apply(next, invertTransaction(tx)))).toBe(encode(m));
    expect(apply(m, transaction('T', [setOp(m, 'bodies', 'body.gate', 'constructor', undefined)])).collections).toBe(m.collections);
  });
});

describe('B4: groups share the object namespace', () => {
  const others = ['maps/clearing.map.json', 'movement/player.movement.json', 'movement/ground.movement.json', 'movement/flyer.movement.json',
    'catalogs/core.catalog.json', 'tilesets/forest.tileset.json', 'prefabs/tree.prefab.json']
    .map((f) => JSON.parse(readFileSync(join(root, 'docs/specifications/2026-10-17-maplab-r1/examples/forest', f), 'utf8')) as JsonValue);
  const identityErrors = (m: MapModel): string[] => validateSourceGraph([JSON.parse(encode(m)) as JsonValue, ...others]).diagnostics
    .filter((d) => d.severity === 'error' && ['object.identity', 'encounter.group', 'encounter.spawn'].includes(d.code)).map((d) => d.code);

  test('the forest map counts its implicit group', () => {
    const m = forestModel();
    expect(m.groups.get('group.boss')).toBe(2);
    expect(identityErrors(m)).toEqual([]);
  });

  test('a record may not take a group ID, and a group may not take an object ID', () => {
    const m = forestModel();
    expect(applyTransaction(m, transaction('Flag', [insertOp(m, 'flags', [{ id: 'group.boss', initial: false }])]))).toMatchObject({ ok: false, problem: { code: 'transaction.duplicate-id' } });
    expect(applyTransaction(m, transaction('Group', [setOp(m, 'entities', 'spawn.boss', 'groupId', 'body.gate')]))).toMatchObject({ ok: false, problem: { code: 'transaction.duplicate-id' } });
    const doc = forestDocument() as any;
    doc.flags[0].id = 'group.boss';
    expect(normalize(doc)).toMatchObject({ ok: false, problems: [{ code: 'model.duplicate-id' }] });
  });

  test('members leave and rejoin a group exactly, and a group-kind layer may share its group', () => {
    const m = forestModel();
    const tx = transaction('Regroup', [setOp(m, 'entities', 'spawn.boss', 'groupId', 'group.other')]);
    const next = apply(m, tx);
    expect([next.groups.get('group.boss'), next.groups.get('group.other')]).toEqual([1, 1]);
    expect([...apply(next, invertTransaction(tx)).groups]).toEqual([...m.groups]);
    const layer = { ...rec(m, 'layers', 'layer.actors'), id: 'group.boss', kind: 'group' };
    expect(apply(m, transaction('Layer', [insertOp(m, 'layers', [layer])])).groups.get('group.boss')).toBe(3);
  });

  test('pasting an encounter gives it a new group that its pasted spawns follow', () => {
    const m = forestModel();
    const items: PasteItem[] = [{ collection: 'encounters', record: rec(m, 'encounters', 'encounter.boss') }, { collection: 'entities', record: rec(m, 'entities', 'spawn.boss') }];
    const plan = planPaste(m, items);
    expect(plan.mapping.get('group.boss')).toBe('group.boss-2');
    const [encounter, spawn] = plan.items.map((i) => i.record);
    expect([encounter?.groupId, spawn?.groupId, encounter?.spawnIds]).toEqual(['group.boss-2', 'group.boss-2', ['spawn.boss-2']]);
    expect(identityErrors(apply(m, pasteTransaction(m, plan)))).toEqual([]);
  });

  test('paste never allocates an existing group ID, and group refs resolve', () => {
    const doc = forestDocument() as any;
    for (const e of [...doc.entities, ...doc.encounters]) if (e.groupId === 'group.boss') e.groupId = 'flag.boss-defeated-2';
    const m = modelOf(doc);
    expect(planPaste(m, [{ collection: 'flags', record: rec(m, 'flags', 'flag.boss-defeated') }]).mapping.get('flag.boss-defeated')).toBe('flag.boss-defeated-3');
    const action = { key: 'core.encounter.activate', params: { target: { ref: { id: 'flag.boss-defeated-2', kind: 'group' } } }, version: 1 };
    const trigger = { ...rec(m, 'triggers', 'trigger.boss-enter'), actions: [action] };
    expect(planPaste(m, [{ collection: 'triggers', record: trigger }]).unresolved).toEqual([]);
  });
});

test('N3: committing never freezes or shares caller data, and a recorded entry cannot be edited', () => {
  const s0 = openDocument(forestModel());
  const flag = { id: 'flag.new', initial: false };
  const tx = transaction('Add', [insertOp(s0.model, 'flags', [flag])]);
  const s1 = recorded(s0, tx);
  expect(Object.isFrozen(flag)).toBe(false);
  flag.initial = true;
  expect(rec(s1.model, 'flags', 'flag.new').initial).toBe(false);
  expect(Object.isFrozen(s1.past[0]) && Object.isFrozen(s1.past[0]?.tx.ops)).toBe(true);
  expect(rec(redo(undo(s1)).model, 'flags', 'flag.new').initial).toBe(false);
  const paint = transaction('Paint', [paintOp(s0.model, 'layer.tiles', rectangle(0, 0, 4, 1, cell('tile.grass')))]);
  const s2 = recorded(s0, paint);
  const op = paint.ops[0];
  if (op?.op === 'paint') op.delta.chunks[0]?.after.fill(0);
  expect(encode(redo(undo(s2)).model)).toBe(encode(s2.model));
});

test('N6: drop notices keep only the most recent entries while dropped counts all', () => {
  let s = openDocument(forestModel(), { budget: 500 });
  for (let i = 0; i < NOTICE_LIMIT + 6; i++) s = recorded(s, transaction(`Rename ${i}`, [setOp(s.model, 'bodies', 'body.gate', 'name', `Gate ${i}`.repeat(20))]));
  expect([s.notices.length, s.dropped]).toEqual([NOTICE_LIMIT, NOTICE_LIMIT + 6]);
});

test('N10: a gesture set the base would refuse is rejected and preview keeps working', () => {
  const s0 = openDocument(forestModel());
  const g = beginGesture(s0, 'Edit');
  const shapes = [{ ...(rec(s0.model, 'bodies', 'body.west').shapes as JsonObject[])[0], id: 'fh.east' }];
  expect(g.set('bodies', 'body.west', 'shapes', shapes)).toEqual({ ok: false, code: 'gesture.refused', written: 0 });
  expect(g.set('bodies', 'body.west', 'name', 'West')).toEqual({ ok: true });
  expect(rec(g.preview(), 'bodies', 'body.west').name).toBe('West');
});
