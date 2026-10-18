// ML-008: interprets the owned conformance/history step scripts through src/domain and src/editor, and
// checks that the pure domain and history modules import no React, DOM, storage, network or app code.
import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, type JsonValue } from '../src/contracts';
import { insertOp, rectangle, setOp, paintOp, transaction } from '../src/domain/commands';
import { encode, normalize, denormalize, type CollectionName, type JsonObject } from '../src/domain/model';
import { deltaCells, readCell, type CellWrite } from '../src/domain/paint';
import { planPaste, pasteTransaction } from '../src/domain/remap';
import { beginGesture } from '../src/editor/gesture';
import { beginSave, commit, completeSave, isDirty, openDocument, redo, undo, type DocumentState, type SaveTicket } from '../src/editor/history';
import { cell, modelOf, root } from './history-support';

const index = JSON.parse(readFileSync(join(root, 'conformance/history/cases.json'), 'utf8'));
const baseBytes = readFileSync(join(root, index.base.path));
const baseDocument = JSON.parse(baseBytes.toString('utf8')) as JsonValue;
const tileOf = (id: string | null) => (id === null ? null : cell(id));

type Step = Record<string, any>;
interface Outcome { outcome?: string; code?: string; mapping?: Record<string, string>; problems?: { code: string; path: string }[] }

