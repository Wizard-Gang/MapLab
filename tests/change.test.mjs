import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';
import { requiredFiles } from '../scripts/check-foundation.mjs';
import { checkEvent, checkReleaseTrees, lastMainCiDelivery, sections } from '../scripts/check-change.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = [];
const change = JSON.parse(readFileSync(join(root, 'config/change.json')));
const history = JSON.parse(readFileSync(join(root, 'docs/deliveries.json')));
const release = JSON.parse(readFileSync(join(root, 'config/release.json')));
const currentNumber = Number(change.id.slice(3));
const plan = readFileSync(join(root, 'implementation_plan.md'), 'utf8');
const futureBlock = plan.slice(plan.indexOf('<!-- future-queue:start -->'), plan.indexOf('<!-- future-queue:end -->'));
// Any queued task may be delivered next; the fixture takes the first one.
const otherId = futureBlock.match(/^### (ML-\d{3}) \//m)?.[1];
const highest = Number(plan.match(/^\*\*Highest ID ever used:\*\* ML-(\d{3})/m)[1]);
const nextId = `ML-${String(highest + 1).padStart(3, '0')}`;
// A plan edit that queues a task: the new ID must sit above every ID ever used, and the mark rises to it.
const withTask = (id, mark = nextId) => plan.replace(/^(\*\*Highest ID ever used:\*\* )ML-\d{3}/m, `$1${mark}`)
  .replace('<!-- future-queue:end -->', `### ${id} / P2\n\n<!-- future-queue:end -->`);
afterEach(() => temporary.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'maplab-change-'));
  temporary.push(path);
  for (const file of [...requiredFiles, change.record, ...history.map((e) => `docs/changes/${e.id}.md`)]) {
    mkdirSync(dirname(join(path, file)), { recursive: true }); cpSync(join(root, file), join(path, file));
  }
  return path;
}
const edit = (p, f, fn) => { const file = join(p, f); writeFileSync(file, fn(readFileSync(file, 'utf8'))); };
const json = (p, f, fn) => edit(p, f, (s) => { const v = JSON.parse(s); fn(v); return JSON.stringify(v, null, 2) + '\n'; });
const run = (p) => spawnSync(process.execPath, [resolve(root, 'scripts/check-change.mjs'), '--root', p], {
  encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: '' },
});

