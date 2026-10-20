# MapLab repository instructions

This file is the only required reading. Every other doc is a reference: look up the slice you need with the commands below and never read one end to end. MapLab is standalone: RigLab is optional presentation, Hexframe is not a dependency, and neither one's source is ever imported.

## Authority

- **Design, contracts, fixtures, limits:** [the specification](docs/specifications/2026-10-16-maplab.md), whose bodies the owner-approved [R1 revision](docs/specifications/2026-10-17-maplab-r1/README.md) amended in place at ML-003. Open an R1 file only when a spec section points to it.
- **Delivery:** [implementation_plan.md](implementation_plan.md) alone.
- **Process:** the scripts enforce [change management](docs/CHANGE-MANAGEMENT.md) and [delivery gates](docs/DELIVERY-GATES.md). Run them, and open those docs only to look up a rule that a failure names.

## Lookups

- Active task, your whole scope: `sed -n '/active-queue:start/,/active-queue:end/p' implementation_plan.md`
- Spec sections it names: `grep -n '^##' docs/specifications/2026-10-16-maplab.md` for the heading map, then `sed -n 'START,ENDp'` per section.
- Activating after a verified squash: copy the previous activation's shape from `git show HEAD -- implementation_plan.md docs/deliveries.json config/change.json`.
- PR body: the sections of [the PR template](.github/pull_request_template.md).
- Skip completed history, future blocks, other tasks' change records, and earlier ledgers and reviews. For one fact from a JSON file, `jq` it.

## Rules

- One controlled task, branch, PR and squash at a time: the first undelivered ID after [the delivery chain](docs/deliveries.json). No early or parallel work on later IDs. Never reuse, renumber, drop or edit IDs or acceptance to get past a failure. Retire a task only after its protected squash and resulting main CI are confirmed. The next activation appends its evidence and promotes the first future ID, leaving every later task untouched.
- Title `[ML-###] [FEATURE|FIX|DOCS|CHORE|REFACTOR|TEST|SECURITY] Imperative summary`, matching [config/change.json](config/change.json) and the branch.
- Exact Node **26.10.0** / npm **12.1.0**, lockfile, lifecycle scripts denied. Clean `npm ci`, then `npm run check`; `npm run security` is separate and online. Browsers come from `npx playwright install chromium webkit`, never npm. No borrowed assets or executable schema extensions.
- Preserve source/derived/runtime separation, finite-body witness and qualified nav claims, semantic reference/ID stability and owned CC0 fixture provenance. Every task adds negative tests and an independent-consumer proof.
- Merge only by head-guarded squash after exact-head green `verify`, `change-id` and `security`, an independent review, `npm run policy:check` and `npm run delivery:verify -- --pr NUMBER --head SHA`; then confirm main CI. Stop rather than bypass a protection. Never deploy or release: ML-044 alone owns the first release.

## Keep sessions cheap

Each tool call re-sends the whole session, so everything that enters context is paid for again on every later call.

- Read by range (`grep -n`, `sed -n`), not whole files, and never re-read what you already have.
- Write long output to a log and print only the tail or the failures. Wait on CI with one blocking `gh run watch --exit-status`, not repeated polls.
- Split a task at "PR open": review, merge and evidence start in a fresh session from a handoff of 25 lines or fewer.
- Brief the independent reviewer with only the task block, the diff and the named spec sections. A re-review checks the blocking findings against the repair diff instead of repeating the full review.
