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
function sourceRows(spec) {
  const a = spec.indexOf('### J2.'), b = spec.indexOf('### J3.', a + 1);
  ensure(a >= 0 && b > a, 'Authoritative specification J2 missing');
  const lines = spec.slice(a,b).split('\n').filter((l) => /^\| \*\*ML-\d{3} \/ /.test(l));
  ensure(lines.length === 44, 'Specification J2 must reserve 44 IDs');
  return lines.map((line, i) => {
    const cells = line.slice(1,-1).split('|').map((s) => s.trim());
    const match = cells[0]?.match(/^\*\*(ML-\d{3}) \/ ([^*]+)\*\*$/);
    ensure(cells.length === 4 && match?.[1] === makeId(i + 1),
      'Specification J2 IDs/order malformed: ' + makeId(i + 1));
    return { id:match[1], priority:match[2], scope:cells[1],
      nonGoals:cells[2], acceptance:cells[3] };
  });
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
function verify(task, row, sections) {
  ensure(task.id === row.id && task.priority === row.priority,
    'Reserved queue order/priority differs from J2: ' + row.id);
  for (const [label, exact] of [
    ['Source scope', row.scope], ['Non-goals', row.nonGoals], ['Acceptance', row.acceptance]
  ]) ensure(field(task.body, label) === exact,
    'Specification J2 ' + label + ' drift: ' + task.id);
  ensure(field(task.body, 'Depends on').includes(makeId(Number(task.id.slice(3))-1) + ' completed and passing main CI'),
    'Predecessor dependency missing: ' + task.id);
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
export function checkQueue(root) {
  const read = (path) => readFileSync(resolve(root,path), 'utf8');
  const spec = read(sourcePath), plan = read('implementation_plan.md');
  const rows = sourceRows(spec), history = JSON.parse(read('docs/deliveries.json'));
  const change = JSON.parse(read('config/change.json'));
  const sections = new Map([...spec.matchAll(/^### ([A-K]\d+)\. ([^\n]+)/gm)].map((m) => [m[1],m[2]]));
  ensure(Array.isArray(history) && history.length >= 1 && history.length < 44
    && history.every((h,i) => h.id === makeId(i+1)),
    'Contiguous completed predecessor chain missing');
  const historical = block(plan,'completed-history');
  const closed = [...historical.matchAll(/^- \*\*(ML-\d{3})\*\* — /gm)].map((m) => m[1]);
  ensure(closed.length === history.length && closed.every((n,i) => n === history[i].id),
    'Completed tasks must retire to historical plan/ledger');
  ensure(historical.includes(history[0].commit) && historical.includes('docs/changes/ML-001.md'),
    'ML-001 bootstrap history lost');
  const current = tasks(block(plan,'active-queue'));
  const future = tasks(block(plan,'future-queue'));
  ensure(current.length === 1 && current[0].id === makeId(history.length+1)
    && change.id === current[0].id,
    'Active queue must select the first open reserved task');
  ensure(future.length === 43-history.length
    && future.every((e,i) => e.id === makeId(history.length+i+2)),
    'Reserved future tasks must be preserved exactly once in order');
  const live = [...current,...future];
  ensure(new Set(live.map((t) => t.id)).size === live.length,
    'Duplicate live task definition');
  live.forEach((t,i) => verify(t, rows[history.length+i], sections));
  const old = read('docs/IMPLEMENTATION-ROADMAP.md');
  ensure(old.includes('../implementation_plan.md') && old.includes('specifications/2026-10-16-maplab.md')
    && !/^### ML-\d{3}|^\| \*\*ML-\d{3}/m.test(old),
    'Duplicate live task definitions in old roadmap');
  return {active:current[0].id,completed:history.length,future:future.length,reserved:rows.length};
}
