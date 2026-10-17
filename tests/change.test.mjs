import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';
import { requiredFiles } from '../scripts/check-foundation.mjs';
import { checkEvent, sections } from '../scripts/check-change.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = [];
const change = JSON.parse(readFileSync(join(root, 'config/change.json')));
const history = JSON.parse(readFileSync(join(root, 'docs/deliveries.json')));
const currentNumber = Number(change.id.slice(3));
const otherId = currentNumber < 44 ? `ML-${String(currentNumber + 1).padStart(3, '0')}` : 'ML-043';
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
test('real CLI accepts another reserved task without a fixed current identity', () => {
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
    if (currentNumber === 44) v.pop();
    else v.push({ id: change.id, pr: 1, commit: 'a'.repeat(40), testedHeads: ['b'.repeat(40)], mainCi: { head: 'a'.repeat(40), conclusion: 'success', url: 'https://github.com/Wizard-Gang/MapLab/actions/runs/1' } });
  });
  const result = run(p); expect(result.status, result.stderr).toBe(0);
});
test.each([
  ['bootstrap reuse', (p) => json(p, 'config/change.json', (v) => { v.bootstrap = 'empty-repository-root-commit'; }), 'bootstrap is closed'],
  ['root task reuse', (p) => json(p, 'config/change.json', (v) => { v.id = 'ML-001'; }), 'post-bootstrap'],
  ['unreserved ID', (p) => json(p, 'config/change.json', (v) => { v.id = 'ML-999'; }), 'post-bootstrap'],
  ['wrong branch', (p) => json(p, 'config/change.json', (v) => { v.branch = 'main'; }), 'branch identity'],
  ['record path escape', (p) => json(p, 'config/change.json', (v) => { v.record = '../ML-002.md'; }), 'record identity'],
  ['record title mismatch', (p) => edit(p, change.record, (s) => s.replace(`# ${change.title}`, '# Mismatched record title')), 'record title'],
  ['missing record section', (p) => edit(p, change.record, (s) => s.replace('## Controls', '## Control')), 'sections disagree'],
  ['duplicate future ID', (p) => edit(p, 'implementation_plan.md', (s) => s.replace('### ML-003 /', '### ML-002 /')), 'Reserved future tasks'],
  ['queue mismatch', (p) => edit(p, 'implementation_plan.md', (s) => s.replace(`### ${change.id} /`, `### ${otherId} /`)), 'Active queue'],
  ['missing predecessor', (p) => writeFileSync(join(p, 'docs/deliveries.json'), '[]\n'), 'Predecessor delivery chain'],
  ['failed predecessor CI', (p) => json(p, 'docs/deliveries.json', (v) => { v[0].mainCi.conclusion = 'failure'; }), 'main CI evidence'],
  ['different predecessor SHA', (p) => json(p, 'docs/deliveries.json', (v) => { v[0].mainCi.head = 'f'.repeat(40); }), 'main CI evidence'],
])('real CLI rejects %s', (_name, corrupt, message) => {
  const p = fixture(); corrupt(p); const result = run(p);
  expect(result.status).toBe(1); expect(result.stderr).toContain(message);
});

function eventFixture() {
  return { eventName: 'pull_request', actualHead: 'b'.repeat(40), actualBranch: change.branch,
    commitTitles: [change.title], changedFiles: ['config/change.json', change.record, 'implementation_plan.md'],
    event: { repository: { full_name: 'Wizard-Gang/MapLab' }, pull_request: {
      title: change.title, body: sections.map((s) => `## ${s}\n\nFixture prose.\n`).join('\n'),
      head: { sha: 'b'.repeat(40), ref: change.branch },
      base: { ref: 'main', sha: 'a'.repeat(40), repo: { full_name: 'Wizard-Gang/MapLab' } },
    } },
  };
}
test('event validation accepts a current PR', () => expect(() => checkEvent(change, eventFixture())).not.toThrow());
test.each([
  ['checkout merge revision', (v) => { v.actualHead = 'c'.repeat(40); }],
  ['wrong PR title', (v) => { v.event.pull_request.title = '[ML-003] [FEATURE] Wrong task'; }],
  ['wrong PR base', (v) => { v.event.pull_request.base.ref = 'dev'; }],
  ['wrong PR branch', (v) => { v.event.pull_request.head.ref = 'main'; }],
  ['unscoped commit', (v) => { v.commitTitles.push('Unrelated cleanup'); }],
  ['historical change edited', (v) => { v.changedFiles.push('docs/changes/ML-001.md'); }],
])('event validation rejects %s', (_name, corrupt) => {
  const v = eventFixture(); corrupt(v); expect(() => checkEvent(change, v)).toThrow();
});
