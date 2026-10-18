// ML-008: pure transactions apply completely or not at all, never write their input, and invert exactly.
import { describe, expect, test } from 'vitest';
import { deleteOp, fieldOp, insertOp, paintOp, rectangle, setOp, terrainOp, transaction } from '../src/domain/commands';
import { encode, type JsonObject, type MapModel } from '../src/domain/model';
import { applyTransaction, invertTransaction, pruneTransaction, type Operation, type Transaction } from '../src/domain/transaction';
import { cell, forestModel, prng } from './history-support';

const apply = (m: MapModel, tx: Transaction): MapModel => { const r = applyTransaction(m, tx); if (!r.ok) throw new Error(JSON.stringify(r.problem)); return r.model; };
const refusal = (m: MapModel, tx: Transaction) => { const r = applyTransaction(m, tx); return r.ok ? null : { code: r.problem.code, op: r.problem.op }; };

describe('each operation inverts exactly and leaves its input untouched', () => {
  const m = forestModel();
  const original = encode(m);
  const flag = { id: 'flag.gate-open', initial: false };
  const cases: [string, Transaction][] = [
    ['record member', transaction('Rename', [setOp(m, 'bodies', 'body.gate', 'name', 'Iron gate')])],
    ['absent member', transaction('Drop motion', [setOp(m, 'bodies', 'body.gate', 'motion', undefined)])],
    ['document member', transaction('Resize', [fieldOp(m, 'bounds', [0, 0, 2560, 800])])],
    ['terrain settings', transaction('Reseed', [terrainOp(m, 'layer.tiles', 'variationSeed', 11)])],
    ['insert mid-collection', transaction('Add flag', [insertOp(m, 'flags', [flag], 0)])],
    ['delete', transaction('Delete', [deleteOp(m, 'waypoints', ['waypoint.west.b', 'waypoint.fly.a'])])],
    ['paint', transaction('Paint', [paintOp(m, 'layer.tiles', rectangle(-3, -3, 6, 6, cell('tile.dirt', 2, true)))])],
  ];
  test.each(cases)('%s', (_, tx) => {
    const next = apply(m, tx);
    expect(encode(next)).not.toBe(original);
    expect(encode(m)).toBe(original);
    expect(encode(apply(next, invertTransaction(tx)))).toBe(original);
    expect(encode(apply(apply(next, invertTransaction(tx)), tx))).toBe(encode(next));
  });

  test('an insert/delete pair keeps exact positions, and deleted nested IDs leave the namespace', () => {
    const del = transaction('Delete body', [deleteOp(m, 'bodies', ['body.east'])]);
    const gone = apply(m, del);
    expect(gone.owners.has('body.east')).toBe(false);
    expect([...gone.owners.keys()].some((id) => m.owners.get(id) === 'bodies/body.east')).toBe(false);
    const back = apply(gone, invertTransaction(del));
    expect(back.collections.get('bodies')?.order).toEqual(m.collections.get('bodies')?.order);
    expect([...back.owners].sort()).toEqual([...m.owners].sort());
  });
});

