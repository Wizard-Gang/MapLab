import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkNewIds, checkQueue } from './check-queue.mjs';

export const sections = ['Change', 'Reason', 'Impact', 'Risk', 'Controls', 'Validation', 'Evidence', 'Source', 'Release'];
export const demand = (ok, message) => { if (!ok) throw new Error(message); };
export const readJson = (root, file) => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
export const sha = /^[a-f0-9]{40}$/;
// Release protocol cut-over: deliveries up to ML-030 carry main CI evidence. Later tasks squash into an open
// release/rNNN branch on the fast gate, so they carry that PR's exact-head `gate` run instead.
export const lastMainCiDelivery = 30;
const runUrl = /^https:\/\/github\.com\/Wizard-Gang\/MapLab\/actions\/runs\/\d+$/;
const taskId = (n) => `ML-${String(n).padStart(3, '0')}`;
const squashTitle = /^(\[(ML-\d{3})\] \[(?:FEATURE|FIX|DOCS|CHORE|REFACTOR|TEST|SECURITY)\] [A-Z][^\r\n]+) \(#\d+\)$/;
// A plan-only PR takes no task ID: it edits implementation_plan.md alone and never joins a release's task list.
export const planTitle = /^\[PLAN\] [A-Z][^\r\n]+$/;
export const planBranch = /^plan-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const planSquash = /^\[PLAN\] [A-Z][^\r\n]+ \(#\d+\)$/;
// A plan PR targets the open release branch. Once that release has merged, config/release.json still names it
// until the next task cuts the next one, so a plan PR may target that next branch instead.
export const planBases = (release, releases) => releases.some((entry) => entry.id === release.id)
  ? [release.branch, `release/r${String(Number(release.id.slice(1)) + 1).padStart(3, '0')}`] : [release.branch];
export const releaseTitle = (release) => `[RELEASE] ${release.id}: ${release.tasks.length === 1
  ? release.tasks[0] : `${release.tasks[0]}..${release.tasks.at(-1)}`}`;
export function checkSections(text) {
  const headings = [...text.matchAll(/^## (.+)\r?$/gm)];
  demand(JSON.stringify(headings.map((m) => m[1])) === JSON.stringify(sections), 'Change record sections disagree');
  headings.forEach((h, i) => demand(text.slice(h.index + h[0].length, headings[i + 1]?.index).trim(), `Empty ${h[1]} section`));
}

export function checkChange(root) {
  const read = (file) => readFileSync(resolve(root, file), 'utf8');
  const change = readJson(root, 'config/change.json');
  demand(JSON.stringify(Object.keys(change).sort()) === JSON.stringify(['branch', 'id', 'record', 'title', 'type']), 'Controlled change fields disagree; bootstrap is closed');
  demand(/^ML-\d{3}$/.test(change.id) && /^(FEATURE|FIX|DOCS|CHORE|REFACTOR|TEST|SECURITY)$/.test(change.type), 'Malformed controlled change ID/type');
  const number = Number(change.id.slice(3));
  demand(number >= 2, 'Task must be a post-bootstrap ID');
  demand(new RegExp(`^\\[${change.id}\\] \\[${change.type}\\] [A-Z][^\\r\\n]+$`).test(change.title), 'Malformed controlled change title');
  demand(new RegExp(`^${change.id.toLowerCase()}-[a-z0-9]+(?:-[a-z0-9]+)*$`).test(change.branch), 'Controlled branch identity disagrees');
  demand(change.record === `docs/changes/${change.id}.md` && existsSync(resolve(root, change.record)), 'Change record identity disagrees');
  const record = read(change.record);
  demand(record.startsWith(`# ${change.title}\n`), 'Change record title disagrees');
  checkSections(record);
  checkQueue(root);
  const { release, releases } = checkRelease(root, change);
  // Delivery order, not ID order: ML-001..ML-030, then every released task before the current one.
  const delivered = [...Array.from({ length: lastMainCiDelivery }, (_, i) => taskId(i + 1)),
    ...[...releases.map((entry) => entry.tasks), release.tasks].flat().slice(0, -1)];
  const deliveries = readJson(root, 'docs/deliveries.json');
  demand(Array.isArray(deliveries) && JSON.stringify(deliveries.map((entry) => entry.id)) === JSON.stringify(delivered),
    'Predecessor delivery chain is incomplete');
  for (const [i, entry] of deliveries.entries()) {
    demand(sha.test(entry.commit), 'Predecessor ID/commit disagrees');
    if (i < lastMainCiDelivery) demand(entry.gate === undefined && entry.mainCi?.conclusion === 'success'
      && entry.mainCi.head === entry.commit && runUrl.test(entry.mainCi.url), 'Predecessor main CI evidence disagrees');
    else demand(entry.mainCi === undefined && entry.gate?.conclusion === 'success'
      && entry.gate.head === entry.testedHeads?.at(-1) && runUrl.test(entry.gate.url), 'Predecessor release gate evidence disagrees');
    demand(existsSync(resolve(root, `docs/changes/${entry.id}.md`)), 'Predecessor change record is missing');
    if (i === 0) demand(entry.commit === 'b0b1ff57859371be5aef7071394cb50c405d4794' && entry.pr === null, 'Historical bootstrap evidence disagrees');
    else demand(Number.isSafeInteger(entry.pr) && entry.pr > 0 && entry.testedHeads?.length > 0
      && entry.testedHeads.every((h) => sha.test(h)), 'Predecessor PR/head evidence is missing');
  }
  return change;
}

// config/release.json names the open release branch and its tasks; docs/releases.json records each one
// rebase-merged into main. Together they list each task delivered after the cut-over once, ending at the current task.
export function checkRelease(root, change) {
  const release = readJson(root, 'config/release.json');
  const releases = readJson(root, 'docs/releases.json');
  demand(JSON.stringify(Object.keys(release).sort()) === '["branch","id","tasks"]' && /^r\d{3}$/.test(release.id)
    && release.branch === `release/${release.id}`, 'Release identity disagrees');
  demand(Array.isArray(releases) && Number(release.id.slice(1)) === releases.length + 1, 'Release chain is incomplete');
  for (const [i, entry] of releases.entries()) {
    demand(JSON.stringify(Object.keys(entry).sort()) === '["ci","id","mainHead","pr","tasks","testedHead"]'
      && entry.id === `r${String(i + 1).padStart(3, '0')}` && Number.isSafeInteger(entry.pr) && entry.pr > 0
      && sha.test(entry.testedHead) && sha.test(entry.mainHead)
      && entry.ci?.conclusion === 'success' && runUrl.test(entry.ci.url), 'Release evidence disagrees');
  }
  const chain = [...releases.map((entry) => entry.tasks), release.tasks];
  const ids = chain.flat();
  demand(chain.every((tasks) => Array.isArray(tasks) && tasks.length > 0) && ids.at(-1) === change.id
    && new Set(ids).size === ids.length
    && ids.every((id) => /^ML-\d{3}$/.test(id) && Number(id.slice(3)) > lastMainCiDelivery), 'Release task chain disagrees');
  for (const id of release.tasks) demand(existsSync(resolve(root, `docs/changes/${id}.md`)), 'Release task record is missing');
  return { release, releases };
}

// A rebase rewrites SHAs, so a release's evidence is that main's tree equals the tree its full run tested.
export function checkReleaseTrees(releases, git) {
  for (const entry of releases) {
    git('fetch', '--no-tags', '--quiet', 'origin', `refs/pull/${entry.pr}/head`);
    demand(git('rev-parse', 'FETCH_HEAD') === entry.testedHead
      && git('rev-parse', `${entry.mainHead}^{tree}`) === git('rev-parse', `${entry.testedHead}^{tree}`),
    `Release ${entry.id} main tree differs from its tested head`);
    git('merge-base', '--is-ancestor', entry.mainHead, 'HEAD');
  }
}

export function checkEvent(change, context) {
  const { eventName, event, actualHead, commitTitles, changedFiles, release, releases, taskTitles, basePlan, headPlan } = context;
  demand(sha.test(actualHead), 'Actual checkout SHA is invalid');
  demand(eventName === 'pull_request', 'Change identity runs only on pull requests');
  const pr = event.pull_request;
  demand(event.repository?.full_name === 'Wizard-Gang/MapLab' && pr?.base?.repo?.full_name === 'Wizard-Gang/MapLab', 'PR repository disagrees');
  demand(sha.test(pr.base.sha) && pr.head.sha === actualHead, 'PR base/head differs from tested checkout');
  checkSections(pr.body ?? '');
  demand(commitTitles.length > 0, 'Commit title differs from controlled task');
  checkNewIds(basePlan, headPlan);
  if (pr.head.ref === release.branch) {
    // The release PR carries one squash commit per listed task, oldest first, each titled as its record,
    // plus any plan-only squash commits, which belong to no task.
    demand(pr.base.ref === 'main' && pr.title === releaseTitle(release), 'Release PR base/title disagrees');
    const titles = [...commitTitles].reverse().filter((title) => !planSquash.test(title)).map((title) => title.match(squashTitle));
    demand(titles.length === release.tasks.length && titles.every((m, i) => m?.[2] === release.tasks[i]
      && m[1] === taskTitles[i]), 'Release commits must be one squash commit per listed task');
    return;
  }
  if (planTitle.test(pr.title)) {
    demand(planBases(release, releases).includes(pr.base.ref), 'Plan PR base must be the open or next release branch');
    demand(planBranch.test(pr.head.ref), 'Plan PR branch must be plan-<summary>');
    demand(commitTitles.every((title) => title === pr.title), 'Commit title differs from plan PR');
    demand(changedFiles.length === 1 && changedFiles[0] === 'implementation_plan.md', 'A plan PR changes implementation_plan.md alone');
    return;
  }
  demand(pr.base.ref === release.branch, 'Task PR base must be the open release branch');
  demand(pr.head.ref === change.branch && pr.title === change.title, 'PR controlled branch/title disagrees');
  demand(commitTitles.every((title) => title === change.title), 'Commit title differs from controlled task');
  demand(['config/change.json', 'config/release.json', change.record, 'implementation_plan.md'].every((f) => changedFiles.includes(f)),
    'Delivery must update controlled queue, release and change record');
  demand(!changedFiles.some((f) => /^docs\/changes\/ML-\d{3}\.md$/.test(f) && f !== change.record), 'Delivery modifies another task record');
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  try {
    const args = process.argv.slice(2);
    demand(args.length === 0 || (args.length === 2 && args[0] === '--root'), 'Usage: check-change.mjs [--root directory]');
    const root = args[1] ? resolve(args[1]) : resolve(dirname(self), '..');
    const change = checkChange(root);
    if (process.env.GITHUB_EVENT_PATH) {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
      const { release, releases } = checkRelease(root, change);
      const base = event.pull_request?.base?.sha;
      demand(sha.test(base ?? '') && !/^0+$/.test(base), 'Missing post-bootstrap base revision');
      git('merge-base', '--is-ancestor', base, 'HEAD');
      const plan = (revision) => git('show', `${revision}:implementation_plan.md`);
      checkReleaseTrees(releases, git);
      checkEvent(change, {
        eventName: process.env.GITHUB_EVENT_NAME, event, actualHead: git('rev-parse', 'HEAD'), release, releases,
        basePlan: plan(base), headPlan: plan('HEAD'),
        taskTitles: release.tasks.map((id) => readFileSync(resolve(root, `docs/changes/${id}.md`), 'utf8').split('\n')[0].slice(2)),
        commitTitles: git('log', '--format=%s', `${base}..HEAD`).split('\n'),
        changedFiles: git('diff', '--name-only', base, 'HEAD').split('\n'),
      });
    }
    console.log(`Controlled change verified: ${change.id}; bootstrap closed; predecessor evidence present`);
  } catch (error) { console.error(`Change rejected: ${error.message}`); process.exitCode = 1; }
}