function run(record: { steps: Step[]; budget?: number }): void {
  let s: DocumentState = openDocument(modelOf(baseDocument), { savedDigest: index.base.savedDigest, ...(record.budget ? { budget: record.budget } : {}) });
  const tickets = new Map<string, SaveTicket>();
  const fromCommit = (r: ReturnType<typeof commit>): Outcome => { s = r.state; return r.outcome === 'refused' ? { outcome: r.outcome, code: r.problem.code } : { outcome: r.outcome }; };
  const brush = (step: Step, cells: CellWrite[]): Outcome => {
    const g = beginGesture(s, 'Brush', step.maxChunks);
    const per = Math.ceil(cells.length / (step.moves ?? 1));
    for (let i = 0; i < cells.length; i += per) {
      const w = g.paint(step.layerId, cells.slice(i, i + per));
      if (!w.ok) { g.cancel(); return { outcome: 'refused', code: w.code }; }
    }
    if (step.cancel) { s = g.cancel(); return { outcome: 'cancelled' }; }
    return fromCommit(g.commit(s));
  };
  for (const [n, step] of record.steps.entries()) {
    const before = s;
    const where = `step ${n} (${step.do})`;
    let out: Outcome = {};
    switch (step.do) {
      case 'brush': {
        const cells = step.rect ? [...rectangle(step.rect[0], step.rect[1], step.rect[2], step.rect[3], tileOf(step.tile))]
          : step.cells.map(([column, row, tile]: [number, number, string | null]) => ({ column, row, cell: tileOf(tile) }));
        out = brush(step, cells);
        break;
      }
      case 'drag': {
        const g = beginGesture(s, 'Drag');
        for (const v of step.values) g.set(step.collection, step.id, step.member, v);
        if (step.back) g.set(step.collection, step.id, step.member, s.model.collections.get(step.collection as CollectionName)?.byId.get(step.id)?.[step.member]);
        out = fromCommit(g.commit(s));
        break;
      }
      case 'set': {
        const value = step.same ? s.model.collections.get(step.collection as CollectionName)?.byId.get(step.id)?.[step.member] : step.value;
        out = fromCommit(commit(s, transaction('Set', [setOp(s.model, step.collection, step.id, step.member, value)])));
        break;
      }
      case 'insert': out = fromCommit(commit(s, transaction('Insert', [insertOp(s.model, step.collection, [step.record])]))); break;
      case 'paste': {
        const items = step.items.map(([collection, id]: [string, string]) => ({ collection, record: s.model.collections.get(collection as CollectionName)?.byId.get(id) as JsonObject }));
        const plan = planPaste(s.model, items);
        out = { ...fromCommit(commit(s, pasteTransaction(s.model, plan))), mapping: Object.fromEntries(plan.mapping) };
        break;
      }
      case 'normalize': {
        const doc = structuredClone(baseDocument) as any;
        const keys = step.pointer.split('/').slice(1);
        const last = keys.pop();
        keys.reduce((node: any, k: string) => node[k], doc)[last] = step.value;
        const r = normalize(doc);
        out = { problems: r.ok ? [] : r.problems.map(({ code, path }) => ({ code, path })) };
        break;
      }
      case 'undo': s = undo(s); break;
      case 'redo': s = redo(s); break;
      case 'undoAll': while (s.past.length) s = undo(s); break;
      case 'strokes':
        for (let i = 0; i < step.count; i++) {
          out = fromCommit(commit(s, transaction(`Stroke ${i}`, [paintOp(s.model, step.layerId, rectangle(step.rect[0], step.rect[1], step.rect[2], step.rect[3], cell(step.tiles[i % step.tiles.length])))])));
          expect(s.bytes, `${where} stroke ${i}`).toBeLessThanOrEqual(s.budget);
        }
        break;
      case 'beginSave': tickets.set(step.ticket, beginSave(s)); break;
      case 'completeSave': {
        const r = completeSave(s, tickets.get(step.ticket) as SaveTicket, step.digest);
        s = r.state;
        out = r.ok ? { outcome: 'saved' } : { outcome: 'refused', code: r.code };
        break;
      }
      default: throw new Error(`Unknown step ${step.do}`);
    }
    // Invariants after every step.
    expect(s.bytes, where).toBeLessThanOrEqual(s.budget);
    expect(s.bytes, where).toBe([...s.past, ...s.future].reduce((k, e) => k + e.bytes, 0));
    const e = step.expect ?? {};
    const last = s.past.at(-1);
    const paint = last?.tx.ops.find((op) => op.op === 'paint');
    const actual: Record<string, unknown> = {
      outcome: out.outcome, code: out.code, problems: out.problems, mapping: out.mapping && Object.fromEntries(Object.entries(out.mapping).filter(([k]) => k in (e.mapping ?? {}))),
      entries: s.past.length, future: s.future.length, dirty: isDirty(s), revision: s.revision, dropped: s.dropped, notices: s.notices.length, baseDigest: s.baseDigest,
      deltaCells: paint?.op === 'paint' ? deltaCells(paint.delta) : undefined, deltaChunks: paint?.op === 'paint' ? paint.delta.chunks.length : undefined,
      unchanged: s === before, matches: encode(s.model) === canonical(baseDocument) ? 'base' : 'other',
      renormalizes: normalize(denormalize(s.model)).ok,
      cell: e.cell && [e.cell[0], e.cell[1], readCell(s.model.terrain?.byLayer.get('layer.tiles')?.cells as never, e.cell[0], e.cell[1])?.tileId ?? null],
    };
    for (const [key, want] of Object.entries(e)) {
      if (key === 'entryBytesAtMost') expect(last?.bytes, `${where} ${key}`).toBeLessThanOrEqual(want as number);
      else if (key === 'bytesAtMost') expect(s.bytes, `${where} ${key}`).toBeLessThanOrEqual(want as number);
      else expect(actual[key], `${where} ${key}`).toEqual(want);
    }
  }
}

describe('conformance/history', () => {
  test('the base map is pinned and every case is uniquely named', () => {
    expect(createHash('sha256').update(baseBytes).digest('hex')).toBe(index.base.sha256);
    const ids = index.cases.map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['paint-10000-cell-delta', 'undo-redo-no-op', 'duplicate-ids', 'saved-revision-conflict', 'memory-bound']));
  });
  test.each(index.cases.map((c: { id: string }) => [c.id, c]))('%s', (_, record) => run(record));
});

test('src/domain and the editor history modules stay pure: no React, DOM, storage, network or app imports', () => {
  const files = [...readdirSync(join(root, 'src/domain')).map((f) => `src/domain/${f}`), 'src/editor/history.ts', 'src/editor/gesture.ts'];
  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8');
    for (const [, specifier] of source.matchAll(/^import\b[^;]*?\bfrom\s+'([^']+)'/gm)) {
      expect(/^\.\.\/contracts$|^\.\/[a-z]+$|^\.\.\/domain\/[a-z]+$/.test(specifier as string), `${file}: ${specifier}`).toBe(true);
    }
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, file).not.toMatch(/\b(?:window|document|navigator|globalThis)\.|\b(?:localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket|process)\b|\bfetch\(|\bimport\(|\brequire\(/);
  }
});
