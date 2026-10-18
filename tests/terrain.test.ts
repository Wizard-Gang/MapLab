import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { encode } from '../src/domain/model';
import { deltaCells, locate, readCell } from '../src/domain/paint';
import { isDirty, redo, undo } from '../src/editor/history';
import { modelText } from '../src/editor/document';
import { FillJob, GESTURE_CELL_LIMIT, boundsCells, gridOf, type CellXY } from '../src/editor/terrain';
import { root } from './history-support';
import { Harness, LAYER, fixture, forest, graphErrors, plain } from './terrain-support';

const store = (h: Harness) => h.state.model.terrain!.byLayer.get(LAYER)!.cells;
const sortChunks = (cs: readonly (readonly number[])[]) => [...cs].map((c) => [...c]).sort((a, b) => a[1]! - b[1]! || a[0]! - b[0]!);

test('owned terrain fixture and its unchanged R1 base are pinned by SHA-256', () => {
  const index = JSON.parse(readFileSync(join(root, 'conformance/terrain/index.json'), 'utf8'));
  expect(createHash('sha256').update(readFileSync(join(root, 'conformance/terrain/cases.json'))).digest('hex')).toBe(index.files[0].sha256);
  expect(createHash('sha256').update(readFileSync(join(root, fixture.base.path))).digest('hex')).toBe(fixture.base.sha256);
  expect(fixture.gestureCellLimit).toBe(GESTURE_CELL_LIMIT);
  expect(graphErrors(forest())).toEqual([]);
});

describe('negative chunk indices', () => {
  for (const c of fixture.negativeChunks) test(`${c.id}: one entry, floor-divided chunks, exact cells, valid saved form, lossless undo`, () => {
    const base = forest(c.bounds), h = new Harness(base);
    expect(h.gesture(c.tool, c.tile, c.path)).toBe(true);
    expect(h.state.past).toHaveLength(1);
    const delta = h.lastDelta();
    expect(deltaCells(delta)).toBe(c.expect.cells);
    expect(sortChunks(delta.chunks.map((k) => [k.column, k.row]))).toEqual(c.expect.chunks);
    for (const [col, row, tile] of c.expect.probes) expect(readCell(store(h), col, row)?.tileId ?? null, `${col},${row}`).toBe(tile);
    for (const [col, row, cc, cr, index] of c.expect.index ?? []) expect(locate(col, row)).toEqual({ column: cc, row: cr, index });
    // Library form writes chunks by row then column, so negative chunks save in one deterministic order.
    const saved = JSON.parse(modelText(h.state.model)).terrain[0].chunks.map((k: { column: number; row: number }) => [k.column, k.row]);
    expect(saved).toEqual(c.expect.chunks);
    expect(graphErrors(h.state.model)).toEqual([]);
    expect(encode(undo(h.state).model)).toBe(encode(base));
    expect(encode(redo(undo(h.state)).model)).toBe(encode(h.state.model));
  });
});

describe('bounded fill over a snapshot', () => {
  for (const c of fixture.fills) test(`${c.id}: ${c.expect.status}, ${c.expect.outcome}`, () => {
    const h = new Harness(forest());
    for (const s of c.setup ?? []) h.gesture(s.tool, s.tile, s.path);
    const before = h.state, g = gridOf(h.state.model.terrain!.byLayer.get(LAYER)!);
    const job = new FillJob(store(h), c.at, boundsCells(g, h.state.model.fields.get('bounds') as never), c.limit ?? GESTURE_CELL_LIMIT);
    expect(job.step()).toBe(c.expect.status);
    if (c.expect.cells !== undefined) expect(job.cells.size).toBe(c.expect.cells);
    if (c.sessionBounds) {
      // Past the real limit the session refuses the whole region rather than truncating it.
      const big = new Harness(forest(c.sessionBounds));
      big.gesture('fill', c.tile, [c.at]);
      expect([big.state.past.length, big.session.getSnapshot().message]).toEqual([0, `Fill refused: the region exceeds ${GESTURE_CELL_LIMIT.toLocaleString('en-US')} cells`]);
      return;
    }
    h.gesture('fill', c.tile, [c.at]);
    const recorded = h.state.past.length - before.past.length;
    expect(recorded).toBe(c.expect.outcome === 'recorded' ? 1 : 0);
    if (c.expect.outcome === 'recorded') {
      expect(deltaCells(h.lastDelta())).toBe(c.expect.cells);
      expect(readCell(store(h), c.at[0], c.at[1])?.tileId).toBe(c.tile);
      // The dirt line bounds the region: it never changes.
      for (let col = 0; col < 40; col++) expect(readCell(store(h), col, 10)?.tileId).toBe('tile.dirt');
    } else expect(h.state).toBe(before);
  });
});

