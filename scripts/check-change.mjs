import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkNewIds, checkQueue } from './check-queue.mjs';

export const sections = ['Change', 'Reason', 'Impact', 'Risk', 'Controls', 'Validation', 'Evidence', 'Source', 'Release'];
export const demand = (ok, message) => { if (!ok) throw new Error(message); };
export const readJson = (root, file) => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
export const sha = /^[a-f0-9]{40}$/;
// Release protocol cut-over: tasks up to ML-030 merged straight into main; later tasks squash into an open release/rNNN branch.
export const lastMainCiDelivery = 30;
// The release ruleset allows only squash merges, so the " (#PR)" suffix is optional: a REST squash given an explicit subject omits it.
const squashTitle = /^(\[(ML-\d{3})\] \[(?:FEATURE|FIX|DOCS|CHORE|REFACTOR|TEST|SECURITY)\] [A-Z][^\r\n]+?)(?: \(#\d+\))?$/;
// A plan-only PR takes no task ID: it edits implementation_plan.md alone and never joins a release's task list.
export const planTitle = /^\[PLAN\] [A-Z][^\r\n]+$/;
export const planBranch = /^plan-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const planSquash = /^\[PLAN\] [A-Z][^\r\n]+?(?: \(#\d+\))?$/;
// A plan PR targets the open release branch. Once that release has merged, its branch is deleted but
// config/release.json still names it until the next task, so a plan PR then targets the next branch instead.
export const planBase = (release, releaseOpen) => releaseOpen ? release.branch
  : `release/r${String(Number(release.id.slice(1)) + 1).padStart(3, '0')}`;
export const releaseTitle = (release) => `[RELEASE] ${release.id}: ${release.tasks.length === 1
  ? release.tasks[0] : `${release.tasks[0]}..${release.tasks.at(-1)}`}`;
export function checkSections(text) {
  const headings = [...text.matchAll(/^## (.+)\r?$/gm)];
  demand(JSON.stringify(headings.map((m) => m[1])) === JSON.stringify(sections), 'Change record sections disagree');
  headings.forEach((h, i) => demand(text.slice(h.index + h[0].length, headings[i + 1]?.index).trim(), `Empty ${h[1]} section`));
}

export function checkChange(root) {
  const change = readJson(root, 'config/change.json');
  demand(JSON.stringify(Object.keys(change).sort()) === JSON.stringify(['branch', 'id', 'title', 'type']), 'Controlled change fields disagree; bootstrap is closed');
  demand(/^ML-\d{3}$/.test(change.id) && /^(FEATURE|FIX|DOCS|CHORE|REFACTOR|TEST|SECURITY)$/.test(change.type), 'Malformed controlled change ID/type');
  const number = Number(change.id.slice(3));
  demand(number >= 2, 'Task must be a post-bootstrap ID');
  demand(new RegExp(`^\\[${change.id}\\] \\[${change.type}\\] [A-Z][^\\r\\n]+$`).test(change.title), 'Malformed controlled change title');
  demand(new RegExp(`^${change.id.toLowerCase()}-[a-z0-9]+(?:-[a-z0-9]+)*$`).test(change.branch), 'Controlled branch identity disagrees');
  checkQueue(root);
  checkRelease(root, change);
  return change;
}

// config/release.json names the open release branch and its tasks, ending at the current task.
// GitHub's merged release PRs and checks are the release record; the repository keeps no ledger.
export function checkRelease(root, change) {
  const release = readJson(root, 'config/release.json');
  demand(JSON.stringify(Object.keys(release).sort()) === '["branch","id","tasks"]' && /^r\d{3}$/.test(release.id)
    && release.branch === `release/${release.id}`, 'Release identity disagrees');
  const ids = release.tasks;
  demand(Array.isArray(ids) && ids.length > 0 && ids.at(-1) === change.id && new Set(ids).size === ids.length
    && ids.every((id) => /^ML-\d{3}$/.test(id) && Number(id.slice(3)) > lastMainCiDelivery), 'Release task chain disagrees');
  return release;
}

export function checkEvent(change, context) {
  const { eventName, event, actualHead, commitTitles, changedFiles, release, releaseOpen, basePlan, headPlan } = context;
  demand(sha.test(actualHead), 'Actual checkout SHA is invalid');
  demand(eventName === 'pull_request', 'Change identity runs only on pull requests');
  const pr = event.pull_request;
  demand(event.repository?.full_name === 'Wizard-Gang/MapLab' && pr?.base?.repo?.full_name === 'Wizard-Gang/MapLab', 'PR repository disagrees');
  demand(sha.test(pr.base.sha) && pr.head.sha === actualHead, 'PR base/head differs from tested checkout');
  checkSections(pr.body ?? '');
  demand(commitTitles.length > 0, 'Commit title differs from controlled task');
  checkNewIds(basePlan, headPlan);
  if (pr.head.ref === release.branch) {
    // The release PR carries one squash commit per listed task, oldest first, plus any plan-only squash
    // commits, which belong to no task.
    demand(pr.base.ref === 'main' && pr.title === releaseTitle(release), 'Release PR base/title disagrees');
    const titles = [...commitTitles].reverse().filter((title) => !planSquash.test(title)).map((title) => title.match(squashTitle));
    demand(titles.length === release.tasks.length && titles.every((m, i) => m?.[2] === release.tasks[i]), 'Release commits must be one squash commit per listed task');
    return;
  }
  if (planTitle.test(pr.title)) {
    demand(pr.base.ref === planBase(release, releaseOpen), 'Plan PR base must be the open release branch, or the next once it has merged');
    demand(planBranch.test(pr.head.ref), 'Plan PR branch must be plan-<summary>');
    demand(commitTitles.every((title) => title === pr.title), 'Commit title differs from plan PR');
    demand(changedFiles.length === 1 && changedFiles[0] === 'implementation_plan.md', 'A plan PR changes implementation_plan.md alone');
    return;
  }
  demand(pr.base.ref === release.branch, 'Task PR base must be the open release branch');
  demand(pr.head.ref === change.branch && pr.title === change.title, 'PR controlled branch/title disagrees');
  demand(commitTitles.every((title) => title === change.title), 'Commit title differs from controlled task');
  demand(['config/change.json', 'config/release.json', 'implementation_plan.md'].every((f) => changedFiles.includes(f)),
    'Delivery must update the controlled queue and release');
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
      const release = checkRelease(root, change);
      const base = event.pull_request?.base?.sha;
      demand(sha.test(base ?? '') && !/^0+$/.test(base), 'Missing post-bootstrap base revision');
      git('merge-base', '--is-ancestor', base, 'HEAD');
      const plan = (revision) => git('show', `${revision}:implementation_plan.md`);
      // Any fetch failure counts as merged, which only narrows a plan PR to the next branch: it fails closed.
      const releaseOpen = event.pull_request.base.ref === release.branch || (() => {
        try { git('fetch', '--no-tags', '--quiet', 'origin', `refs/heads/${release.branch}`); return true; } catch { return false; }
      })();
      checkEvent(change, {
        eventName: process.env.GITHUB_EVENT_NAME, event, actualHead: git('rev-parse', 'HEAD'), release, releaseOpen,
        basePlan: plan(base), headPlan: plan('HEAD'),
        commitTitles: git('log', '--format=%s', `${base}..HEAD`).split('\n'),
        changedFiles: git('diff', '--name-only', base, 'HEAD').split('\n'),
      });
    }
    console.log(`Controlled change verified: ${change.id}; bootstrap closed`);
  } catch (error) { console.error(`Change rejected: ${error.message}`); process.exitCode = 1; }
}