test('real CLI accepts current task independently of credentials and Git', () => {
  const result = run(fixture()); expect(result.status, result.stderr).toBe(0);
});
test.skipIf(!otherId)('real CLI accepts any queued task as the next delivery', () => {
  const p = fixture();
  json(p, 'config/change.json', (v) => { v.id = otherId; v.type = 'SECURITY'; v.title = `[${otherId}] [SECURITY] Exercise future task fixture`; v.branch = `${otherId.toLowerCase()}-fixture`; v.record = `docs/changes/${otherId}.md`; });
  const c = JSON.parse(readFileSync(join(p, 'config/change.json')));
  writeFileSync(join(p, c.record), `# ${c.title}\n\n` + sections.map((s) => `## ${s}\n\nSynthetic test data only.\n`).join('\n'));
  edit(p, 'implementation_plan.md', (s) => {
    const active = s.match(/<!-- active-queue:start -->([\s\S]*?)<!-- active-queue:end -->/)[1].trim();
    const future = s.match(/<!-- future-queue:start -->([\s\S]*?)<!-- future-queue:end -->/)[1].trim();
    const start = future.indexOf('### ' + otherId + ' /');
    const end = future.indexOf('\n### ML-', start + 6);
    const next = future.slice(start, end < 0 ? undefined : end).trim();
    const rest = end < 0 ? '' : future.slice(end).trim();
    const done = '- **' + change.id + '** — completed in synthetic test ledger; see docs/changes/' + change.id + '.md.';
    return s.replace('<!-- completed-history:end -->', done + '\n<!-- completed-history:end -->')
      .replace(active, next)
      .replace(/<!-- future-queue:start -->([\s\S]*?)<!-- future-queue:end -->/,
        '<!-- future-queue:start -->\n' + rest + '\n<!-- future-queue:end -->');
  });
  json(p, 'docs/deliveries.json', (v) => {
    v.push({ id: change.id, pr: 1, commit: 'a'.repeat(40), testedHeads: ['b'.repeat(40)], ...currentNumber > lastMainCiDelivery
      ? { gate: { head: 'b'.repeat(40), conclusion: 'success', url: 'https://github.com/Wizard-Gang/MapLab/actions/runs/1' } }
      : { mainCi: { head: 'a'.repeat(40), conclusion: 'success', url: 'https://github.com/Wizard-Gang/MapLab/actions/runs/1' } } });
  });
  json(p, 'config/release.json', (v) => { v.tasks.push(otherId); });
  const result = run(p); expect(result.status, result.stderr).toBe(0);
});
test.each([
  ['bootstrap reuse', (p) => json(p, 'config/change.json', (v) => { v.bootstrap = 'empty-repository-root-commit'; }), 'bootstrap is closed'],
  ['root task reuse', (p) => json(p, 'config/change.json', (v) => { v.id = 'ML-001'; }), 'post-bootstrap'],
  ['malformed ID', (p) => json(p, 'config/change.json', (v) => { v.id = 'ML-1'; }), 'Malformed controlled change ID'],
  ['wrong branch', (p) => json(p, 'config/change.json', (v) => { v.branch = 'main'; }), 'branch identity'],
  ['record path escape', (p) => json(p, 'config/change.json', (v) => { v.record = `../${change.id}.md`; }), 'record identity'],
  ['record title mismatch', (p) => edit(p, change.record, (s) => s.replace(`# ${change.title}`, '# Mismatched record title')), 'record title'],
  ['missing record section', (p) => edit(p, change.record, (s) => s.replace('## Controls', '## Control')), 'sections disagree'],
  ['duplicate future ID', (p) => edit(p, 'implementation_plan.md', (s) => s.replace('<!-- future-queue:end -->', `### ${change.id} / P2\n\n<!-- future-queue:end -->`)), 'Duplicate live task'],
  ['queue mismatch', (p) => edit(p, 'implementation_plan.md', (s) => s.replace(`### ${change.id} /`, `### ${nextId} /`)), 'Active queue'],
  ['missing predecessor', (p) => writeFileSync(join(p, 'docs/deliveries.json'), '[]\n'), 'Predecessor delivery chain'],
  ['failed predecessor CI', (p) => json(p, 'docs/deliveries.json', (v) => { v[0].mainCi.conclusion = 'failure'; }), 'main CI evidence'],
  ['different predecessor SHA', (p) => json(p, 'docs/deliveries.json', (v) => { v[0].mainCi.head = 'f'.repeat(40); }), 'main CI evidence'],
  ['release gate evidence before the cut-over', (p) => json(p, 'docs/deliveries.json', (v) => { v[0].gate = { ...v[0].mainCi }; }), 'main CI evidence'],
  ['a release branch that disagrees with its ID', (p) => json(p, 'config/release.json', (v) => { v.branch = 'release/r999'; }), 'Release identity'],
  ['an extra release field', (p) => json(p, 'config/release.json', (v) => { v.base = 'main'; }), 'Release identity'],
  ['a release without the current task', (p) => json(p, 'config/release.json', (v) => { v.tasks.pop(); }), 'Release task chain'],
  ['a release that lists a pre-cut-over task', (p) => json(p, 'config/release.json', (v) => { v.tasks.unshift('ML-029'); }), 'Release task chain'],
  ['a release that repeats a task', (p) => json(p, 'config/release.json', (v) => { v.tasks.unshift(v.tasks.at(-1)); }), 'Release task chain'],
  ['a delivery outside every release', (p) => json(p, 'config/release.json', (v) => { v.tasks.shift(); }), 'Predecessor delivery chain'],
  ['a skipped release record', (p) => json(p, 'config/release.json', (v) => { v.id = 'r009'; v.branch = 'release/r009'; }), 'Release chain is incomplete'],
  ['a failed release run', (p) => {
    json(p, 'config/release.json', (v) => { v.id = `r${String(Number(v.id.slice(1)) + 1).padStart(3, '0')}`; v.branch = `release/${v.id}`; });
    json(p, 'docs/releases.json', (v) => { v.push({ id: `r${String(v.length + 1).padStart(3, '0')}`, pr: 1, testedHead: 'b'.repeat(40), mainHead: 'c'.repeat(40), tasks: ['ML-030'], ci: { conclusion: 'failure', url: 'https://github.com/Wizard-Gang/MapLab/actions/runs/1' } }); });
  }, 'Release evidence'],
])('real CLI rejects %s', (_name, corrupt, message) => {
  const p = fixture(); corrupt(p); const result = run(p);
  expect(result.status).toBe(1); expect(result.stderr).toContain(message);
});

