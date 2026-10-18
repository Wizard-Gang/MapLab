// ML-008: per-document history, revision/dirty/saved state, save conflicts, gestures and the memory bound.
import { describe, expect, test } from 'vitest';
import { fieldOp, paintOp, rectangle, setOp, transaction } from '../src/domain/commands';
import { encode } from '../src/domain/model';
import { CHUNK_CELLS, deltaCells, readCell } from '../src/domain/paint';
import { beginGesture } from '../src/editor/gesture';
import { beginSave, canRedo, canUndo, commit, completeSave, isDirty, openDocument, redo, revert, undo, type DocumentState } from '../src/editor/history';
import { cell, forestModel } from './history-support';

const recorded = (s: DocumentState, tx: Parameters<typeof commit>[1]): DocumentState => {
  const r = commit(s, tx);
  if (r.outcome !== 'recorded') throw new Error(`Expected a recorded entry, got ${r.outcome}`);
  return r.state;
};
const rename = (s: DocumentState, name: string) => transaction('Rename', [setOp(s.model, 'bodies', 'body.gate', 'name', name)]);
const grass = cell('tile.grass');

describe('undo, redo and no-ops', () => {
  test('each commit is one entry, undo/redo restore exact content, and a new edit clears redo', () => {
    const s0 = openDocument(forestModel(), { savedDigest: 'd0' });
    const s1 = recorded(s0, rename(s0, 'A'));
    const s2 = recorded(s1, rename(s1, 'B'));
    expect([s2.past.length, s2.revision, s2.contentId]).toEqual([2, 2, 3]);
    const u = undo(s2);
    expect(encode(u.model)).toBe(encode(s1.model));
    expect([u.past.length, u.future.length, u.revision, u.contentId]).toEqual([1, 1, 3, s1.contentId]);
    expect(encode(redo(u).model)).toBe(encode(s2.model));
    expect(redo(u).contentId).toBe(s2.contentId);
    const branch = recorded(u, rename(u, 'C'));
    expect(canRedo(branch)).toBe(false);
    expect(branch.contentId).not.toBe(s2.contentId);
  });

  test('a transaction that changes nothing records nothing, and empty undo/redo return the same state', () => {
    const s = openDocument(forestModel());
    const same = s.model.collections.get('bodies')?.byId.get('body.gate')?.name;
    expect(commit(s, transaction('Rename', [setOp(s.model, 'bodies', 'body.gate', 'name', same)])).outcome).toBe('noop');
    expect(commit(s, { label: 'Resize', ops: [{ op: 'field', member: 'bounds', before: s.model.fields.get('bounds'), after: s.model.fields.get('bounds') }] }).state).toBe(s);
    expect(undo(s)).toBe(s);
    expect(redo(s)).toBe(s);
    expect([canUndo(s), canRedo(s), s.revision]).toEqual([false, false, 0]);
  });

  test('a refused transaction leaves the state untouched', () => {
    const s = openDocument(forestModel());
    const r = commit(s, { label: 'Bad', ops: [{ op: 'set', collection: 'flags', id: 'flag.boss-defeated', member: 'initial', before: true, after: false }] });
    expect(r.outcome).toBe('refused');
    expect(r.state).toBe(s);
  });
});

describe('dirty, saved revision and save conflicts', () => {
  test('undo back to the saved content is clean, and redo away is dirty', () => {
    const s0 = openDocument(forestModel(), { savedDigest: 'disk-0' });
    expect(isDirty(s0)).toBe(false);
    const s1 = recorded(s0, rename(s0, 'A'));
    expect(isDirty(s1)).toBe(true);
    expect(isDirty(undo(s1))).toBe(false);
    expect(isDirty(redo(undo(s1)))).toBe(true);
    expect(isDirty(openDocument(forestModel()))).toBe(true);
  });

  test('a save records its ticket content; edits during the save stay dirty; undo past it is dirty', () => {
    const s1 = recorded(openDocument(forestModel(), { savedDigest: 'disk-0' }), rename(openDocument(forestModel()), 'A'));
    const ticket = beginSave(s1);
    const s2 = recorded(s1, rename(s1, 'B'));
    const saved = completeSave(s2, ticket, 'disk-1');
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect([saved.state.baseDigest, isDirty(saved.state), isDirty(undo(saved.state))]).toEqual(['disk-1', true, false]);
    expect(isDirty(undo(undo(saved.state)))).toBe(true);
  });

  test('a ticket whose base another save replaced is refused without changing the state', () => {
    const s1 = recorded(openDocument(forestModel(), { savedDigest: 'disk-0' }), rename(openDocument(forestModel()), 'A'));
    const early = beginSave(s1);
    const s2 = recorded(s1, rename(s1, 'B'));
    const late = beginSave(s2);
    const first = completeSave(s2, late, 'disk-2');
    if (!first.ok) throw new Error('first save refused');
    const stale = completeSave(first.state, early, 'disk-1');
    expect(stale).toMatchObject({ ok: false, code: 'save.stale-base' });
    expect(stale.state).toBe(first.state);
    expect(completeSave(first.state, { ...late, documentId: 'map.clearing' }, 'x')).toMatchObject({ ok: false, code: 'save.document' });
  });

  test('revert restores saved content with a fresh, clean history', () => {
    const saved = forestModel();
    const s1 = recorded(openDocument(saved, { savedDigest: 'disk-0' }), rename(openDocument(saved), 'A'));
    const r = revert(s1, saved);
    expect([r.past.length, r.future.length, isDirty(r), r.revision, encode(r.model) === encode(saved)]).toEqual([0, 0, false, 2, true]);
    expect(() => revert(openDocument(saved), saved)).toThrow(RangeError);
  });
});