describe('refusals are atomic and name the operation', () => {
  const m = forestModel();
  const original = encode(m);
  const good = setOp(m, 'bodies', 'body.gate', 'name', 'Gate') as Operation;
  test.each<[string, Operation, string]>([
    ['a stale before value', { op: 'set', collection: 'regions', id: 'region.pit', member: 'name', before: 'Not the name', after: 'Pit' }, 'transaction.stale'],
    ['a persistent ID change', { op: 'set', collection: 'flags', id: 'flag.boss-defeated', member: 'id', before: 'flag.boss-defeated', after: 'flag.x' }, 'transaction.immutable-id'],
    ['a document identity member', { op: 'field', member: 'id', before: 'map.forest', after: 'map.other' }, 'transaction.member'],
    ['a collection set as a field', { op: 'field', member: 'flags', before: undefined, after: [] }, 'transaction.member'],
    ['a duplicate top-level ID', insertOp(m, 'flags', [{ id: 'region.pit', initial: true }]) as Operation, 'transaction.duplicate-id'],
    ['a duplicate nested ID', insertOp(m, 'bodies', [{ ...(m.collections.get('bodies')?.byId.get('body.gate') as JsonObject), id: 'body.gate-2' }]) as Operation, 'transaction.duplicate-id'],
    ['a missing record', { op: 'set', collection: 'flags', id: 'flag.none', member: 'initial', before: false, after: true }, 'transaction.missing'],
    ['a stale delete', { op: 'delete', collection: 'flags', entries: [{ index: 0, record: { id: 'flag.boss-defeated', initial: true } }] }, 'transaction.stale'],
    ['an out-of-range insert', { op: 'insert', collection: 'flags', entries: [{ index: 5, record: { id: 'flag.late', initial: true } }] }, 'transaction.index'],
  ])('%s', (_, bad, code) => {
    expect(refusal(m, transaction('Edit', [good, bad]))).toEqual({ code, op: 1 });
    expect(encode(m)).toBe(original);
  });

  test('paint deltas refuse stale and malformed cells', () => {
    const paint = paintOp(m, 'layer.tiles', rectangle(0, 0, 2, 1, cell('tile.grass'))) as Extract<Operation, { op: 'paint' }>;
    const painted = apply(m, transaction('Paint', [paint]));
    expect(refusal(painted, transaction('Again', [paint]))).toEqual({ code: 'paint.stale', op: 0 });
    const [chunk] = paint.delta.chunks;
    const unsorted = { ...paint, delta: { ...paint.delta, chunks: [{ ...chunk!, indices: Uint16Array.from([1, 0]) }] } };
    expect(refusal(m, transaction('Bad', [unsorted]))).toEqual({ code: 'paint.malformed', op: 0 });
    expect(refusal(m, transaction('Bad', [{ op: 'paint', layerId: 'layer.world', delta: paint.delta }]))).toEqual({ code: 'transaction.missing', op: 0 });
  });

  test('builders return null for no-ops and pruning drops unchanged operations', () => {
    expect(setOp(m, 'bodies', 'body.gate', 'name', m.collections.get('bodies')?.byId.get('body.gate')?.name)).toBeNull();
    expect(fieldOp(m, 'bounds', [...(m.fields.get('bounds') as number[])])).toBeNull();
    expect(paintOp(m, 'layer.tiles', [{ column: 0, row: 0, cell: null }])).toBeNull();
    expect(pruneTransaction({ label: 'x', ops: [{ op: 'field', member: 'bounds', before: [1], after: [1] }] }).ops).toEqual([]);
  });
});

test('seeded replay: 200 random transactions undo to every prior state and redo to the last', () => {
  const random = prng(8008);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)] as T;
  let m = forestModel();
  const states = [encode(m)];
  const done: Transaction[] = [];
  let flags = 0;
  while (done.length < 200) {
    const kind = pick(['set', 'paint', 'paint', 'insert', 'delete', 'field', 'mixed']);
    const ops: (Operation | null)[] = [];
    if (kind === 'set' || kind === 'mixed') ops.push(setOp(m, 'regions', pick(m.collections.get('regions')?.order ?? []), 'name', `R${Math.floor(random() * 1e6)}`));
    if (kind === 'paint' || kind === 'mixed') {
      const tile = pick([cell('tile.grass'), cell('tile.dirt', pick([0, 1, 2, 3] as const), random() < 0.5), null]);
      ops.push(paintOp(m, 'layer.tiles', rectangle(Math.floor(random() * 64) - 40, Math.floor(random() * 64) - 40, 1 + Math.floor(random() * 24), 1 + Math.floor(random() * 24), tile)));
    }
    if (kind === 'insert') ops.push(insertOp(m, 'flags', [{ id: `flag.r${flags++}`, initial: random() < 0.5 }], Math.floor(random() * ((m.collections.get('flags')?.order.length ?? 0) + 1))));
    if (kind === 'delete' && (m.collections.get('flags')?.order.length ?? 0) > 1) ops.push(deleteOp(m, 'flags', [pick(m.collections.get('flags')?.order ?? [])]));
    if (kind === 'field') ops.push(fieldOp(m, 'bounds', [0, 0, 1280 + Math.floor(random() * 640), 800]));
    const tx = pruneTransaction(transaction(kind, ops));
    if (tx.ops.length === 0) continue;
    m = apply(m, tx);
    done.push(tx);
    states.push(encode(m));
  }
  const last = m;
  for (let i = done.length - 1; i >= 0; i--) {
    m = apply(m, invertTransaction(done[i] as Transaction));
    expect(encode(m)).toBe(states[i]);
  }
  for (const tx of done) m = apply(m, tx);
  expect(encode(m)).toBe(encode(last));
}, 30_000);
