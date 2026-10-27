# Permanent implementation plan — current and future delivery queue

**Authority:** this file is the only live queue. [The specification](docs/specifications/2026-10-16-maplab.md), with the owner-approved R1 revision amended into its bodies at ML-003, governs design; its J2 table is the original 44-ID baseline, and the queue below may depart from it. To work, read only the active block: `sed -n '/^<!-- active-queue:start/,/^<!-- active-queue:end/p' implementation_plan.md`.

**Editing the plan (owner ruling, 2026-10-27):** any PR may add, edit, reorder or remove queued tasks at any time, whatever the queue holds. A PR that changes only this file is titled `[PLAN] Imperative summary` on a `plan-<summary>` branch into the open release branch; it takes no task ID and joins no release task list. IDs are unique and never recycled: a new task takes the ID above the mark below, which then rises to it, and a removed queued ID is retired for good, so IDs need not be contiguous.

**Highest ID ever used:** ML-046.

**Selection and retirement:** the active block holds exactly the controlled task in [config/change.json](config/change.json); any queued task may be the next one. After a verified protected squash into the open release branch on its green exact-head gate, the next activation appends the predecessor's evidence to [the delivery chain](docs/deliveries.json), retires it to one history line and moves its own task into the active block.

## Completed history

Full evidence for each line lives in the delivery chain and the linked change record.

<!-- completed-history:start -->
- **ML-001** — root commit `b0b1ff57859371be5aef7071394cb50c405d4794`; [record](docs/changes/ML-001.md). Its root exception is permanently closed.
- **ML-002** — squash `3e27093`, PR #1; [record](docs/changes/ML-002.md).
- **ML-003** — squash `cb3ba44`, PR #2; [record](docs/changes/ML-003.md).
- **ML-004** — squash `5a35bf9`, PR #3; [record](docs/changes/ML-004.md).
- **ML-005** — squash `ab87eec`, PR #4; [record](docs/changes/ML-005.md).
- **ML-006** — squash `9d23326`, PR #5; [record](docs/changes/ML-006.md).
- **ML-007** — squash `a6f3d61`, PR #6; [record](docs/changes/ML-007.md).
- **ML-008** — squash `b7016dc`, PR #7; [record](docs/changes/ML-008.md).
- **ML-009** — squash `211a18a`, PR #8; [record](docs/changes/ML-009.md).
- **ML-010** — squash `61b4e28`, PR #9; [record](docs/changes/ML-010.md).
- **ML-011** — squash `5727a5e`, PR #10; [record](docs/changes/ML-011.md).
- **ML-012** — squash `4b1429e`, PR #11; [record](docs/changes/ML-012.md).
- **ML-013** — squash `c435c2f`, PR #12; [record](docs/changes/ML-013.md).
- **ML-014** — squash `99fe49a`, PR #13; [record](docs/changes/ML-014.md).
- **ML-015** — squash `450e331`, PR #14; [record](docs/changes/ML-015.md).
- **ML-016** — squash `3c51ff8`, PR #15; [record](docs/changes/ML-016.md).
- **ML-017** — squash `87dcda0`, PR #16; [record](docs/changes/ML-017.md).
- **ML-018** — squash `6b462c1`, PR #17; [record](docs/changes/ML-018.md).
- **ML-019** — squash `6f5cf70`, PR #18; [record](docs/changes/ML-019.md).
- **ML-020** — squash `4ca03bf`, PR #19; [record](docs/changes/ML-020.md).
- **ML-021** — squash `cf091e7`, PR #20; [record](docs/changes/ML-021.md).
- **ML-022** — squash `f4997bd`, PR #22 (security repair of PR #21); [record](docs/changes/ML-022.md).
- **ML-023** — squash `a144833`, PR #23; [record](docs/changes/ML-023.md).
- **ML-024** — squash `10f5a75`, PR #24; [record](docs/changes/ML-024.md).
- **ML-025** — squash `8cae118`, PR #25; [record](docs/changes/ML-025.md).
- **ML-026** — squash `db24c46`, PR #26; [record](docs/changes/ML-026.md).
- **ML-027** — squash `faa1255`, PR #27; [record](docs/changes/ML-027.md).
- **ML-028** — squash `30ad4ac`, PR #28; [record](docs/changes/ML-028.md).
- **ML-029** — squash `bf239b8`, PR #29; [record](docs/changes/ML-029.md).
- **ML-030** — squash `9e79034`, PR #30; [record](docs/changes/ML-030.md).
- **ML-031** — squash `2a229ff`, PR #31; [record](docs/changes/ML-031.md).
- **ML-032** — squash `f697149`, PR #32; [record](docs/changes/ML-032.md).
- **ML-033** — squash `5a626ea`, PR #33; [record](docs/changes/ML-033.md).
- **ML-034** — squash `8d4dba8`, PR #34; [record](docs/changes/ML-034.md).
- **ML-035** — squash `16f32f3`, PR #35; [record](docs/changes/ML-035.md).
- **ML-036** — squash `4d5330a`, PR #36; [record](docs/changes/ML-036.md).
- **ML-037** — squash `2c3428b`, PR #37; [record](docs/changes/ML-037.md).
- **ML-038** — squash `3140855`, PR #38; [record](docs/changes/ML-038.md).
- **ML-039** — squash `ba25f60`, PR #39; [record](docs/changes/ML-039.md).
- **ML-045** — squash `e61cf40`, PR #40; [record](docs/changes/ML-045.md).
<!-- completed-history:end -->