describe('gestures', () => {
  test('a 10,000-cell brush stroke over 100 pointer moves is one entry holding only changed cells', () => {
    const s0 = openDocument(forestModel(), { savedDigest: 'disk-0' });
    const g = beginGesture(s0, 'Brush');
    for (let row = -50; row < 50; row++) expect(g.paint('layer.tiles', rectangle(-50, row, 100, 1, grass)).ok).toBe(true);
    expect(g.chunkCount).toBe(16);
    expect(g.bytes).toBe(16 * CHUNK_CELLS * 4);
    expect(readCell(g.preview().terrain?.byLayer.get('layer.tiles')?.cells as never, -50, -50)).toEqual(grass);
    expect(s0.model.terrain?.byLayer.get('layer.tiles')?.cells.chunks.size).toBe(0);
    const r = g.commit(s0);
    if (r.outcome !== 'recorded') throw new Error(r.outcome);
    const [entry] = r.state.past;
    const op = entry?.tx.ops[0];
    if (op?.op !== 'paint') throw new Error('expected a paint operation');
    expect(r.state.past).toHaveLength(1);
    expect(deltaCells(op.delta)).toBe(10_000);
    expect(op.delta.chunks).toHaveLength(16);
    expect(entry?.bytes).toBeLessThanOrEqual(10_000 * (2 + 4 + 4) + 16 * 32 + 256);
    // The entry holds changed cells only and shares no array with any model: never a snapshot.
    const arrays = op.delta.chunks.flatMap((c) => [c.indices, c.before, c.after]);
    expect(op.delta.chunks.every((c) => c.before.length === c.indices.length && c.after.length === c.indices.length)).toBe(true);
    const stores = [s0, r.state].flatMap((x) => [...(x.model.terrain?.byLayer.get('layer.tiles')?.cells.chunks.values() ?? [])]);
    expect(arrays.some((a) => stores.some((c) => c.buffer === a.buffer))).toBe(false);
    expect(op.delta.chunks.filter((c) => c.indices.length === CHUNK_CELLS)).toHaveLength(4);
    expect(Object.keys(entry ?? {}).sort()).toEqual(['after', 'before', 'bytes', 'label', 'tx']);
    expect(isDirty(undo(r.state))).toBe(false);
    expect(encode(undo(r.state).model)).toBe(encode(s0.model));
    expect(encode(redo(undo(r.state)).model)).toBe(encode(r.state.model));
  });

  test('10,000-cell undo/redo stays within the 100 ms p95 target over five warm runs', () => {
    const s0 = openDocument(forestModel());
    const s1 = recorded(s0, transaction('Brush', [paintOp(s0.model, 'layer.tiles', rectangle(-50, -50, 100, 100, grass))]));
    const times: number[] = [];
    let s = s1;
    for (let run = 0; run < 6; run++) {
      const t = performance.now();
      s = redo(undo(s));
      if (run > 0) times.push(performance.now() - t);
    }
    expect(Math.max(...times)).toBeLessThan(100);
    expect(encode(s.model)).toBe(encode(s1.model));
  });

  test('Escape commits nothing and the base checkpoints recover the exact document', () => {
    const s0 = openDocument(forestModel());
    const before = encode(s0.model);
    const g = beginGesture(s0, 'Drag');
    for (let i = 0; i < 50; i++) g.set('bodies', 'body.gate', 'position', [i, i]);
    g.paint('layer.tiles', rectangle(0, 0, 40, 40, grass));
    expect(g.preview().collections.get('bodies')?.byId.get('body.gate')?.position).toEqual([49, 49]);
    expect(g.cancel(s0)).toBe(s0);
    expect(encode(s0.model)).toBe(before);
    expect(g.paint('layer.tiles', [{ column: 0, row: 0, cell: grass }])).toMatchObject({ ok: false, code: 'gesture.closed' });
    expect(g.commit(s0).outcome).toBe('refused');
  });

  test('fifty drag moves commit once, a gesture back to its start records nothing, and a stale gesture is refused', () => {
    const s0 = openDocument(forestModel());
    const drag = beginGesture(s0, 'Drag');
    for (let i = 1; i <= 50; i++) drag.set('bodies', 'body.gate', 'position', [100 + i, 0]);
    const r = drag.commit(s0);
    expect(r.outcome === 'recorded' && r.state.past.length).toBe(1);
    const back = beginGesture(s0, 'Wiggle');
    const start = s0.model.collections.get('bodies')?.byId.get('body.gate')?.position;
    back.set('bodies', 'body.gate', 'position', [1, 2]);
    back.set('bodies', 'body.gate', 'position', start);
    back.paint('layer.tiles', [{ column: 3, row: 3, cell: grass }, { column: 3, row: 3, cell: null }]);
    expect(back.commit(s0)).toMatchObject({ outcome: 'noop', state: s0 });
    const stale = beginGesture(s0, 'Late');
    stale.set('bodies', 'body.gate', 'name', 'Late');
    expect(r.outcome === 'recorded' && stale.commit(r.state)).toMatchObject({ outcome: 'refused', problem: { code: 'gesture.stale' } });
  });

  test('a gesture holds at most its chunk bound of working copies', () => {
    const g = beginGesture(openDocument(forestModel()), 'Brush', 4);
    expect(g.paint('layer.tiles', rectangle(0, 0, 64, 64, grass)).ok).toBe(true);
    expect(g.paint('layer.tiles', rectangle(64, 0, 1, 1, grass))).toEqual({ ok: false, code: 'gesture.budget', written: 0 });
    expect([g.chunkCount, g.bytes]).toEqual([4, 4 * CHUNK_CELLS * 4]);
    expect(g.paint('layer.world', [])).toMatchObject({ ok: false, code: 'gesture.missing' });
  });
});

