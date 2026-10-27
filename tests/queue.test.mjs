import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { checkNewIds, checkQueue } from '../scripts/check-queue.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = [];
afterEach(() => temporary.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
function fixture() {
  const p = mkdtempSync(join(tmpdir(), 'maplab-queue-'));
  temporary.push(p);
  for (const f of ['implementation_plan.md',
    'docs/specifications/2026-10-16-maplab.md', 'docs/deliveries.json', 'config/change.json']) {
    mkdirSync(dirname(join(p, f)), { recursive: true });
    cpSync(join(root, f), join(p, f));
  }
  return p;
}
const edit = (p, file, fn) => {
  const f = join(p, file);
  writeFileSync(f, fn(readFileSync(f, 'utf8')));
};
// Corruptions target whichever task is active, so activation never edits this file.
const delivered = JSON.parse(readFileSync(join(root, 'docs/deliveries.json'), 'utf8')).length;
const active = JSON.parse(readFileSync(join(root, 'config/change.json'), 'utf8')).id;
const plan = readFileSync(join(root, 'implementation_plan.md'), 'utf8');
const futureBlock = plan.slice(plan.indexOf('<!-- future-queue:start -->'), plan.indexOf('<!-- future-queue:end -->'));
const queued = [...futureBlock.matchAll(/^### (ML-\d{3}) \//gm)].map((m) => m[1]);
const highest = plan.match(/^\*\*Highest ID ever used:\*\* (ML-\d{3})/m)[1];
const above = (n) => 'ML-' + String(Number(highest.slice(3)) + n).padStart(3, '0');
const activeBlock = plan.slice(plan.indexOf('<!-- active-queue:start -->'), plan.indexOf('<!-- active-queue:end -->'));
const fieldOf = (label) => activeBlock.split('\n').find((l) => l.startsWith('- **' + label + ':** ')).slice(label.length + 8);
const scope = fieldOf('Source scope');
const fixtures = activeBlock.split('\n').find((l) => l.startsWith('  3. ')).split('Create owned fixture(s): ')[1];
const taskBlock = activeBlock.slice(activeBlock.indexOf('### '));
// A queued copy of the active block under another ID, as a plan edit would add it.
const queue = (s, id) => s.replace('<!-- future-queue:end -->', taskBlock.replace(/^### ML-\d{3} \//, '### ' + id + ' /').trim() + '\n\n<!-- future-queue:end -->');
const ahead = (s, id) => s.replace('<!-- future-queue:start -->', '<!-- future-queue:start -->\n' + taskBlock.replace(/^### ML-\d{3} \//, '### ' + id + ' /').trim() + '\n');
const drop = (s, id) => s.replace(new RegExp('### ' + id + ' \\/[\\s\\S]*?(?=### ML-|<!-- future-queue:end -->)'), '');
const raise = (s, id) => s.replace(/^(\*\*Highest ID ever used:\*\* )ML-\d{3}/m, '$1' + id);
test('the live queue passes with the active task, history and the highest ID ever used', () => {
  expect(checkQueue(fixture())).toEqual({ active, completed: delivered, future: queued.length, highest });
});
// Owner ruling 2026-10-27: the plan changes whenever anyone wants.
test.each([
  ['an edited queued scope', (s) => s.replace('**Source scope:** ' + scope, '**Source scope:** Replaced ' + scope)],
  ['a removed queued task', (s) => drop(raise(queue(s, above(1)), above(1)), queued[0] ?? above(1))],
  ['an emptied queue', (s) => raise(s, above(1)).replace(/<!-- future-queue:start -->[\s\S]*?<!-- future-queue:end -->/, '<!-- future-queue:start -->\n<!-- future-queue:end -->')],
  ['a new task placed ahead of the queue', (s) => raise(ahead(s, above(1)), above(1))],
  ['a new task above the mark, skipping IDs', (s) => raise(queue(s, above(3)), above(3))],
])('accepts %s', (_label, transform) => {
  const p = fixture(); edit(p, 'implementation_plan.md', transform);
  expect(readFileSync(join(p, 'implementation_plan.md'), 'utf8')).not.toBe(plan);
  expect(() => checkQueue(p)).not.toThrow();
});
test.each([
  ['duplicate queued ID', 'implementation_plan.md', (s) => queue(s, active), 'Duplicate live task'],
  ['a delivered ID back in the queue', 'implementation_plan.md', (s) => queue(s, 'ML-002'), 'Duplicate live task'],
  ['active task other than the controlled change', 'implementation_plan.md', (s) => s.replace('### ' + active + ' /', '### ' + above(1) + ' /'), 'Active queue'],
  ['an ID above the mark', 'implementation_plan.md', (s) => queue(s, above(1)), 'highest ID ever used'],
  ['a missing mark', 'implementation_plan.md', (s) => s.replace(/^\*\*Highest ID ever used:\*\*.*$/m, ''), 'highest ID ever used exactly once'],
  ['wrong specification anchor', 'implementation_plan.md', (s) => s.replace(/(### ML-\d{3} \/[^\n]*\n[\s\S]*?\[[A-K]\d+\]\(docs\/specifications\/2026-10-16-maplab\.md#)[^)]+\)/, '$1wrong)'), 'Specification traceability'],
  ['missing fixture', 'implementation_plan.md', (s) => s.replace('Create owned fixture(s): ' + fixtures, 'Create owned fixture(s): TODO'), 'Executable subtasks'],
  ['missing acceptance', 'implementation_plan.md', (s) => s.replace(/^- \*\*Acceptance:\*\* .*\n/m, ''), 'Missing task field: Acceptance'],
  ['premature completion', 'implementation_plan.md', (s) => s.replace('<!-- completed-history:end -->', '- **' + active + '** — prematurely complete\n<!-- completed-history:end -->'), 'Completed tasks'],
  ['duplicate delivery', 'docs/deliveries.json', (s) => { const v = JSON.parse(s); v.push(v[1]); return JSON.stringify(v); }, 'Predecessor delivery chain'],
])('rejects %s', (_label, file, transform, diagnostic) => {
  const p=fixture();
  edit(p, file, transform);
  expect(readFileSync(join(p, file), 'utf8')).not.toBe(readFileSync(join(root, file), 'utf8'));
  expect(() => checkQueue(p)).toThrow(diagnostic);
});
test('a plan change may add a task above every ID ever used and retire queued IDs', () => {
  expect(() => checkNewIds(plan, raise(queue(plan, above(1)), above(1)))).not.toThrow();
  const retired = raise(plan, above(1));
  expect(() => checkNewIds(plan, retired)).not.toThrow();
  expect(() => checkNewIds(retired, raise(queue(retired, above(1)), above(1)))).toThrow('above every ID ever used: ' + above(1));
});
test.each([
  ['a falling mark', () => raise(plan, 'ML-002'), 'must never fall'],
  ['a recycled delivered ID', () => queue(plan, 'ML-002'), 'above every ID ever used: ML-002'],
])('a plan change rejects %s', (_label, head, diagnostic) => {
  expect(() => checkNewIds(plan, head())).toThrow(diagnostic);
});
