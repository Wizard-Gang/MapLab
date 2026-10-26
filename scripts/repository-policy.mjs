import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demand, readJson } from './check-change.mjs';

export function checkPolicyConfig(p) {
  demand(p.repository === 'Wizard-Gang/MapLab' && p.visibility === 'public' && p.defaultBranch === 'main', 'Repository policy identity disagrees');
  // Release protocol: task PRs squash into release/*, and release PRs rebase into main one commit per task.
  demand(p.merge?.allowSquashMerge === true && p.merge.allowMergeCommit === false
    && p.merge.allowRebaseMerge === true && p.merge.deleteBranchOnMerge === true, 'Squash-and-rebase merge policy disagrees');
  demand(p.main?.requirePullRequest === true && p.main.requireCurrentWithMain === true
    && p.main.requireExactHeadEvidence === true && p.main.allowDeletion === false && p.main.allowNonFastForward === false
    && JSON.stringify(p.main.requiredChecks) === '["verify","change-id","security"]'
    && JSON.stringify(p.main.bypassActors) === '[]' && p.main.requiredApprovingReviewCount === 0
    && p.main.checksAppId === 15368 && JSON.stringify(p.main.allowedMergeMethods) === '["rebase"]', 'Main required checks/no-bypass policy disagrees');
  demand(p.release?.pattern === 'refs/heads/release/*' && p.release.requirePullRequest === true
    && JSON.stringify(p.release.requiredChecks) === '["gate","change-id"]' && JSON.stringify(p.release.allowedMergeMethods) === '["squash"]'
    && JSON.stringify(p.release.bypassActors) === '[]' && p.release.allowDeletion === true && p.release.allowNonFastForward === false,
  'Release branch checks/no-bypass policy disagrees');
  demand(p.tags?.pattern === 'v*' && p.tags.immutable === true && JSON.stringify(p.tags.bypassActors) === '[]'
    && p.releases?.immutable === true, 'Tag/release immutability policy disagrees');
}

export function desiredRules(p) {
  checkPolicyConfig(p);
  const base = { enforcement: 'active', bypass_actors: [] };
  const pullRequest = (methods) => ({ type: 'pull_request', parameters: {
    required_approving_review_count: p.main.requiredApprovingReviewCount,
    dismiss_stale_reviews_on_push: true, require_code_owner_review: false,
    require_last_push_approval: false, required_review_thread_resolution: true,
    allowed_merge_methods: methods,
  } });
  const checks = (contexts, onCreate) => ({ type: 'required_status_checks', parameters: {
    strict_required_status_checks_policy: true, do_not_enforce_on_create: onCreate,
    required_status_checks: contexts.map((context) => ({ context, integration_id: p.main.checksAppId })),
  } });
  return [
    { ...base, name: 'MapLab main', target: 'branch',
      conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
      rules: [
        { type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'required_linear_history' },
        pullRequest(p.main.allowedMergeMethods), checks(p.main.requiredChecks, false),
      ],
    },
    { ...base, name: 'MapLab immutable versions', target: 'tag',
      conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
      // update_allows_fetch_and_merge is a branch-only option: GitHub stores tag
      // rulesets' update rule without parameters, so expecting it breaks read-back.
      rules: [{ type: 'update' }, { type: 'deletion' }],
    },
    // No deletion rule, so auto-delete removes a merged release branch. It is cut from main's tip by a
    // plain ref push, which carries no `gate` run, so its checks apply from the first PR on.
    { ...base, name: 'MapLab release', target: 'branch',
      conditions: { ref_name: { include: [p.release.pattern], exclude: [] } },
      rules: [{ type: 'non_fast_forward' }, pullRequest(p.release.allowedMergeMethods), checks(p.release.requiredChecks, true)],
    },
  ];
}

// Provider responses may add fields. Every desired field must match recursively;
// arrays of rules are sets by rule type, while required check arrays are sets by context.
export function requireMatch(actual, expected, at = 'policy') {
  if (Array.isArray(expected)) {
    demand(Array.isArray(actual) && actual.length === expected.length, `${at} array differs`);
    for (const item of expected) {
      const key = item?.type ? 'type' : item?.context ? 'context' : null;
      const found = key ? actual.find((a) => a[key] === item[key]) : actual[expected.indexOf(item)];
      requireMatch(found, item, at);
    }
  } else if (expected && typeof expected === 'object') {
    demand(actual && typeof actual === 'object', `${at} missing`);
    for (const [key, value] of Object.entries(expected)) requireMatch(actual[key], value, `${at}.${key}`);
  } else demand(actual === expected, `${at} differs: expected ${JSON.stringify(expected)}`);
}

