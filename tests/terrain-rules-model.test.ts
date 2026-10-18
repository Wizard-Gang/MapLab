import { describe, expect, test } from 'vitest';
import type { JsonValue } from '../src/contracts';
import { denormalize, encode, normalize } from '../src/domain/model';
import { intentCell, paintDelta, unpack } from '../src/domain/paint';
import { applyTransaction } from '../src/domain/transaction';
import { terrainOp, transaction } from '../src/domain/commands';
import { libraryForm } from '../src/library/library-form';
import { redo, undo } from '../src/editor/history';
import { TURNS, resolveCell, ruleBook } from '../src/editor/terrain-rules';
import { forestDocument, prng } from './history-support';
import { Harness, LAYER, graphErrors, rulesForest, rulesTileset } from './terrain-support';

const withIntent = (entries: JsonValue[]): JsonValue => {
  const doc = forestDocument() as Record<string, JsonValue> & { terrain: Record<string, JsonValue>[] };
  return { ...doc, terrain: doc.terrain.map((t) => ({ ...t, terrainIntent: entries })) };
};

describe('terrain intent in the normalized model', () => {
  test('intent normalizes into a packed store and serializes row then column, in the model and in library form', () => {
    const source = withIntent([{ column: 3, row: 1, terrainId: 'terrain.forest' }, { column: -40, row: -2, terrainId: 'terrain.forest' }, { column: -1, row: 1, terrainId: 'terrain.forest' }]);
    const n = normalize(source);
    if (!n.ok) throw new Error(JSON.stringify(n.problems));
    const out = (denormalize(n.model).terrain as { terrainIntent: { column: number; row: number }[] }[])[0]!.terrainIntent;
    expect(out.map((e) => [e.column, e.row])).toEqual([[-40, -2], [-1, 1], [3, 1]]);
    expect(JSON.parse(libraryForm(source)).terrain[0].terrainIntent.map((e: { column: number; row: number }) => [e.column, e.row])).toEqual([[-40, -2], [-1, 1], [3, 1]]);
    expect(n.model.terrain!.byLayer.get(LAYER)!.settings).not.toHaveProperty('terrainIntent');
    const again = normalize(denormalize(n.model) as JsonValue);
    expect(again.ok && encode(again.model)).toBe(encode(n.model));
  });

  test('repeated or malformed intent cells are refused, never silently merged', () => {
    for (const entries of [[{ column: 0, row: 0, terrainId: 'a' }, { column: 0, row: 0, terrainId: 'b' }], [{ column: 0.5, row: 0, terrainId: 'a' }], [{ column: 0, row: 0 }]]) {
      const n = normalize(withIntent(entries as JsonValue[]));
      expect(n.ok ? [] : n.problems.map((p) => p.code)).toEqual(['model.intent']);
    }
  });

  test('intent changes only through its compact delta: set is refused, and transform bits are malformed', () => {
    const m = rulesForest(), layer = m.terrain!.byLayer.get(LAYER)!;
    expect(applyTransaction(m, transaction('x', [{ op: 'set', collection: 'terrain', id: LAYER, member: 'terrainIntent', before: undefined, after: [] }]))).toMatchObject({ ok: false, problem: { code: 'transaction.member' } });
    const turned = paintDelta(layer.intent, [{ column: 0, row: 0, cell: { ...intentCell('terrain.forest'), quarterTurns: 1 } }])!;
    expect(applyTransaction(m, transaction('x', [{ op: 'intent', layerId: LAYER, delta: turned }]))).toMatchObject({ ok: false, problem: { code: 'paint.malformed' } });
    expect(terrainOp(m, LAYER, 'variationSeed', 7)).toBeNull();
  });
});

describe('every intent cell always stores its resolved tile', () => {
  test('seed 1401: random terrain, literal, erase and turn edits keep the invariant, replay exactly and undo to the base', () => {
    const random = prng(1401), int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1)), base = rulesForest(), h = new Harness(base);
    const terrains = rulesTileset.terrains.map((t) => t.id), tiles = rulesTileset.tiles.map((t) => t.id);
    for (let i = 0; i < 80; i++) {
      const a: [number, number] = [int(-6, 6), int(-6, 6)], b: [number, number] = [a[0] + int(-3, 3), a[1] + int(-3, 3)], kind = int(0, 9);
      const t = h.session;
      if (kind < 5) { t.mode('terrain'); t.tool('rect'); t.chooseTerrain(terrains[int(0, terrains.length - 1)]!); }
      else if (kind < 7) { t.mode('tiles'); t.tool('rect'); t.choose({ tileId: tiles[int(0, tiles.length - 1)]!, quarterTurns: 0, mirrorX: false, mirrorY: false }); }
      else if (kind < 8) { t.mode('terrain'); t.tool('erase'); }
      else { t.tool('transform'); t.turnKind(TURNS[int(0, 2)]!); }
      h.gesture(t.getSnapshot().tool, null, [a, b]);
      if (i % 20 === 19) h.session.reseed(int(0, 1000));
      const layer = h.state.model.terrain!.byLayer.get(LAYER)!, book = ruleBook(rulesTileset), seed = layer.settings.variationSeed as number;
      for (const [key, cells] of layer.intent.chunks) {
        const [cc, cr] = key.split(',').map(Number) as [number, number];
        cells.forEach((v, k) => {
          if (!v) return;
          const c = cc * 32 + (k % 32), r = cr * 32 + Math.floor(k / 32);
          const stored = unpack(layer.cells.tiles.ids, layer.cells.chunks.get(`${Math.floor(c / 32)},${Math.floor(r / 32)}`)?.[k] ?? 0);
          expect(stored, `edit ${i} cell ${c},${r}`).toEqual(resolveCell(book, layer.intent, seed, LAYER, c, r));
        });
      }
    }
    let replayed = base;
    for (const e of h.state.past) { const r = applyTransaction(replayed, e.tx); if (!r.ok) throw new Error(r.problem.message); replayed = r.model; }
    expect(encode(replayed)).toBe(encode(h.state.model));
    let s = h.state;
    while (s.past.length) s = undo(s);
    expect(encode(s.model)).toBe(encode(base));
    while (s.future.length) s = redo(s);
    expect(encode(s.model)).toBe(encode(h.state.model));
    expect(graphErrors(h.state.model)).toEqual([]);
  }, 30_000);
});
