import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkQueue } from './check-queue.mjs';

export const sections = ['Change', 'Reason', 'Impact', 'Risk', 'Controls', 'Validation', 'Evidence', 'Source', 'Release'];
export const demand = (ok, message) => { if (!ok) throw new Error(message); };
export const readJson = (root, file) => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
export const sha = /^[a-f0-9]{40}$/;
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
  demand(number >= 2 && number <= 44, 'Task must be a reserved post-bootstrap ID');
  demand(new RegExp(`^\\[${change.id}\\] \\[${change.type}\\] [A-Z][^\\r\\n]+$`).test(change.title), 'Malformed controlled change title');
  demand(new RegExp(`^${change.id.toLowerCase()}-[a-z0-9]+(?:-[a-z0-9]+)*$`).test(change.branch), 'Controlled branch identity disagrees');
  demand(change.record === `docs/changes/${change.id}.md` && existsSync(resolve(root, change.record)), 'Change record identity disagrees');
  const record = read(change.record);
  demand(record.startsWith(`# ${change.title}\n`), 'Change record title disagrees');
  checkSections(record);
  checkQueue(root);
  const deliveries = readJson(root, 'docs/deliveries.json');
  demand(Array.isArray(deliveries) && deliveries.length === number - 1, 'Predecessor delivery chain is incomplete');
  for (const [i, entry] of deliveries.entries()) {
    demand(entry.id === `ML-${String(i + 1).padStart(3, '0')}` && sha.test(entry.commit), 'Predecessor ID/commit disagrees');
    demand(entry.mainCi?.conclusion === 'success' && entry.mainCi.head === entry.commit
      && /^https:\/\/github\.com\/Wizard-Gang\/MapLab\/actions\/runs\/\d+$/.test(entry.mainCi.url), 'Predecessor main CI evidence disagrees');
    demand(existsSync(resolve(root, `docs/changes/${entry.id}.md`)), 'Predecessor change record is missing');
    if (i === 0) demand(entry.commit === 'b0b1ff57859371be5aef7071394cb50c405d4794' && entry.pr === null, 'Historical bootstrap evidence disagrees');
    else demand(Number.isSafeInteger(entry.pr) && entry.pr > 0 && entry.testedHeads?.length > 0
      && entry.testedHeads.every((h) => sha.test(h)), 'Predecessor PR/head evidence is missing');
  }
  return change;
}

export function checkEvent(change, context) {
  const { eventName, event, actualHead, actualBranch, commitTitles, changedFiles } = context;
  demand(sha.test(actualHead), 'Actual checkout SHA is invalid');
  if (eventName === 'pull_request') {
    const pr = event.pull_request;
    demand(event.repository?.full_name === 'Wizard-Gang/MapLab' && pr?.base?.repo?.full_name === 'Wizard-Gang/MapLab', 'PR repository disagrees');
    demand(pr.base.ref === 'main' && sha.test(pr.base.sha) && pr.head.sha === actualHead, 'PR base/head differs from tested checkout');
    demand(pr.head.ref === change.branch && pr.title === change.title, 'PR controlled branch/title disagrees');
    checkSections(pr.body ?? '');
  } else {
    demand(eventName === 'push' && event.repository?.full_name === 'Wizard-Gang/MapLab'
      && event.after === actualHead && event.deleted === false, 'Push event differs from tested checkout');
    demand(event.ref === `refs/heads/${actualBranch}` && [change.branch, 'main'].includes(actualBranch), 'Push controlled branch disagrees');
  }
  demand(commitTitles.length > 0 && commitTitles.every((title) => title === change.title
    || (actualBranch === 'main' && title.startsWith(`${change.title} (#`) && / \(#\d+\)$/.test(title))), 'Commit title differs from controlled task');
  demand(changedFiles.includes('config/change.json') && changedFiles.includes(change.record)
    && changedFiles.includes('implementation_plan.md'), 'Delivery must update controlled queue and change record');
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
      const eventName = process.env.GITHUB_EVENT_NAME;
      const base = eventName === 'pull_request' ? event.pull_request?.base?.sha
        : event.ref === 'refs/heads/main' ? event.before : readJson(root, 'docs/deliveries.json').at(-1).commit;
      demand(sha.test(base ?? '') && !/^0+$/.test(base), 'Missing post-bootstrap base revision');
      git('merge-base', '--is-ancestor', base, 'HEAD');
      checkEvent(change, {
        eventName, event, actualHead: git('rev-parse', 'HEAD'),
        actualBranch: eventName === 'pull_request' ? event.pull_request.head.ref : process.env.GITHUB_REF_NAME,
        commitTitles: git('log', '--format=%s', `${base}..HEAD`).split('\n'),
        changedFiles: git('diff', '--name-only', base, 'HEAD').split('\n'),
      });
    }
    console.log(`Controlled change verified: ${change.id}; bootstrap closed; predecessor evidence present`);
  } catch (error) { console.error(`Change rejected: ${error.message}`); process.exitCode = 1; }
}
