import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Cell, JsonValue } from '../src/contracts';
import { denormalize, encode, type MapModel } from '../src/domain/model';
import { readCell, storeToChunks } from '../src/domain/paint';
import { applyTransaction } from '../src/domain/transaction';
import { redo, undo } from '../src/editor/history';
import { TERRAIN_TOOLS, cellProblem, lineCells, palette, paintCells, type CellXY, type TerrainTool } from '../src/editor/terrain';
import { buildScene } from '../src/render/scene';
import { prng, root } from './history-support';
import { Harness, LAYER, fixture, forest, graphErrors, plain, tileset } from './terrain-support';
// @ts-expect-error Independent fixture materializer is JavaScript.
import { materialize } from './consumer/mutate.mjs';

const without = (m: MapModel) => { const d = denormalize(m); return JSON.stringify({ ...d, terrain: null }); };

describe('terrain edits are art only', () => {
  for (const tool of fixture.artOnly.tools as TerrainTool[]) test(`${tool}: one paint operation; collision, footholds and every other record are identical`, () => {
    const h = new Harness(forest());
    if (tool === 'erase') h.gesture('rect', 'tile.dirt', fixture.artOnly.path);
    const before = h.state.model;
    h.gesture(tool, tool === 'erase' ? null : 'tile.grass', tool === 'fill' ? [fixture.artOnly.path[0]] : fixture.artOnly.path);
    const after = h.state.model;
    expect(after).not.toBe(before);
    expect(h.state.past.at(-1)!.tx.ops.map((op) => op.op)).toEqual(['paint']);
    for (const [name, c] of before.collections) for (const id of c.order) expect(after.collections.get(name)!.byId.get(id), `${name}/${id}`).toBe(c.byId.get(id));
    for (const [member, v] of before.fields) expect(after.fields.get(member)).toBe(v);
    expect([after.owners, after.groups]).toEqual([before.owners, before.groups]);
    expect(without(after)).toBe(without(before));
    // Physical overlays are built from bodies and footholds alone, so they draw exactly as before.
    const a = buildScene(before, new Map([[tileset.id, tileset]])), b = buildScene(after, new Map([[tileset.id, tileset]]));
    for (const pass of ['Collision', 'Footholds', 'Traversal', 'Navigation'] as const) expect(b.passes.get(pass)).toEqual(a.passes.get(pass));
    expect(b.art.find((l) => l.layer.id === LAYER)?.terrain?.cells).toBe(after.terrain!.byLayer.get(LAYER)!.cells);
  });
});

describe('palette permissions', () => {
  test('the palette offers exactly the tileset\'s tiles and permitted transforms', () => {
    expect(palette(tileset).map((t) => [t.id, t.quarterTurns, t.mirrorX, t.mirrorY])).toEqual(tileset.tiles.map((t) => [t.id, t.allowedQuarterTurns, t.allowMirrorX, t.allowMirrorY]));
  });
  for (const f of fixture.forbidden) test(`${f.cell.tileId} ${JSON.stringify(f.cell)} is refused before and at the command boundary`, () => {
    expect(cellProblem(tileset, f.cell)).toContain(f.message);
    const h = new Harness(forest());
    h.session.choose(f.cell);
    expect([h.session.getSnapshot().tile, h.session.getSnapshot().message]).toEqual([null, cellProblem(tileset, f.cell)]);
    expect(h.gesture('brush', null, [[1, 1]])).toBe(false);
    // Bypassing the palette still fails closed under full source-graph validation.
    const forced = applyTransaction(h.state.model, paintCells(h.state.model, LAYER, [[1, 1]], f.cell, 'forced'));
    if (!forced.ok) throw new Error(forced.problem.message);
    expect(graphErrors(forced.model).join('\n')).toMatch(/Tile transform is forbidden|Unknown tileset tile/);
  });
});

