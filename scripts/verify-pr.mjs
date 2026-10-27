import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demand, sha, readJson, checkChange, checkSections, releaseTitle, planTitle, planBranch, planBase } from './check-change.mjs';
import { ghApi, optionalGhApi, readPolicy } from './repository-policy.mjs';

// Release protocol: task PRs merge into the open release branch on the fast gate; only its release PR reaches main.
export function requiredChecksFor(base) {
  if (base === 'main') return ['verify', 'change-id', 'security'];
  demand(/^release\/r\d{3}$/.test(base), `No delivery path into ${base}`);
  return ['gate', 'change-id'];
}

export function requiredContexts(effective, branchProtection) {
  const requirements = effective.filter((r) => r.type === 'required_status_checks')
    .flatMap((r) => r.parameters.required_status_checks.map((c) => ({ name: c.context, appId: c.integration_id ?? null })));
  const legacy = branchProtection?.required_status_checks;
  for (const c of legacy?.checks ?? []) requirements.push({ name: c.context, appId: c.app_id ?? null });
  for (const name of legacy?.contexts ?? []) {
    if (!requirements.some((r) => r.name === name)) requirements.push({ name, appId: null });
  }
  demand(requirements.length > 0 && requirements.every((r) => typeof r.name === 'string' && r.name.length > 0), 'Effective required checks are missing/malformed');
  return [...new Map(requirements.map((r) => [`${r.name}:${r.appId}`, r])).values()];
}

export function checkHeadChecks(checks, head, appId, requirements = ['verify', 'change-id', 'security'].map((name) => ({ name, appId })), statuses = []) {
  const evidence = [];
  for (const { name, appId: requiredApp } of requirements) {
    const matchingStatuses = statuses.filter((s) => s.context === name);
    for (const status of matchingStatuses) {
      demand(status.state === 'success', `Required commit status is unsuccessful: ${name}`);
      evidence.push({ name, head, url: status.target_url, id: status.id });
    }
    const matching = checks.filter((c) => c.name === name && (requiredApp === null || c.app?.id === requiredApp));
    if (matching.length === 0 && requiredApp === null) {
      demand(matchingStatuses.length > 0, `Required commit status is missing: ${name}`);
      continue;
    }
    demand(matching.length > 0, `Missing current check: ${name}`);
    // A PR body edit can cancel an older workflow attempt on the same SHA.
    // GitHub's filter=latest still returns both check runs, so identify the
    // current run by immutable provider ID instead of rejecting old history.
    // Ambiguous duplicates fail closed; skipped/pending/failed *current* runs
    // remain hard failures. Do not trust array ordering from the provider.
    demand(matching.length === 1 || matching.every((c) => Number.isSafeInteger(c.id) && c.id > 0),
      `Ambiguous same-name check history: ${name}`);
    const current = matching.reduce((latest, c) => !latest || c.id > latest.id ? c : latest, null);
    demand(current.head_sha === head && current.status === 'completed' && current.conclusion === 'success',
      `Check is not successful on exact current head: ${name}`);
    evidence.push({ name, head: current.head_sha, url: current.html_url, id: current.id });
  }
  return evidence;
}

export function verifyPr(root, number, head) {
  demand(Number.isSafeInteger(number) && number > 0 && sha.test(head), 'PR number/head required');
  const change = checkChange(root);
  const release = readJson(root, 'config/release.json');
  const p = readJson(root, 'config/github-repository-settings.json');
  const policy = readPolicy(p); // A plan/access failure blocks delivery, never bypasses policy.
  const prefix = `repos/${p.repository}`;
  const pr = ghApi(`${prefix}/pulls/${number}`);
  const base = pr.base.ref;
  const releasing = pr.head.ref === release.branch;
  const planning = planTitle.test(pr.title);
  demand(pr.state === 'open' && pr.draft === false && pr.head.sha === head && (releasing
    ? base === 'main' && pr.title === releaseTitle(release)
    : planning ? base === planBase(release, optionalGhApi(`${prefix}/git/ref/heads/${release.branch}`) !== null) && planBranch.test(pr.head.ref)
      : base === release.branch && pr.head.ref === change.branch && pr.title === change.title), 'PR identity/state/head differs');
  checkSections(pr.body ?? '');
  demand(pr.body.includes(head), 'PR must record exact tested head');
  const tip = ghApi(`${prefix}/git/ref/heads/${base}`).object.sha;
  const compare = ghApi(`${prefix}/compare/${tip}...${head}`);
  demand(compare.behind_by === 0 && compare.ahead_by > 0 && compare.status === 'ahead', `PR is not current with ${base}`);
  demand(pr.mergeable === true && pr.mergeable_state === 'clean', 'Provider has not confirmed all merge/review requirements');
  const response = ghApi(`${prefix}/commits/${head}/check-runs?filter=latest&per_page=100`);
  demand(response.total_count <= 100, 'Check pagination requires explicit inspection');
  const status = ghApi(`${prefix}/commits/${head}/status?per_page=100`);
  demand(status.sha === head && status.total_count <= 100, 'Status SHA/pagination requires explicit inspection');
  const required = base === 'main' ? requiredContexts(policy.effectiveMain, policy.branchProtection)
    : requiredContexts(ghApi(`${prefix}/rules/branches/${base}`), optionalGhApi(`${prefix}/branches/${base}/protection`));
  demand(requiredChecksFor(base).every((name) => required.some((r) => r.name === name)), `Live ${base} rules do not require its checks`);
  const checks = checkHeadChecks(response.check_runs, head, p.main.checksAppId, required, status.statuses);
  // Recheck identity after all read operations. Merge must still submit head as its SHA guard.
  demand(ghApi(`${prefix}/pulls/${number}`).head.sha === head && ghApi(`${prefix}/git/ref/heads/${base}`).object.sha === tip, `Head/${base} changed during evidence collection`);
  return { task: releasing ? release.id : planning ? pr.title : change.id, pr: pr.html_url, head, base, tip, checks, policy,
    mergeMethod: base === 'main' ? 'rebase' : 'squash', bypass: false };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  try {
    const args = process.argv.slice(2);
    demand(args.length === 4 && args[0] === '--pr' && args[2] === '--head', 'Usage: verify-pr.mjs --pr NUMBER --head SHA');
    console.log(JSON.stringify(verifyPr(resolve(dirname(self), '..'), Number(args[1]), args[3]), null, 2));
  } catch (error) { console.error(`Delivery rejected: ${error.message}`); process.exitCode = 1; }
}
