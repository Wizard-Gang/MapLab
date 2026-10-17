# Delivery gates and bootstrap closure

ML-001's root commit `b0b1ff57859371be5aef7071394cb50c405d4794` is historical.
Its [successful push CI](https://github.com/Wizard-Gang/MapLab/actions/runs/38990031757)
was read back before ML-002 activation. Its change record is preserved unchanged.
There is no root-commit path in current validation. Every new task uses one
controlled branch, one scoped PR and one squash commit.

`config/change.json`, the single active queue, the permanent roadmap, current
change record and preceding delivery chain must agree. The same validator accepts
any reserved post-bootstrap task with a complete preceding chain; a synthetic
ML-003 test proves it is not bound to ML-002. Offline evidence validation checks
consistency; authenticated provider read-back establishes actual delivery.

## Checks

`npm ci` denies dependency lifecycle scripts. `npm run check` is credential-free
and offline after installation: foundation/change/policy contracts, typechecking,
tests, production build and final-asset smoke. Tests invoke real checker CLIs on
malformed isolated copies, and exercise event, policy and stale-check failures.

CI runs `verify`, `change-id` and `security` on main pushes and PRs.
Version-tag creation and completed feature-branch deletion do not trigger delivery
CI; they cannot replace exact-head delivery evidence. Each checkout
explicitly selects the event's actual head SHA and asserts it before testing.
PR metadata changes rerun checks. The dedicated change-ID gate compares the PR
title, branch, main base, exact checkout, commit subjects, changed queue and record.
Branch push history is compared with the last delivered predecessor; main pushes
are compared with their preceding main commit. No synthetic merge revision or
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

`npm run policy:apply` is restricted to ML-002 and requires authenticated `gh`
administration access. It preserves private visibility, applies squash-only and
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

On 16 October 2026, read-back found Wizard-Gang on the Free organization plan.
Both ruleset and branch-protection endpoints returned HTTP 403 for this private
repository. GitHub Team or Enterprise capability is needed. The repository must
remain private. Available squash-only, automatic branch deletion and immutable
release settings were applied and read back successfully; this partial result
does not protect main/tags. ML-002 cannot be merged or called delivered until the capability
is available, policy is applied and complete read-back passes.

## Merge and records

After independent read-only review and fresh local/CI verification, record the
exact tested head and check URLs in the PR. Run:

```sh
npm run delivery:verify -- --pr NUMBER --head EXACT_HEAD_SHA
```

This checks live policy, current PR identity, all effective and legacy required successful checks/statuses
on that exact SHA, app identity, current-with-main ancestry and GitHub's merge/review
state; it re-reads head/main at the end. Skipped, neutral, stale and pending checks
fail even if GitHub would otherwise accept them. Capture this output externally.
Any edit or rebase requires fresh evidence. Merge through the normal provider
squash operation with the captured head as a compare-and-merge SHA guard. Never
use an admin bypass. Provider review requirements and unresolved findings must
be satisfied before merge.

Verify all three resulting-main CI checks on the squash SHA. GitHub's authorized
automatic branch deletion occurs at merge; remove the local completed branch
after successful main CI. Record final SHA, PR, checks and independent review in
the external resumable ledger. On the next controlled activation, append that
completed evidence to `docs/deliveries.json` and synchronize queue/roadmap. A commit
cannot include its own final squash hash. Stop sequential activation on any
failed predecessor, main CI, access or protection gate; preserve work and evidence.

## Permanent plan and J2 traceability

`implementation_plan.md` is the sole current/future task queue. Each reserved J2 ID retains exact scope, exclusions and acceptance and now has executable subtasks, owned fixtures, negative/positive tests, precise specification section anchors and delivery gates. `docs/IMPLEMENTATION-ROADMAP.md` is a historical pointer only. `scripts/check-queue.mjs` enforces sequential first-open selection, uninterrupted delivered predecessor chain, retirement of completed IDs, future preservation, exact J2 fields, section link validity and no duplicate legacy roadmap definitions. `check:change` and canonical `check` invoke it. Synthetic next-task and malformed-queue tests demonstrate generic selection rather than ML-002-only parsing.

This is governance-only ML-002 scope; the adopted full specification, world shell, lockfile, ML-001 evidence and all later task implementations remain untouched.
