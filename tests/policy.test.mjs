import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { checkPolicyConfig, desiredRules, requireMatch } from '../scripts/repository-policy.mjs';
import { checkHeadChecks, requiredContexts } from '../scripts/verify-pr.mjs';

const policy = JSON.parse(readFileSync(new URL('../config/github-repository-settings.json', import.meta.url)));
test('policy requires strict app-bound checks and immutable version updates, while allowing initial tag creation', () => {
  expect(() => checkPolicyConfig(policy)).not.toThrow();
  const [main, tags] = desiredRules(policy);
  expect(main.rules.find((r) => r.type === 'required_status_checks').parameters.strict_required_status_checks_policy).toBe(true);
  expect(tags.rules.map((r) => r.type)).toEqual(['update', 'deletion']);
  expect(tags.bypass_actors).toEqual([]);
});
test.each([
  ['bypass', (p) => { p.main.bypassActors.push(1); }],
  ['missing check', (p) => { p.main.requiredChecks.pop(); }],
  ['wrong app', (p) => { p.main.checksAppId = 1; }],
  ['private', (p) => { p.visibility = 'private'; }],
  ['mutable releases', (p) => { p.releases.immutable = false; }],
])('weakened desired policy rejects %s', (_name, corrupt) => {
  const p = structuredClone(policy); corrupt(p); expect(() => checkPolicyConfig(p)).toThrow();
});
test.each([
  ['disabled rules', (p) => { p.enforcement = 'evaluate'; }],
  ['bypass actor', (p) => { p.bypass_actors.push({ actor_id: 1 }); }],
  ['non-strict checks', (p) => { p.rules.find((r) => r.type === 'required_status_checks').parameters.strict_required_status_checks_policy = false; }],
  ['deletion allowed', (p) => { p.rules = p.rules.filter((r) => r.type !== 'deletion'); }],
])('provider read-back rejects %s', (_name, corrupt) => {
  const desired = desiredRules(policy)[0]; const actual = structuredClone(desired); corrupt(actual);
  expect(() => requireMatch(actual, desired)).toThrow();
});
const head = 'a'.repeat(40);
const checks = () => ['verify', 'change-id', 'security'].map((name) => ({ name, head_sha: head, status: 'completed', conclusion: 'success', app: { id: 15368 }, html_url: `https://github.com/fixture/${name}` }));
test('delivery accepts successful exact-head checks', () => expect(checkHeadChecks(checks(), head, 15368)).toHaveLength(3));
test.each(['failure', 'pending', 'error'])('same-name commit status %s blocks a successful check run', (state) => {
  expect(() => checkHeadChecks(checks(), head, 15368, undefined, [{ context: 'security', state }])).toThrow();
});
test.each([
  ['stale head', (c) => { c[0].head_sha = 'b'.repeat(40); }],
  ['skipped gate', (c) => { c[1].conclusion = 'skipped'; }],
  ['failure', (c) => { c[2].conclusion = 'failure'; }],
  ['pending', (c) => { c[2].status = 'in_progress'; }],
  ['spoofed app', (c) => { c[2].app.id = 1; }],
  ['missing gate', (c) => { c.pop(); }],
])('delivery rejects %s', (_name, corrupt) => { const c = checks(); corrupt(c); expect(() => checkHeadChecks(c, head, 15368)).toThrow(); });

test('all effective and legacy required checks are collected; skipped inherited check blocks delivery', () => {
  const observed = { effectiveMain: [...desiredRules(policy)[0].rules,
    { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'independent-review', integration_id: 42 }] } }],
  branchProtection: { required_status_checks: { contexts: ['legacy-security'], checks: [] } } };
  const required = requiredContexts(observed);
  expect(required).toHaveLength(5);
  const c = [...checks(), { name: 'independent-review', app: { id: 42 }, head_sha: head, status: 'completed', conclusion: 'skipped' }];
  expect(() => checkHeadChecks(c, head, 15368, required, [{ context: 'legacy-security', state: 'success' }])).toThrow();
  c[3].conclusion = 'success';
  expect(checkHeadChecks(c, head, 15368, required, [{ context: 'legacy-security', state: 'success' }])).toHaveLength(5);
});