describe('memory bound', () => {
  test('history stays within its budget by dropping the oldest entries visibly, never authored content', () => {
    const budget = 400_000;
    let s = openDocument(forestModel(), { budget });
    for (let i = 0; i < 20; i++) {
      const tile = i % 2 ? grass : cell('tile.dirt', (i % 4) as 0 | 1 | 2 | 3);
      s = recorded(s, transaction(`Stroke ${i}`, [paintOp(s.model, 'layer.tiles', rectangle(-50, -50, 100, 100, tile)), fieldOp(s.model, 'bounds', [0, 0, 1280 + i, 800])]));
      expect(s.bytes).toBeLessThanOrEqual(budget);
      expect(s.bytes).toBe(s.past.reduce((n, e) => n + e.bytes, 0));
    }
    expect(s.past.length).toBe(3);
    expect(s.dropped).toBe(17);
    expect(s.notices.length).toBe(17);
    expect(s.notices[0]).toMatchObject({ code: 'history.dropped', entries: 1 });
    expect(readCell(s.model.terrain?.byLayer.get('layer.tiles')?.cells as never, 49, 49)).toEqual(grass);
    expect(s.model.fields.get('bounds')).toEqual([0, 0, 1299, 800]);
    let u = s;
    while (canUndo(u)) u = undo(u);
    expect(u.model.fields.get('bounds')).toEqual([0, 0, 1296, 800]);
  });

  test('an entry larger than the whole budget applies but keeps no undo depth', () => {
    const s0 = openDocument(forestModel(), { budget: 1_000 });
    const s1 = recorded(s0, transaction('Brush', [paintOp(s0.model, 'layer.tiles', rectangle(0, 0, 50, 50, grass))]));
    expect([s1.past.length, s1.bytes, s1.dropped, readCell(s1.model.terrain?.byLayer.get('layer.tiles')?.cells as never, 0, 0)]).toEqual([0, 0, 1, grass]);
  });
});
