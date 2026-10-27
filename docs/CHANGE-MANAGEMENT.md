# Change management

Use one controlled `ML-###` task, one branch, one scoped PR, and one squash commit
into the open `release/rNNN` branch per delivery after bootstrap. Title form:
`[ML-###] [FEATURE|FIX|DOCS|CHORE|REFACTOR|TEST|SECURITY] Imperative summary`.
IDs never get reused. The permanent implementation plan is the sole current/future queue. Unrelated cleanup/upgrades are excluded.

## Plan edits (owner ruling, 2026-10-27)

- Any PR may add, edit, reorder or remove queued tasks in `implementation_plan.md`, at
  any time and whatever the queue holds, including a task PR that also edits other tasks.
  The next task is any queued task; the spec's J2 table is the original baseline only.
- A PR that changes only the plan is titled `[PLAN] Imperative summary` on a
  `plan-<summary>` branch into the open release branch, with every commit titled the
  same. Once that release has merged (its branch is gone) and before the next task, it
  targets the next branch (`release/rNNN+1`), cut from main's tip. The next task then
  reuses that branch instead of cutting it again. It takes no task ID, leaves `config/` alone, and joins no release task list;
  its squash `[PLAN] Imperative summary (#PR)` rides the release PR beside the tasks.
- IDs are unique and never recycled. The plan records the highest ID ever used; a new
  task takes an ID above it and raises it, and it never falls. A removed queued ID is
  retired, so the queue and the delivery chain need not be contiguous. `change-id`
  compares the base and head plans to enforce this.

PR records contain Change, Reason, Impact, Risk, Controls, Validation, Evidence,
Source, and Release. Evidence scales to risk. Format/physics work needs fixtures
and independent consumer impact; documentation needs relevant contract/link checks.
Record exact tested head SHA. Edits/rebases invalidate prior evidence. Desired live
policy requires strict current-with-base checks on that SHA: `gate` and `change-id`
for a task PR into `release/*`, and `verify`, `change-id` and `security` for the
release PR into main. No bypass actors; main forbids deletion and non-fast-forward
updates, and release branches forbid non-fast-forward updates. Completed branches
delete after merge.

ML-001's only exception: an authenticated organization-admin inventory confirms
`Wizard-Gang/MapLab` genuinely absent, then it is created privately and confirmed
empty with no starting SHA. Run clean checks before an initial root commit on main.
Record its hash and push-triggered CI externally. No base exists for a PR. This
exception never applies to existing contents or any subsequent commit. ML-002
closes bootstrap by applying and reading back live protections. The root exception is historical and closed to all current validation. No setting
in `config/github-repository-settings.json` is enforcement evidence; capture
authenticated [policy read-back](DELIVERY-GATES.md) before merging.

Canonical `npm run check` is credential-free: runtime/package/lock/policy/authority/
queue identity checks, typecheck, tests, production build, then built-asset smoke.
Deliberately malformed fixtures must fail. Initial CI runs this same path. ML-002
adds dedicated online dependency/security and change-ID gates and provider proof.
Ordinary changes do not release, deploy or change repository visibility.

## Release branches (from ML-031)

The owner's 2026-10-25 ruling batches tasks so the full suite runs once per release:

- [config/release.json](../config/release.json) names the open branch (`{id, branch, tasks}`).
  Each task PR appends its ID; the first task of a release creates the file anew.
- Every commit a task PR adds carries the task's exact title, and the PR targets
  `config/release.json.branch`. The squash subject is `[ML-###] [TYPE] Title (#PR)`.
- The release PR, `release/rNNN` -> `main`, opens only when Jacob says "release". Its
  title is `[RELEASE] rNNN: ML-0xx..ML-0yy` (one ID when the release holds one task).
  Its commits are exactly one squash commit per listed task, oldest first, each titled
  as that task's record, plus any `[PLAN]` squash commits. It rebase-merges, so main gains one commit per task and per plan PR.
- Deliveries up to ML-030 keep `mainCi`. Later entries carry
  `gate: {head, conclusion, url}` on their last tested head.
- [docs/releases.json](releases.json) records each merged release as
  `{id, pr, testedHead, ci: {conclusion, url}, mainHead, tasks}`, appended by the
  next release's first task. `change-id` fetches each release PR's head, requires it
  to equal `testedHead`, and requires `mainHead`'s tree to equal `testedHead`'s tree.
  A rebase rewrites SHAs, so tree equality is the evidence.
- A spec-locked "completed and passing main CI" dependency is met by the
  predecessor's green exact-head release gate; the full suite reaches main through
  the release PR's `verify`.
