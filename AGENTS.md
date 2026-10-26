# MapLab repository instructions

This file is the only required reading. Every other doc is a reference: look up the slice you need with the commands below and never read one end to end. MapLab is standalone: RigLab is optional presentation, Hexframe is not a dependency, and neither one's source is ever imported.

## Authority

- **Design, contracts, fixtures, limits:** [the specification](docs/specifications/2026-10-16-maplab.md), whose bodies the owner-approved [R1 revision](docs/specifications/2026-10-17-maplab-r1/README.md) amended in place at ML-003. Open an R1 file only when a spec section points to it.
- **Delivery:** [implementation_plan.md](implementation_plan.md) alone.
- **Process:** the scripts enforce [change management](docs/CHANGE-MANAGEMENT.md) and [delivery gates](docs/DELIVERY-GATES.md). Run them, and open those docs only to look up a rule that a failure names.

## Lookups

- Active task, your whole scope: `sed -n '/^<!-- active-queue:start/,/^<!-- active-queue:end/p' implementation_plan.md`
- Spec sections it names: `grep -n '^##' docs/specifications/2026-10-16-maplab.md` for the heading map, then `sed -n 'START,ENDp'` per section.
- Activating after a verified squash: branch from the open release (`git switch -c BRANCH origin/$(jq -r .branch config/release.json)`), then copy the previous activation's shape from `git show HEAD -- implementation_plan.md docs/deliveries.json config/change.json config/release.json`.
- PR body: the sections of [the PR template](.github/pull_request_template.md).
- Skip completed history, future blocks, other tasks' change records, and earlier ledgers and reviews. For one fact from a JSON file, `jq` it.

## Rules

- One controlled task, branch, PR and squash at a time: the first undelivered ID after [the delivery chain](docs/deliveries.json). No early or parallel work on later IDs. Never reuse, renumber, drop or edit IDs or acceptance to get past a failure. Retire a task only after its head-guarded squash into the open release branch on exact-head green `gate` and `change-id`. The next activation appends its evidence (from ML-031 on, the PR's `gate` run in place of main CI) and promotes the first future ID, leaving every later task untouched.
- **Release protocol** (owner ruling, 2026-10-25): task branches start from the open `release/rNNN` in [config/release.json](config/release.json), their PRs target it, and each appends its ID to `tasks`. With none open, the next task cuts it from main's tip: `git push origin main:refs/heads/release/rNNN`. Only when Jacob says "release", open `release/rNNN` -> `main` titled `[RELEASE] rNNN: ML-0xx..ML-0yy`, watch its full `verify` once, and rebase-merge it. The next task appends it to [docs/releases.json](docs/releases.json). A red release is fixed forward by a task PR into the release branch, never a direct push. A spec-locked "completed and passing main CI" is met by the predecessor's green release-branch gate.
- Title `[ML-###] [FEATURE|FIX|DOCS|CHORE|REFACTOR|TEST|SECURITY] Imperative summary`, matching [config/change.json](config/change.json) and the branch.
- Exact Node **26.10.0** / npm **12.1.0**, lockfile, lifecycle scripts denied. Agents do not run tests locally: no vitest, Playwright, `npm test`, `npm run test:browser` or `npm run check`. CI `verify` runs them, on the release PR or on demand with `gh workflow run verify.yml --ref BRANCH` and one `gh run watch --exit-status`. Dispatch it on the exact head whenever a task changes tests or runtime code; that run meets a task gate's `npm run check` and exact-head `verify`/`security`. Locally run clean `npm ci`, `npm run check:foundation`, `npm run typecheck`, `npm run build`, `npm run smoke`, `npm run check:change` and the online `npm run security`. Browsers come from `npx playwright install chromium webkit`, never npm. No borrowed assets or executable schema extensions.
- Preserve source/derived/runtime separation, finite-body witness and qualified nav claims, semantic reference/ID stability and owned CC0 fixture provenance. Every task adds negative tests and an independent-consumer proof.
- Merge a task PR only by head-guarded squash into the release branch after exact-head green `gate` and `change-id`, an independent review, `npm run policy:check` and `npm run delivery:verify -- --pr NUMBER --head SHA`. A release PR merges by head-guarded rebase after exact-head green `verify`, `change-id` and `security` and the same two scripts. Stop rather than bypass a protection. Never deploy or publish a version: ML-044 alone owns the first version release.

## Keep sessions cheap

Each tool call re-sends the whole session, so everything that enters context is paid for again on every later call.

- Read by range (`grep -n`, `sed -n`), not whole files, and never re-read what you already have.
- Write long output to a log and print only the tail or the failures. Wait on CI with one blocking `gh run watch --exit-status`, not repeated polls.
- Split a task at "PR open": review, merge and evidence start in a fresh session from a handoff of 25 lines or fewer.
- At about 200k tokens of context, finish the current step. At 300k the owner's context-budget hook blocks work tools: reach a recoverable point (commit, push or PR open), then hand off in 25 lines or fewer, in the task's evidence package or `~/Documents/handoffs/maplab-<YYYY-MM-DD>.md`.
- Brief the independent reviewer with only the task block, the diff and the named spec sections. A re-review checks the blocking findings against the repair diff instead of repeating the full review.
