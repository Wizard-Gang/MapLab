// ML-008: stable persistent-ID remapping for paste, and reference rewrites inside one atomic transaction.
import { describe, expect, test } from 'vitest';
import { deleteOp, transaction } from '../src/domain/commands';
import { encode, normalize, denormalize, type JsonObject, type MapModel } from '../src/domain/model';
import { allocateId, planPaste, pasteTransaction, retargetOps, rewriteRefs, type PasteItem } from '../src/domain/remap';
import { applyTransaction, invertTransaction, type Transaction } from '../src/domain/transaction';
import { forestModel } from './history-support';

const apply = (m: MapModel, tx: Transaction): MapModel => { const r = applyTransaction(m, tx); if (!r.ok) throw new Error(JSON.stringify(r.problem)); return r.model; };
const rec = (m: MapModel, c: string, id: string) => m.collections.get(c as never)?.byId.get(id) as JsonObject;

describe('allocateId', () => {
  test('takes the smallest free -N suffix from the unsuffixed base, within 96 characters', () => {
    const taken = new Set(['body.gate', 'body.gate-2']);
    expect(allocateId('body.gate', (c) => taken.has(c))).toBe('body.gate-3');
    expect(allocateId('body.gate-2', (c) => taken.has(c))).toBe('body.gate-3');
    const long = `a${'b'.repeat(95)}`;
    const next = allocateId(long, () => false);
    expect(next).toHaveLength(96);
    expect(next.endsWith('-2')).toBe(true);
  });
});

describe('planPaste', () => {
  const m = forestModel();
  const items: PasteItem[] = [
    { collection: 'bodies', record: rec(m, 'bodies', 'body.west') },
    { collection: 'footholds', record: rec(m, 'footholds', 'fh.west') },
    { collection: 'triggers', record: rec(m, 'triggers', 'trigger.boss-enter') },
  ];

  test('gives every pasted record and nested object a new ID and rewrites internal references only', () => {
    const plan = planPaste(m, items);
    expect([...plan.mapping]).toEqual([['body.west', 'body.west-2'], ['shape.west', 'shape.west-2'], ['fh.west', 'fh.west-2'], ['trigger.boss-enter', 'trigger.boss-enter-2']]);
    const [body, foothold, trigger] = plan.items.map((i) => i.record) as [JsonObject, any, any];
    expect((body.shapes as JsonObject[])[0]?.id).toBe('shape.west-2');
    expect(foothold.ownerBodyId).toBe('body.west-2');
    expect(foothold.solidEdge).toEqual({ bodyId: 'body.west-2', shapeId: 'shape.west-2', edgeIndex: 0 });
    expect(foothold.materialId).toBe('material.earth');
    expect(trigger.regionId).toBe('region.boss-enter');
    expect(trigger.actions[1].params.target.ref).toEqual({ kind: 'body', id: 'body.gate' });
    expect(plan.unresolved).toEqual([]);
  });

  test('is deterministic and never mutates the clipboard records', () => {
    const before = JSON.stringify(items);
    expect(JSON.stringify(planPaste(m, items))).toBe(JSON.stringify(planPaste(m, items)));
    expect(JSON.stringify(items)).toBe(before);
  });

  test('reports references that resolve in neither the clipboard nor the target map, and keeps them', () => {
    const stray = { ...rec(m, 'footholds', 'fh.east'), materialId: 'material.lava' };
    const plan = planPaste(m, [{ collection: 'footholds', record: stray }]);
    expect(plan.unresolved).toEqual([{ item: 0, path: '$.materialId', id: 'material.lava' }]);
    expect((plan.items[0]?.record as JsonObject).materialId).toBe('material.lava');
  });

  test('pasting twice never duplicates an ID, and one transaction undoes the whole paste', () => {
    const once = apply(m, pasteTransaction(m, planPaste(m, items)));
    const plan = planPaste(once, items);
    expect(plan.mapping.get('body.west')).toBe('body.west-3');
    const tx = pasteTransaction(once, plan);
    expect(tx.ops.map((op) => op.op)).toEqual(['insert', 'insert', 'insert']);
    const twice = apply(once, tx);
    expect(normalize(denormalize(twice)).ok).toBe(true);
    expect(encode(apply(twice, invertTransaction(tx)))).toBe(encode(once));
  });

  test('a self-portal is remapped but a link to another map keeps its identity', () => {
    const portal = rec(m, 'entities', 'portal.clearing') as any;
    const self = { ...portal, id: 'portal.loop', destination: { mapId: 'map.forest', entityId: 'portal.loop' } };
    const plan = planPaste(m, [{ collection: 'entities', record: self }, { collection: 'entities', record: portal }]);
    const [a, b] = plan.items.map((i) => i.record) as any[];
    expect(a.destination).toEqual({ mapId: 'map.forest', entityId: 'portal.loop-2' });
    expect(b.destination).toEqual(portal.destination);
  });
});

describe('reference rewrites', () => {
  const m = forestModel();
  test('rewriteRefs leaves unchanged subtrees identical and skips other maps', () => {
    const value = { regionId: 'region.pit', destination: { mapId: 'map.clearing', entityId: 'region.pit' }, nested: [{ ref: { kind: 'region', id: 'region.pit' } }] };
    const out = rewriteRefs(value, 'map.forest', (id) => (id === 'region.pit' ? 'region.hole' : undefined)) as any;
    expect(out).toEqual({ regionId: 'region.hole', destination: value.destination, nested: [{ ref: { kind: 'region', id: 'region.hole' } }] });
    expect(out.destination).toBe(value.destination);
    expect(rewriteRefs(value, 'map.forest', () => undefined)).toBe(value);
  });

  test('deleting a region and retargeting its references is one transaction that undoes atomically', () => {
    const ops = retargetOps(m, 'region.boss-enter', 'region.boss');
    expect(ops.map((op) => (op.op === 'set' ? `${op.collection}/${op.id}.${op.member}` : op.op))).toEqual(['triggers/trigger.boss-enter.regionId']);
    const tx = transaction('Delete region', [...ops, deleteOp(m, 'regions', ['region.boss-enter'])]);
    const next = apply(m, tx);
    expect(rec(next, 'triggers', 'trigger.boss-enter').regionId).toBe('region.boss');
    expect(next.collections.get('regions')?.byId.has('region.boss-enter')).toBe(false);
    expect(encode(apply(next, invertTransaction(tx)))).toBe(encode(m));
  });

  test('retargeting reaches document members and terrain settings', () => {
    const ops = retargetOps(m, 'region.boss-camera', 'region.boss');
    expect(ops.some((op) => op.op === 'field' && op.member === 'camera')).toBe(true);
    const layerOps = retargetOps(m, 'layer.tiles', 'layer.world');
    expect(layerOps.some((op) => op.op === 'set' && op.collection === 'terrain')).toBe(false);
  });
});
