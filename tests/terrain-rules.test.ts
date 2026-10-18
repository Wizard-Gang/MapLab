import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { validateTileset, type Cell } from '../src/contracts';
import { encode, type MapModel } from '../src/domain/model';
import { unpack } from '../src/domain/paint';
import { redo, undo } from '../src/editor/history';
import { modelText } from '../src/editor/document';
import { variationHash } from '../src/editor/terrain-rules';
import { root } from './history-support';
import { Harness, LAYER, graphErrors, rulesForest, rulesTileset } from './terrain-support';

const fixture = JSON.parse(readFileSync(join(root, 'conformance/terrain-rules/cases.json'), 'utf8'));
type Rect = [[number, number], [number, number]];
interface Step { readonly do: 'terrain' | 'tiles' | 'turn' | 'reseed'; readonly rect?: Rect; readonly terrainId?: string | null; readonly tile?: string; readonly turn?: 'rotate' | 'mirrorX' | 'mirrorY'; readonly seed?: number;
  readonly expect: { readonly outcome: 'recorded' | 'refused' | 'noop'; readonly cells: number; readonly intent: number; readonly sha256: string; readonly lines: string } }

/** Every stored cell as `column,row=tileId/quarterTurns/mirrorX/mirrorY` lines in row-then-column order. */
export function lines(m: MapModel): string {
  const store = m.terrain!.byLayer.get(LAYER)!.cells, out: [number, number, Cell][] = [];
  for (const [key, cells] of store.chunks) {
    const [cc, cr] = key.split(',').map(Number) as [number, number];
    cells.forEach((v, i) => { if (v) out.push([cc * 32 + (i % 32), cr * 32 + Math.floor(i / 32), unpack(store.tiles.ids, v)!]); });
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([c, r, x]) => `${c},${r}=${x.tileId}/${x.quarterTurns}/${Number(x.mirrorX)}/${Number(x.mirrorY)}\n`).join('');
}
const intentCount = (m: MapModel): number => { let n = 0; for (const c of m.terrain!.byLayer.get(LAYER)!.intent.chunks.values()) for (const v of c) if (v) n++; return n; };

/** Drives one fixture step exactly as the viewport would: a rectangle gesture, or the seed field. */
export function apply(h: Harness, s: Step): void {
  const t = h.session;
  if (s.do === 'reseed') { t.reseed(s.seed!); return; }
  if (s.do === 'turn') { t.tool('transform'); t.turnKind(s.turn!); }
  else if (s.do === 'terrain') { t.mode('terrain'); if (s.terrainId) { t.tool('rect'); t.chooseTerrain(s.terrainId); } else t.tool('erase'); }
  else { t.mode('tiles'); t.tool('rect'); t.choose({ tileId: s.tile!, quarterTurns: 0, mirrorX: false, mirrorY: false }); }
  const [a, b] = s.rect!;
  // Erase is a brush: walk the rectangle's rows so it covers exactly the same cells.
  const path: [number, number][] = s.do === 'terrain' && !s.terrainId ? [] : [a, b];
  if (!path.length) for (let r = Math.min(a[1], b[1]); r <= Math.max(a[1], b[1]); r++) path.push([Math.min(a[0], b[0]), r], [Math.max(a[0], b[0]), r]);
  expect(h.gesture(t.getSnapshot().tool, null, path)).toBe(true);
}

test('owned rule fixture, tileset and FNV-1a 64 vectors are pinned', () => {
  const index = JSON.parse(readFileSync(join(root, 'conformance/terrain-rules/index.json'), 'utf8'));
  for (const f of index.files) expect(createHash('sha256').update(readFileSync(join(root, 'conformance/terrain-rules', f.path))).digest('hex'), f.path).toBe(f.sha256);
  expect(validateTileset(rulesTileset as never).ok).toBe(true);
  for (const [seed, layer, c, r, rule, hex] of fixture.hashVectors) expect(variationHash(seed, layer, c, r, rule).toString(16).padStart(16, '0')).toBe(hex);
  expect(graphErrors(rulesForest())).toEqual([]);
});

describe('rules version 1 golden resolution', () => {
  for (const c of fixture.cases) test(`${c.id}: every step matches the independent golden bytes and undoes in one step`, () => {
    const h = new Harness(rulesForest());
    for (const [i, s] of (c.steps as Step[]).entries()) {
      const before = h.state;
      apply(h, s);
      const where = `${c.id} step ${i}`;
      expect(h.state.past.length - before.past.length, `${where} ${h.session.getSnapshot().message}`).toBe(s.expect.outcome === 'recorded' ? 1 : 0);
      if (s.expect.outcome !== 'recorded') expect(h.state, where).toBe(before);
      const text = lines(h.state.model);
      expect(text, where).toBe(s.expect.lines);
      expect(createHash('sha256').update(text).digest('hex')).toBe(s.expect.sha256);
      expect([intentCount(h.state.model), text.split('\n').length - 1]).toEqual([s.expect.intent, s.expect.cells]);
      if (s.expect.outcome === 'recorded') {
        // One undo restores both intent and every re-resolved neighbor; redo returns exactly.
        expect(encode(undo(h.state).model), where).toBe(encode(before.model));
        expect(encode(redo(undo(h.state)).model), where).toBe(encode(h.state.model));
        if (s.do !== 'reseed') expect(h.state.past.at(-1)!.tx.ops.every((op) => op.op === 'intent' || op.op === 'paint'), where).toBe(true);
      }
    }
    expect(graphErrors(h.state.model)).toEqual([]);
  });
});

describe('determinism, neighbors and permissions', () => {
  const steps = (id: string): Step[] => fixture.cases.find((x: { id: string }) => x.id === id).steps;
  test('the same seed and input build byte-identical library form; another seed differs, and reseeding back restores it', () => {
    const build = () => { const h = new Harness(rulesForest()); apply(h, steps('variation-seed')[0]!); return h; };
    const a = build(), b = build();
    expect(modelText(a.state.model)).toBe(modelText(b.state.model));
    a.session.reseed(8);
    expect(lines(a.state.model)).not.toBe(lines(b.state.model));
    expect(a.state.past.at(-1)!.tx.ops.map((op) => op.op)).toEqual(['set', 'paint']);
    a.session.reseed(7);
    expect(lines(a.state.model)).toBe(lines(b.state.model));
    expect(a.state.model.terrain!.byLayer.get(LAYER)!.settings.variationSeed).toBe(7);
  });

  test('a single intent cell updates its neighbors in one intent+paint transaction', () => {
    const h = new Harness(rulesForest()), [block, above] = steps('neighbor-update');
    apply(h, block!); const before = h.state;
    apply(h, above!);
    const tx = h.state.past.at(-1)!.tx;
    expect(tx.ops.map((op) => op.op)).toEqual(['intent', 'paint']);
    const paint = tx.ops[1]!;
    if (paint.op !== 'paint') throw new Error('paint');
    // The new cell and the former grass top-middle neighbor both change in this one entry.
    expect(paint.delta.chunks.reduce((n, k) => n + k.indices.length, 0)).toBe(2);
    expect(lines(undo(h.state).model)).toBe(lines(before.model));
  });

  test('an illegal 90-degree turn is refused whole with the tileset\'s reason, recording nothing', () => {
    const h = new Harness(rulesForest()), s = steps('illegal-turn');
    apply(h, s[0]!); apply(h, s[1]!);
    const before = h.state;
    apply(h, s[2]!);
    expect(h.state).toBe(before);
    expect(h.session.getSnapshot().message).toBe('Cell 30,5: tile.corner does not allow 1 quarter turn(s); nothing was turned');
  });
});