describe('brush and replay properties', () => {
  const { seed, gestures, span, tiles } = fixture.replay;
  test(`seed ${seed}: ${gestures} random gestures match a reference grid, replay byte-identically and undo to the base`, () => {
    const random = prng(seed), int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1)), base = forest([span[0] * 32, span[0] * 32, (span[1] - span[0]) * 32, (span[1] - span[0]) * 32]);
    const h = new Harness(base), reference = new Map<string, Cell | null>(), at = (c: number, r: number) => reference.get(`${c},${r}`) ?? null;
    const choices = palette(tileset).filter((t) => tiles.includes(t.id));
    let recorded = 0;
    for (let i = 0; i < gestures; i++) {
      const tool = TERRAIN_TOOLS[int(0, TERRAIN_TOOLS.length - 1)]!, p = choices[int(0, choices.length - 1)]!;
      const value: Cell | null = tool === 'erase' ? null : { tileId: p.id, quarterTurns: p.quarterTurns[int(0, p.quarterTurns.length - 1)]!, mirrorX: p.mirrorX && random() < 0.5, mirrorY: p.mirrorY && random() < 0.5 };
      const path: CellXY[] = Array.from({ length: tool === 'fill' ? 1 : int(2, 5) }, () => [int(span[0], span[1] - 1), int(span[0], span[1] - 1)]);
      // Reference: an independent cell map with the tool's documented cell set.
      const cells: CellXY[] = [];
      if (tool === 'brush' || tool === 'erase') path.slice(1).forEach((q, k) => cells.push(...lineCells(path[k]!, q)));
      else if (tool === 'line') cells.push(...lineCells(path[0]!, path.at(-1)!));
      else if (tool === 'rect') { const [a, b] = [path[0]!, path.at(-1)!]; for (let r = Math.min(a[1], b[1]); r <= Math.max(a[1], b[1]); r++) for (let c = Math.min(a[0], b[0]); c <= Math.max(a[0], b[0]); c++) cells.push([c, r]); }
      else {
        const target = JSON.stringify(at(...path[0]!)), queue = [path[0]!], seen = new Set([`${path[0]![0]},${path[0]![1]}`]);
        while (queue.length) {
          const [c, r] = queue.shift()!; cells.push([c, r]);
          for (const [x, y] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]] as CellXY[]) if (x >= span[0] && x < span[1] && y >= span[0] && y < span[1] && !seen.has(`${x},${y}`) && JSON.stringify(at(x, y)) === target) { seen.add(`${x},${y}`); queue.push([x, y]); }
        }
      }
      const changes = cells.some(([c, r]) => JSON.stringify(at(c, r)) !== JSON.stringify(value));
      for (const [c, r] of cells) reference.set(`${c},${r}`, value);
      const entries = h.state.past.length;
      h.gesture(tool, value, path);
      expect(h.state.past.length - entries, `gesture ${i} ${tool}`).toBe(changes ? 1 : 0);
      if (changes) recorded++;
    }
    const layer = h.state.model.terrain!.byLayer.get(LAYER)!.cells;
    const mismatches: string[] = [];
    for (let r = span[0]; r < span[1]; r++) for (let c = span[0]; c < span[1]; c++) if (JSON.stringify(readCell(layer, c, r)) !== JSON.stringify(at(c, r))) mismatches.push(`${c},${r}`);
    expect(mismatches).toEqual([]);
    expect(storeToChunks(layer).every((k) => k.cells.some((x) => x !== null))).toBe(true);
    // Replaying the recorded transactions on the base reproduces the exact document.
    let replayed = base;
    for (const e of h.state.past) { const r = applyTransaction(replayed, e.tx); if (!r.ok) throw new Error(r.problem.message); replayed = r.model; }
    expect([h.state.past.length, encode(replayed)]).toEqual([recorded, encode(h.state.model)]);
    let s = h.state;
    while (s.past.length) s = undo(s);
    expect(encode(s.model)).toBe(encode(base));
    while (s.future.length) s = redo(s);
    expect(encode(s.model)).toBe(encode(h.state.model));
    expect(graphErrors(h.state.model)).toEqual([]);
  }, 30_000);

  test('a brush stroke is gap-free: exactly the segment cells between samples, one 8-connected region', () => {
    const h = new Harness(forest()), samples: CellXY[] = [[0, 0], [30, 7], [-5, 20], [12, -9]];
    h.gesture('brush', 'tile.grass', samples, false);
    const p = h.session.getSnapshot().preview!.cells, union = new Set<string>();
    samples.slice(1).forEach((q, k) => { for (const [c, r] of lineCells(samples[k]!, q)) union.add(`${c},${r}`); });
    expect(p.size).toBe(union.size);
    for (const [c, r] of p.cells()) expect(union.has(`${c},${r}`)).toBe(true);
    const reached = new Set(['0,0']), queue: CellXY[] = [[0, 0]];
    while (queue.length) {
      const [c, r] = queue.pop()!;
      for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) { const k = `${c + dc},${r + dr}`; if (union.has(k) && !reached.has(k)) { reached.add(k); queue.push([c + dc, r + dr]); } }
    }
    expect(reached.size).toBe(union.size);
  });
});

test('independent isolated consumer reads final negative-chunk terrain bytes and rejects an unknown tile', () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maplab-terrain-consumer-')));
  try {
    cpSync(join(root, 'tests/consumer/reader'), join(scratch, 'reader'), { recursive: true }); cpSync(join(root, 'schemas'), join(scratch, 'schemas'), { recursive: true });
    const index = JSON.parse(readFileSync(join(root, 'conformance/bundle/cases.json'), 'utf8')), golden = join(root, index.golden.export.path);
    const h = new Harness(forest());
    for (const c of fixture.negativeChunks.filter((x: { bounds?: unknown }) => !x.bounds)) h.gesture(c.tool, c.tile, c.path);
    // Export form sorts chunk lists by row then column (adopted F5).
    const terrain = (denormalize(h.state.model).terrain as { chunks: { row: number; column: number }[] }[]).map((t) => ({ ...t, chunks: [...t.chunks].sort((a, b) => a.row - b.row || a.column - b.column) }));
    const run = (mutations: unknown[]) => {
      materialize(golden, join(scratch, 'bundle'), { id: 'ML-013-terrain', edits: mutations }, join(scratch, 'schemas'));
      return spawnSync(process.execPath, [join(scratch, 'reader/read-bundle.mjs'), '--schemas', join(scratch, 'schemas'), join(scratch, 'bundle')], { cwd: scratch, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
    };
    const edit = { file: 'maps/forest.map.json', set: '/terrain', value: terrain as unknown as JsonValue };
    const good = run([edit]);
    expect(good.stderr).toBe(''); expect(good.status, good.stdout).toBe(0);
    const negative = terrain[0]!.chunks.findIndex((k) => k.row < 0 && k.column < 0);
    expect(negative).toBeGreaterThanOrEqual(0);
    const cellIndex = (terrain[0]!.chunks[negative] as unknown as { cells: (Cell | null)[] }).cells.findIndex((x) => x !== null);
    const bad = run([edit, { file: 'maps/forest.map.json', set: `/terrain/0/chunks/${negative}/cells/${cellIndex}/tileId`, value: 'tile.missing' }]);
    expect(bad.status).toBe(1);
    expect(JSON.parse(bad.stdout).diagnostics.some((d: { message: string }) => d.message.includes('tile.missing'))).toBe(true);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