const body = sections.map((s) => `## ${s}\n\nFixture prose.\n`).join('\n');
function eventFixture() {
  return { eventName: 'pull_request', actualHead: 'b'.repeat(40), release, taskTitles: release.tasks.map(() => change.title),
    commitTitles: [change.title], changedFiles: ['config/change.json', 'config/release.json', change.record, 'implementation_plan.md'],
    basePlan: plan, headPlan: plan, releaseOpen: true,
    event: { repository: { full_name: 'Wizard-Gang/MapLab' }, pull_request: {
      title: change.title, body,
      head: { sha: 'b'.repeat(40), ref: change.branch },
      base: { ref: release.branch, sha: 'a'.repeat(40), repo: { full_name: 'Wizard-Gang/MapLab' } },
    } },
  };
}
// The release PR into main: one squash commit per listed task, oldest first, titled as each task's record.
function releaseFixture() {
  const v = eventFixture();
  const titles = release.tasks.map((id) => `[${id}] [FEATURE] Fixture task ${id}`);
  const range = release.tasks.length === 1 ? release.tasks[0] : `${release.tasks[0]}..${release.tasks.at(-1)}`;
  Object.assign(v, { taskTitles: titles, commitTitles: titles.map((t, i) => `${t} (#${100 + i})`).reverse(), changedFiles: [] });
  Object.assign(v.event.pull_request, { title: `[RELEASE] ${release.id}: ${range}`, head: { sha: 'b'.repeat(40), ref: release.branch } });
  v.event.pull_request.base.ref = 'main';
  return v;
}
// A plan-only PR: no task ID, implementation_plan.md alone, into the open release, whatever the queue holds.
function planFixture() {
  const v = eventFixture();
  Object.assign(v, { commitTitles: ['[PLAN] Queue a new task'], changedFiles: ['implementation_plan.md'], headPlan: withTask(nextId) });
  Object.assign(v.event.pull_request, { title: '[PLAN] Queue a new task', head: { sha: 'b'.repeat(40), ref: 'plan-queue-a-new-task' } });
  return v;
}
test('event validation accepts a current task PR into the open release', () => expect(() => checkEvent(change, eventFixture())).not.toThrow());
test('event validation accepts a task PR that also edits other queued tasks', () => {
  const v = eventFixture(); v.headPlan = withTask(nextId); expect(() => checkEvent(change, v)).not.toThrow();
});
test('event validation accepts a plan-only PR', () => expect(() => checkEvent(change, planFixture())).not.toThrow());
test('event validation accepts a plan-only PR into the next release once the open one has merged', () => {
  const v = planFixture(); v.releaseOpen = false;
  v.event.pull_request.base.ref = `release/r${String(Number(release.id.slice(1)) + 1).padStart(3, '0')}`;
  expect(() => checkEvent(change, v)).not.toThrow();
});
test('event validation accepts a plan-only PR that removes queued tasks', () => {
  const v = planFixture(); v.headPlan = plan.replace(/<!-- future-queue:start -->[\s\S]*?<!-- future-queue:end -->/, '<!-- future-queue:start -->\n<!-- future-queue:end -->');
  expect(() => checkEvent(change, v)).not.toThrow();
});
test.each([
  ['a file besides the plan', (v) => { v.changedFiles.push('config/change.json'); }],
  ['a task record', (v) => { v.changedFiles = [change.record]; }],
  ['a task branch', (v) => { v.event.pull_request.head.ref = change.branch; }],
  ['a base of main', (v) => { v.event.pull_request.base.ref = 'main'; }],
  ['the merged release branch', (v) => { v.releaseOpen = false; }],
  ['the next release while the open one is unmerged', (v) => { v.event.pull_request.base.ref = `release/r${String(Number(release.id.slice(1)) + 1).padStart(3, '0')}`; }],
  ['a commit titled otherwise', (v) => { v.commitTitles.push(change.title); }],
  ['a lower-case summary', (v) => { v.event.pull_request.title = '[PLAN] queue a new task'; v.commitTitles = [v.event.pull_request.title]; }],
  ['a recycled delivered ID', (v) => { v.headPlan = withTask('ML-002'); }],
  ['a retired ID brought back', (v) => { v.basePlan = plan.replace(/^(\*\*Highest ID ever used:\*\* )ML-\d{3}/m, `$1${nextId}`); }],
  ['a falling mark', (v) => { v.headPlan = withTask(nextId, 'ML-002'); }],
])('plan event validation rejects %s', (_name, corrupt) => {
  const v = planFixture(); corrupt(v); expect(() => checkEvent(change, v)).toThrow();
});
test('event validation accepts the release PR into main', () => expect(() => checkEvent(change, releaseFixture())).not.toThrow());
test('release event validation skips plan-only squash commits', () => {
  const v = releaseFixture(); v.commitTitles.splice(1, 0, '[PLAN] Queue a new task (#150)'); expect(() => checkEvent(change, v)).not.toThrow();
});
test('release event validation accepts squash commits without a PR suffix', () => {
  const v = releaseFixture(); v.commitTitles = v.commitTitles.map((t, i) => (i % 2 ? t.replace(/ \(#\d+\)$/, '') : t));
  v.commitTitles.splice(1, 0, '[PLAN] Queue a new task'); expect(() => checkEvent(change, v)).not.toThrow();
});
test.each([
  ['checkout merge revision', (v) => { v.actualHead = 'c'.repeat(40); }],
  ['wrong PR title', (v) => { v.event.pull_request.title = `[${change.id}] [${change.type}] Wrong task`; }],
  ['wrong PR base', (v) => { v.event.pull_request.base.ref = 'dev'; }],
  ['task PR straight into main', (v) => { v.event.pull_request.base.ref = 'main'; }],
  ['wrong PR branch', (v) => { v.event.pull_request.head.ref = 'main'; }],
  ['unscoped commit', (v) => { v.commitTitles.push('Unrelated cleanup'); }],
  ['historical change edited', (v) => { v.changedFiles.push('docs/changes/ML-001.md'); }],
  ['release membership not recorded', (v) => { v.changedFiles = v.changedFiles.filter((f) => f !== 'config/release.json'); }],
  ['a push event', (v) => { v.eventName = 'push'; }],
])('event validation rejects %s', (_name, corrupt) => {
  const v = eventFixture(); corrupt(v); expect(() => checkEvent(change, v)).toThrow();
});
test.each([
  ['a release PR into another release', (v) => { v.event.pull_request.base.ref = 'release/r999'; }],
  ['an unnamed release PR', (v) => { v.event.pull_request.title = change.title; }],
  ['an unsquashed commit', (v) => { v.commitTitles.unshift(change.title); }],
  ['a missing task commit', (v) => { v.commitTitles.pop(); }],
  ['an unlisted task commit', (v) => { v.commitTitles.unshift(`[${nextId}] [FIX] Unlisted task (#151)`); }],
  ['a malformed plan commit', (v) => { v.commitTitles.unshift('[PLAN] queue a new task (#150)'); }],
  ['a commit retitled away from its record', (v) => { v.taskTitles[0] = `[${release.tasks[0]}] [FIX] Another title`; }],
])('release event validation rejects %s', (_name, corrupt) => {
  const v = releaseFixture(); corrupt(v); expect(() => checkEvent(change, v)).toThrow();
});

const entry = { id: 'r001', pr: 40, testedHead: 'b'.repeat(40), mainHead: 'c'.repeat(40) };
const fakeGit = (trees, fetched = entry.testedHead) => (...args) => {
  if (args[0] === 'rev-parse') return args[1] === 'FETCH_HEAD' ? fetched : trees[args[1]];
  return '';
};
test('release evidence accepts a main tree equal to the tested tree', () => {
  expect(() => checkReleaseTrees([entry], fakeGit({ [`${'b'.repeat(40)}^{tree}`]: 't1', [`${'c'.repeat(40)}^{tree}`]: 't1' }))).not.toThrow();
});
test.each([
  ['a main tree that differs', fakeGit({ [`${'b'.repeat(40)}^{tree}`]: 't1', [`${'c'.repeat(40)}^{tree}`]: 't2' })],
  ['a PR head that is not the tested head', fakeGit({ [`${'b'.repeat(40)}^{tree}`]: 't1', [`${'c'.repeat(40)}^{tree}`]: 't1' }, 'd'.repeat(40))],
])('release evidence rejects %s', (_name, git) => expect(() => checkReleaseTrees([entry], git)).toThrow());