describe('cancellation and stale gestures', () => {
  for (const tool of fixture.cancel.tools) test(`${tool}: cancel and a stale release leave source and history untouched`, () => {
    const h = new Harness(forest()), start = h.state, path: CellXY[] = tool === 'fill' ? [fixture.cancel.path[0]] : fixture.cancel.path;
    for (let i = 0; i < 3; i++) {
      h.gesture(tool, tool === 'erase' ? null : 'tile.grass', path, false);
      expect(h.session.getSnapshot().preview?.count).toBeGreaterThan(0);
      expect(h.session.cancel()).toBe(true);
      h.session.end();
      expect(h.session.getSnapshot().preview).toBeNull();
      expect(h.state).toBe(start);
    }
    h.gesture(tool, tool === 'erase' ? null : 'tile.grass', path, false);
    h.state = { ...h.state, model: forest() };
    h.session.end();
    expect([h.state.past.length, h.session.getSnapshot().message]).toEqual([0, 'Document changed; gesture cancelled']);
  });

  test('a sliced fill cancels mid-run without writing, and a late slice does nothing', () => {
    const s = fixture.cancel.fillSlices, h = new Harness(forest()), g = gridOf(h.state.model.terrain!.byLayer.get(LAYER)!);
    const job = new FillJob(store(h), s.at, boundsCells(g, h.state.model.fields.get('bounds') as never));
    for (let i = 0; i < s.cancelAfter; i++) expect(job.step(s.slice)).toBe('running');
    job.cancel();
    expect([job.status, job.cells.size, job.step()]).toEqual(['cancelled', s.slice * s.cancelAfter, 'cancelled']);
    const big = new Harness(forest([0, 0, 9600, 9600]), { deferred: true }), start = big.state;
    big.gesture('fill', 'tile.grass', [s.at], false);
    expect(big.session.getSnapshot().message).toMatch(/^Filling… 8192 cells/);
    expect(big.session.cancel()).toBe(true);
    for (const run of big.queued) run();
    big.session.end();
    expect([big.state, big.session.getSnapshot().preview]).toEqual([start, null]);
  });
});

describe('10,000-cell history budget', () => {
  const { gesture, expect: want, budget } = fixture.history;
  test('one rectangle gesture is one compact entry and undo/redo meets the p95 target', () => {
    const base = forest(), h = new Harness(base);
    h.gesture(gesture.tool, gesture.tile, gesture.path);
    expect(h.state.past).toHaveLength(want.entries);
    const delta = h.lastDelta();
    expect([deltaCells(delta), delta.chunks.length]).toEqual([want.deltaCells, want.deltaChunks]);
    expect(h.state.past[0]!.bytes).toBeLessThanOrEqual(want.entryBytesAtMost);
    const times: number[] = [];
    let s = h.state;
    for (let run = 0; run <= want.warmRuns; run++) { const t = performance.now(); s = redo(undo(s)); if (run > 0) times.push(performance.now() - t); }
    expect(Math.max(...times)).toBeLessThan(want.undoRedoP95Ms);
    expect(encode(undo(s).model)).toBe(encode(base));
    expect(isDirty(undo(s))).toBe(false);
  });

  test('over budget the oldest entries drop visibly while every painted cell stays authored', () => {
    const h = new Harness(forest(), { budget: budget.bytes });
    for (let k = 0; k < budget.gestures; k++) {
      const [[c0, r0], [c1, r1]] = gesture.path as [CellXY, CellXY];
      h.gesture(gesture.tool, gesture.tile, [[c0 + k * budget.columnStep, r0], [c1 + k * budget.columnStep, r1]]);
      expect(h.state.bytes).toBeLessThanOrEqual(budget.bytes);
    }
    expect([h.state.past.length, h.state.dropped]).toEqual([budget.expect.entries, budget.expect.dropped]);
    expect(h.state.notices.at(-1)?.code).toBe('history.dropped');
    let painted = 0;
    for (const chunk of store(h).chunks.values()) for (const v of chunk) if (v) painted++;
    expect(painted).toBe(budget.expect.paintedCells);
    expect(readCell(store(h), -50, -50)).toEqual(plain('tile.grass'));
  });
});