export function ghApi(endpoint, method = 'GET', body) {
  const args = ['api', '-H', 'X-GitHub-Api-Version: 2022-11-28', endpoint, '--method', method];
  if (body !== undefined) args.push('--input', '-');
  const raw = execFileSync('gh', args, { encoding: 'utf8', input: body === undefined ? undefined : JSON.stringify(body), maxBuffer: 16 * 1024 * 1024 });
  return raw.trim() ? JSON.parse(raw) : null;
}

export function optionalGhApi(endpoint) {
  try { return ghApi(endpoint); }
  catch (error) {
    // Only an explicit provider 404 means no legacy protection. Access, plan and
    // transport errors remain blocking, even when managed rulesets match.
    let response;
    try { response = JSON.parse(error.stdout); } catch { /* fail closed below */ }
    if (String(response?.status) === '404') return null;
    throw error;
  }
}

export function readPolicy(p) {
  checkPolicyConfig(p);
  const prefix = `repos/${p.repository}`;
  const repo = ghApi(prefix);
  demand(repo.private === false && repo.visibility === p.visibility && repo.default_branch === 'main', 'Live repository must remain public on main');
  requireMatch(repo, { allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: true, delete_branch_on_merge: true }, 'repository');
  const summaries = ghApi(`${prefix}/rulesets?includes_parents=true&per_page=100`);
  demand(summaries.length < 100, 'Ruleset pagination requires explicit inspection');
  const rulesets = summaries.filter((s) => s.source === p.repository && s.source_type === 'Repository').map((s) => ghApi(`${prefix}/rulesets/${s.id}`));
  for (const desired of desiredRules(p)) {
    const matches = rulesets.filter((r) => r.name === desired.name);
    demand(matches.length === 1, `Missing/duplicate live ruleset: ${desired.name}`);
    requireMatch(matches[0], desired, desired.name);
  }
  const effectiveMain = ghApi(`${prefix}/rules/branches/main`);
  for (const rule of desiredRules(p)[0].rules) demand(effectiveMain.some((r) => r.type === rule.type), `Main does not enforce ${rule.type}`);
  const branchProtection = optionalGhApi(`${prefix}/branches/main/protection`);
  const releases = ghApi(`${prefix}/immutable-releases`);
  demand(releases.enabled === true, 'Live releases are not immutable');
  return { repository: p.repository, observedAt: new Date().toISOString(), repo, rulesets, inheritedRulesets: summaries.filter((s) => s.source_type !== 'Repository'), effectiveMain, branchProtection, releases };
}

export function applyPolicy(p) {
  checkPolicyConfig(p);
  const prefix = `repos/${p.repository}`;
  const repo = ghApi(prefix);
  demand(repo.private === false && repo.visibility === p.visibility && repo.default_branch === 'main', 'Refuse to apply to unexpected repository state');
  ghApi(prefix, 'PATCH', { allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: true, delete_branch_on_merge: true });
  ghApi(`${prefix}/immutable-releases`, 'PUT');
  const summaries = ghApi(`${prefix}/rulesets?includes_parents=false&per_page=100`);
  demand(summaries.length < 100, 'Ruleset pagination requires explicit inspection');
  for (const desired of desiredRules(p)) {
    const matches = summaries.filter((s) => s.name === desired.name && s.source === p.repository);
    demand(matches.length <= 1, `Duplicate managed ruleset: ${desired.name}`);
    ghApi(`${prefix}/rulesets${matches[0] ? `/${matches[0].id}` : ''}`, matches[0] ? 'PUT' : 'POST', desired);
  }
  return readPolicy(p);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  try {
    demand(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--apply'), 'Usage: repository-policy.mjs [--apply]');
    const root = resolve(dirname(self), '..');
    const p = readJson(root, 'config/github-repository-settings.json');
    // ML-002 applied the original policy; ML-031 carries the owner-approved release-branch cut-over.
    if (process.argv[2] === '--apply') demand(['ML-002', 'ML-031'].includes(readJson(root, 'config/change.json').id), 'Live settings application belongs to ML-002 or the ML-031 release cut-over');
    console.log(JSON.stringify(process.argv[2] === '--apply' ? applyPolicy(p) : readPolicy(p), null, 2));
  } catch (error) { console.error(`Repository policy rejected: ${error.message}`); process.exitCode = 1; }
}
