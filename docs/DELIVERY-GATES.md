# Delivery gates and bootstrap closure

ML-001's root commit `b0b1ff57859371be5aef7071394cb50c405d4794` is historical.
Its [successful push CI](https://github.com/Wizard-Gang/MapLab/actions/runs/38990031757)
was read back before ML-002 activation. Its change record is preserved unchanged.
There is no root-commit path in current validation. Every new task uses one
controlled branch, one scoped PR and one squash commit.

`config/change.json`, the single active queue, the reserved future queue, current
change record and preceding delivery chain must agree. The same validator accepts
any reserved post-bootstrap task with a complete preceding chain; a synthetic
ML-003 test proves it is not bound to ML-002. Offline evidence validation checks
consistency; authenticated provider read-back establishes actual delivery.

## Checks

`npm ci` denies dependency lifecycle scripts. `npm run check` is credential-free
and offline after installation: foundation/change/policy contracts, typechecking,
tests, production build and final-asset smoke. Tests invoke real checker CLIs on
malformed isolated copies, and exercise event, policy and stale-check failures.

Since ML-031 three workflows split the gates by base, and none runs on push:

- `verify.yml` ("Delivery gates"): PRs into `main` and `workflow_dispatch`. A `check`
  job (`npm run check`) runs beside a `browser` matrix of Chromium and WebKit in two
  shards each. The required `verify` aggregate runs `if: always()` and fails unless
  `check` and every shard succeed. `security` runs alongside. Dispatching it on a
  task branch is the on-demand full run; it satisfies no merge rule by itself.
- `gate.yml` ("Feature gate"): PRs into `release/**`. One `gate` job runs `npm ci`,
  `check:foundation`, `typecheck`, `build` and `smoke`, with no tests.
- `change.yml` ("Change identity"): PRs into both. One `change-id` job.

Main's tree equals the release PR's tested tree, because that PR is strict-current
and rebase-merged, so main needs no push run. Version-tag creation and completed
branch deletion trigger no delivery CI. Each checkout explicitly selects the
event's actual head SHA and asserts it before testing. PR metadata changes rerun
checks. The change-ID gate compares the PR title, branch, base, exact checkout,
commit subjects, changed queue, release and record against
[change management](CHANGE-MANAGEMENT.md). No synthetic merge revision or
zero-parent exception qualifies as current evidence.

The separate **online** `npm run security` runs the pinned npm 12.1.0 vulnerability
audit and registry signature/provenance verification. Any known vulnerability at
low severity or above fails; a failed registry request, invalid signature or
provenance verification fails. No suppressions or lifecycle exceptions exist.
These registry checks do not claim comprehensive application security or future
importer hardening. Native paid scanning products are not required by this gate.

All Actions are immutable-SHA pinned; jobs have read-only contents permission,
no persisted Git credential and no deployment credential. PR-controlled strings
are read as data from the event JSON rather than interpolated into shell commands.

## Live policy

`npm run policy:apply` is restricted to ML-002 and the ML-031 cut-over below, and requires authenticated `gh`
administration access. It preserves the configured public visibility (without changing visibility), applies squash-only and
automatic branch deletion, enables release immutability, and manages two active
no-bypass rulesets. Main requires PRs, linear history, resolved review threads and
strict `verify`/`change-id`/`security` checks from the observed GitHub Actions app
ID 15368; deletion and non-fast-forward updates are denied. Version tags matching
`v*` deny updates/deletion while allowing initial creation. No release/tag is
created by this task. The desired baseline requires zero approving reviews;
actual inherited review requirements still govern and cannot be bypassed.

`npm run policy:check` reads the repository, complete managed rulesets, effective
main rules and immutable-release state back. It fails closed on drift, missing
policy, insufficient plan or access. It prints provider evidence for archival.
The settings JSON always represents desired policy; it is never enforcement proof.
Inherited or additional policies remain intact and may impose stronger controls.

On 16 October 2026, read-back found Wizard-Gang on the Free organization plan
and private-repository rulesets returned HTTP 403. On 17 October, live repository
read-back confirmed the owner changed MapLab to **public**, enabling access to the
ruleset read endpoint. Its returned list is **empty**: neither required managed
ruleset is installed. The connected GitHub App can read rulesets but cannot write
repository administration settings; legacy branch-protection read-back returns
HTTP 403 ("Resource not accessible by integration"). The independent admin must run
`npm run policy:apply` and `npm run policy:check` using authorized `gh` access,
keeping public visibility. Existing squash-only, automatic branch deletion and
immutable releases were applied and read back earlier, but do not protect main/tags.
On 17 October 2026 the owner's admin `gh` applied both rulesets, `MapLab main`
(25315600) and `MapLab immutable versions` (25315601), and `npm run policy:check`
read them back active with no bypass before ML-002's protected squash delivery.
ML-031 carries the owner-approved release cut-over, so `policy:apply` also runs for
ML-031. It allows rebase merges at repository level, limits main to `rebase`, and
adds a third ruleset, `MapLab release`, on `refs/heads/release/*`. That ruleset
requires a PR, allows only `squash`, denies non-fast-forward updates and requires
strict `gate`/`change-id` from app 15368. It enforces those checks from the first
PR, not on branch creation, and has no deletion rule, so a merged release
branch auto-deletes.

## Merge and records

After independent read-only review and fresh local/CI verification, record the
exact tested head and check URLs in the PR. Run:

```sh
npm run delivery:verify -- --pr NUMBER --head EXACT_HEAD_SHA
```

This checks live policy, current PR identity, all effective and legacy required successful checks/statuses
on that exact SHA, app identity, current-with-base ancestry and GitHub's merge/review
state; it re-reads head and base at the end. The base chooses the checks: a task PR
into `release/*` needs `gate` and `change-id`, and the release PR into main needs
`verify`, `change-id` and `security`. It prints the merge method to use. Skipped, neutral, stale and pending checks
fail even if GitHub would otherwise accept them. Capture this output externally.
Any edit or rebase requires fresh evidence. Merge through the normal provider
operation, squash for a task PR and rebase for a release PR, with the captured head
as a compare-and-merge SHA guard. Never
use an admin bypass. Provider review requirements and unresolved findings must
be satisfied before merge.

No CI runs on the merged result; the exact-head PR run is the evidence. GitHub's
authorized automatic branch deletion occurs at merge; remove the local completed
branch afterwards. Record final SHA, PR, checks and independent review in
the external resumable ledger. On the next controlled activation, append that
completed evidence to `docs/deliveries.json` and synchronize the permanent implementation plan's completed/current/future blocks. A commit
cannot include its own final squash hash. The next release's first task appends the merged release to `docs/releases.json`.
Stop sequential activation on any failed predecessor, gate, access or protection
check; preserve work and evidence.

## Permanent plan and traceability

`implementation_plan.md` is the sole current/future task queue. Each task has scope, exclusions, acceptance, executable subtasks, owned fixtures, negative/positive tests, precise specification section anchors and delivery gates. `scripts/check-queue.mjs` enforces those fields and section link validity, an active block holding exactly the controlled task, retirement of completed IDs, unique live IDs and the plan's highest ID ever used. Since the owner's 2026-10-27 ruling the queue's content and order are free and no longer must match J2; `change-id` rejects a new task at or below the base's highest ID. `check:change` and canonical `check` invoke it.

ML-002 delivered this governance scope. Later tasks change it only through their own controlled records; ML-003 generalized the queue tests to follow the delivery chain.
