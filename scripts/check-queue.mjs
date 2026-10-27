import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const sourcePath = 'docs/specifications/2026-10-16-maplab.md';
const makeId = (n) => 'ML-' + String(n).padStart(3, '0');

function block(doc, key) {
  const open = '<!-- ' + key + ':start -->';
  const close = '<!-- ' + key + ':end -->';
  ensure(doc.split(open).length === 2 && doc.split(close).length === 2,
    'Queue block markers disagree: ' + key);
  const a = doc.indexOf(open), b = doc.indexOf(close);
  ensure(b > a, 'Queue block order invalid: ' + key);
  return doc.slice(a + open.length, b).trim();
}
function tasks(doc) {
  const regex = /^### (ML-\d{3}) \/ ([^\n]+)$/gm;
  const heads = [...doc.matchAll(regex)];
  return heads.map((head, i) => ({
    id: head[1], priority: head[2],
    body: doc.slice(head.index, heads[i + 1]?.index ?? doc.length).trim(),
  }));
}
function field(body, label) {
  const prefix = '- **' + label + ':** ';
  const line = body.split('\n').find((s) => s.startsWith(prefix));
  ensure(line && line.length > prefix.length, 'Missing task field: ' + label);
  return line.slice(prefix.length);
}
function anchor(s) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
}
// Owner ruling 2026-10-27: the plan changes whenever anyone wants. A task block only needs its fields,
// traceable specification links, executable subtasks and gates; its content and order are free.
function verify(task, sections) {
  for (const label of ['Source scope', 'Non-goals', 'Acceptance', 'Depends on']) field(task.body, label);
  const refs = field(task.body, 'Specification');
  const matches = [...refs.matchAll(/\[([A-K]\d+)\]\(docs\/specifications\/2026-10-16-maplab\.md#([^\s)]+)\)/g)];
  ensure(matches.length >= 2 && new Set(matches.map((m) => m[1])).size === matches.length,
    'Specification references incomplete: ' + task.id);
  for (const [, section, slug] of matches) ensure(sections.has(section)
    && slug === anchor(section + '-' + sections.get(section)),
    'Specification traceability broken: ' + task.id + '/' + section);
  ensure(refs.includes('[2026-10-16-maplab.md](' + sourcePath + ')'),
    'Full specification link missing: ' + task.id);
  const lines = task.body.split('\n').filter((s) => /^  [1-4]\. /.test(s));
  ensure(lines.length === 4
    && lines.every((s,i) => s.startsWith('  ' + (i+1) + '. ') && s.length > 45)
    && lines[2].includes('Create owned fixture(s): ')
    && lines[3].includes('Add executable checks: '),
    'Executable subtasks/fixtures/tests missing: ' + task.id);
  const gate = field(task.body, 'Task gate');
  ensure(gate.includes('npm run check') && gate.includes('npm run security')
    && gate.includes('exact PR-head') && gate.includes('No merge without protected gates'),
    'Required acceptance gates missing: ' + task.id);
}
const marker = /^\*\*Highest ID ever used:\*\* (ML-\d{3})\b/gm;
export function highWater(plan) {
  const marks = [...plan.matchAll(marker)];
  ensure(marks.length === 1, 'Plan must record the highest ID ever used exactly once');
  return Number(marks[0][1].slice(3));
}
const planIds = (plan) => [...plan.matchAll(/^(?:### |- \*\*)(ML-\d{3})\b/gm)].map((m) => Number(m[1].slice(3)));
const liveIds = (plan) => [...tasks(block(plan, 'active-queue')), ...tasks(block(plan, 'future-queue'))].map((t) => t.id);
// IDs are never recycled: a task new to the queue takes an ID above every ID the base ever used, and the
// high-water mark never falls, so a removed queued ID stays retired.
export function checkNewIds(basePlan, headPlan) {
  const used = Math.max(...planIds(basePlan), ...[...basePlan.matchAll(marker)].map((m) => Number(m[1].slice(3))));
  ensure(highWater(headPlan) >= used, 'Highest ID ever used must never fall');
  const queued = new Set(liveIds(basePlan));
  for (const id of liveIds(headPlan)) ensure(queued.has(id) || Number(id.slice(3)) > used,
    'New task must take an ID above every ID ever used: ' + id);
}
export function checkQueue(root) {
  const read = (path) => readFileSync(resolve(root,path), 'utf8');
  const spec = read(sourcePath), plan = read('implementation_plan.md');
  const history = JSON.parse(read('docs/deliveries.json'));
  const change = JSON.parse(read('config/change.json'));
  const sections = new Map([...spec.matchAll(/^### ([A-K]\d+)\. ([^\n]+)/gm)].map((m) => [m[1],m[2]]));
  const done = Array.isArray(history) ? history.map((h) => h.id) : [];
  ensure(done.length >= 1 && done[0] === makeId(1) && done.every((id) => /^ML-\d{3}$/.test(id))
    && new Set(done).size === done.length,
    'Predecessor delivery chain incomplete or duplicated');
  const historical = block(plan,'completed-history');
  const closed = [...historical.matchAll(/^- \*\*(ML-\d{3})\*\* — /gm)].map((m) => m[1]);
  ensure(JSON.stringify(closed) === JSON.stringify(done),
    'Completed tasks must retire to historical plan/ledger');
  ensure(historical.includes(history[0].commit) && historical.includes('docs/changes/ML-001.md'),
    'ML-001 bootstrap history lost');
  const current = tasks(block(plan,'active-queue'));
  const future = tasks(block(plan,'future-queue'));
  ensure(current.length === 1 && change.id === current[0].id,
    'Active queue must hold exactly the controlled task');
  const live = [...current,...future];
  ensure([...plan.matchAll(/^### ML-\d{3} \/ /gm)].length === live.length,
    'Duplicate task definition outside current/future blocks');
  ensure(new Set(live.map((t) => t.id)).size === live.length && live.every((t) => !done.includes(t.id)),
    'Duplicate live task definition');
  const top = highWater(plan);
  ensure([...done, ...live.map((t) => t.id)].every((id) => Number(id.slice(3)) <= top),
    'A task ID exceeds the highest ID ever used');
  live.forEach((t) => verify(t, sections));
  return {active:current[0].id,completed:done.length,future:future.length,highest:makeId(top)};
}