## Active task

<!-- active-queue:start -->
### ML-046 / P1

- **Source scope:** Release-PR commit matching in the change-contract checker, its contract tests and the change-management doc, so release squash commits match with or without a ` (#PR)` suffix.
- **Non-goals:** No repository settings, rulesets, workflows, product code or history rewrite; no change to any other task's scope.
- **Acceptance:** The r001 release PR's change-id accepts its commits, three of which (ML-032, ML-033, ML-036) were squashed without ` (#PR)`; unlisted, missing, retitled or malformed commits still fail.
- **Depends on:** ML-045 squashed into release/r001 on its green exact-head gate; owner's "release" call of 2026-10-27.
- **Specification:** [J1](docs/specifications/2026-10-16-maplab.md#j1-repository-and-change-governance), [J2](docs/specifications/2026-10-16-maplab.md#j2-sequential-tasks); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Make the ` (#PR)` suffix optional in the task and plan squash patterns, matching the title lazily.
  2. Record the suffix rule in the change-management doc's release PR description.
  3. Create owned fixture(s): Release PR events whose task and plan squash commits omit the PR suffix.
  4. Add executable checks: Contract tests that accept suffix-less release commits and reject a malformed plan commit.
- **Task gate:** Run clean `npm ci`, `npm run check:foundation`, typecheck, build, smoke, `npm run check:change` and `npm run security` locally, with `npm run check` met by exact PR-head CI; exact PR-head `gate/change-id`, independent review and delivery read-back. No merge without protected gates.

<!-- active-queue:end -->

## Queued tasks

<!-- future-queue:start -->
### ML-040 / P2

- **Source scope:** Time/phase-aware periodic moving-platform navigation with wait/board/ride/exit.
- **Non-goals:** No completeness for unpredictable motion.
- **Acceptance:** Timed boarding/departure/full-body sweeps and phase-drift replan; static cache never certifies future rendezvous.
- **Depends on:** ML-039 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [E3](docs/specifications/2026-10-16-maplab.md#e3-one-way-drops-dynamic-movement), [E4](docs/specifications/2026-10-16-maplab.md#e4-search-costs-and-scalability), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Build explicitly time/phase-aware periodic-body safe intervals and wait/board/ride/exit transitions.
  2. Replay full-body timed witnesses and invalidate drifted phase; keep static search from certifying timed links.
  3. Create owned fixture(s): Elevator initial phase, missed boarding, narrow rider sweep, departure and phase drift.
  4. Add executable checks: Bounded time-search and conditional/unsupported status regression.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-041 / P1 hardening

- **Source scope:** Large-world benchmarks, incremental indexes, cache/history budgets and targeted optimization.
- **Non-goals:** No automatic renderer rewrite or unbounded streaming.
- **Acceptance:** H5 measurements pass or documented scope split; dense-budget cancellation remains responsive.
- **Depends on:** ML-040 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [H5](docs/specifications/2026-10-16-maplab.md#h5-measurable-performance-targets), [E4](docs/specifications/2026-10-16-maplab.md#e4-search-costs-and-scalability), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Materialize standard/stress fixtures and record hardware/OS/browser/controller/build identity and warm p50/p95.
  2. Profile renderer/input/history/nav/storage against H5 budgets; implement only measured targeted culling/index/cache fixes.
  3. Create owned fixture(s): 100,000 cells, 20 layers, 5,000 objects, 5,000 bodies, 10,000 footholds and dense cancellation.
  4. Add executable checks: Publish raw timing/memory snapshots and scope-split any unmet H5 gate.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-042 / P1 hardening

- **Source scope:** Optional browser handle/OPFS save adapters and recoverable directory-save journal.
- **Non-goals:** No hosted write API or silent external-library mutation.
- **Acceptance:** Revoked permission/quota/crash/conflict/two-tab tests; import/download fallback remains functional.
- **Depends on:** ML-041 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [H4](docs/specifications/2026-10-16-maplab.md#h4-project-storage-and-safe-assets), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Add opt-in browser File System Access handle/OPFS save adapters with permission/status explicitly surfaced.
  2. Journal multi-file writes with recovery/version conflict and preserve existing import/download fallback.
  3. Create owned fixture(s): Revoked handle, two tabs, quota, interrupted save, stale revision and backup recovery.
  4. Add executable checks: Cross-browser failure-injection integration tests; no hosted writes.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-043 / P1 hardening

- **Source scope:** Migration proof fixture and second independent consumer/controller-adapter conformance harness.
- **Non-goals:** No unsupported blanket engine parity claim.
- **Acceptance:** Current/previous schema migration deterministic; engine results report per-profile compatibility and failures; no editor runtime imported.
- **Depends on:** ML-042 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [F5](docs/specifications/2026-10-16-maplab.md#f5-canonicalization-versions-and-migrations), [G1](docs/specifications/2026-10-16-maplab.md#g1-exact-load-sequence), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix), [I3](docs/specifications/2026-10-16-maplab.md#i3-validation-layers-and-release-gates); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Create deterministic current/previous-schema migration fixture and verify no silent semantic loss.
  2. Build second independent controller/consumer-adapter conformance process with explicit version/profile compatibility matrix.
  3. Create owned fixture(s): Previous/current v1 records, forest bundle, different solver trace checkpoints and unsupported ability.
  4. Add executable checks: Per-profile tolerance/event/support checks from I2; reject blanket engine parity claim.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-044 / release gate

- **Source scope:** Security/performance/conformance review and immutable first source release.
- **Non-goals:** No undeclared hosting/deployment or map schema redesign.
- **Acceptance:** Canonical+online gates on exact head, source archive independently reproduced, immutable tag/release, docs/limitations current.
- **Depends on:** ML-043 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [J1](docs/specifications/2026-10-16-maplab.md#j1-repository-and-change-governance), [I3](docs/specifications/2026-10-16-maplab.md#i3-validation-layers-and-release-gates), [H5](docs/specifications/2026-10-16-maplab.md#h5-measurable-performance-targets), [F5](docs/specifications/2026-10-16-maplab.md#f5-canonicalization-versions-and-migrations); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Audit security, performance, licenses, schema/consumer/physics qualifications and documentation against released bytes.
  2. Perform exact-head canonical/online gates and reproduce immutable annotated tag, source archive, SHA256SUMS and release provenance.
  3. Create owned fixture(s): All prior golden suites, repeat archive bytes, verified tag target and provenance/limitations.
  4. Add executable checks: Protected release gate after main validation; no hosting/deployment or schema redesign.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

<!-- future-queue:end -->

## Cross-cutting design and delivery gates

Use [F1–F5](docs/specifications/2026-10-16-maplab.md#f1-versioned-documents-and-contract-rules) for the versioned format and numerical source fixtures; [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix) and [I4](docs/specifications/2026-10-16-maplab.md#i4-fundamental-acceptance-run) for tests and milestones; [J1](docs/specifications/2026-10-16-maplab.md#j1-repository-and-change-governance) for controlled delivery. Every task inherits the precise architecture contracts and implementation/non-goal limits of the full specification, even when a particular subsection is not repeated above.

Required fixture provenance is owned numeric/primitive CC0 material, not copied third-party art/code. Every contract/physics/nav task adds both positive and adversarial fixtures at the specified boundary. Independent readers do not import editor runtime. Advanced unsupported paths must be reported explicitly. Performance claims require pinned H5 measurements. All tasks run the existing canonical and separate online security gates, and the protected provider gates; passing desired JSON or an untested mock does not count as live enforcement. Release is reserved for ML-044 only.
