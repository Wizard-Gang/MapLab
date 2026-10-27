# Permanent implementation plan — current and future delivery queue

**Authority:** this file is the only live queue. [The specification](docs/specifications/2026-10-16-maplab.md), with the owner-approved R1 revision amended into its bodies at ML-003, governs design; its J2 table is the original 44-ID baseline, and the queue below may depart from it. To work, read only the active block: `sed -n '/^<!-- active-queue:start/,/^<!-- active-queue:end/p' implementation_plan.md`.

**Editing the plan (owner ruling, 2026-10-27):** any PR may add, edit, reorder or remove queued tasks at any time, whatever the queue holds. A PR that changes only this file is titled `[PLAN] Imperative summary` on a `plan-<summary>` branch into the open release branch; it takes no task ID and joins no release task list. IDs are unique and never recycled: a new task takes the ID above the mark below, which then rises to it, and a removed queued ID is retired for good, so IDs need not be contiguous.

**Highest ID ever used:** ML-050.

**Selection and retirement:** the active block holds exactly the controlled task in [config/change.json](config/change.json); any queued task may be the next one. After a verified protected squash into the open release branch on its green exact-head gate, the next activation drops it from the plan and moves its own task into the active block. GitHub's merged PRs and checks are the delivery record.

## Active task

<!-- active-queue:start -->
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

<!-- active-queue:end -->

## Queued tasks

<!-- future-queue:start -->
### ML-048 / P1 hardening (ML-041 scope split)

- **Source scope:** Establish H5 editor performance on the Apple M1-class/16 GiB machine with stable hardware-accelerated Chromium and Safari; finish renderer, pointer-to-present, inspector and total working-set measurements against the owned standard fixture.
- **Non-goals:** No automatic renderer rewrite or unmeasured optimization.
- **Acceptance:** Five warm runs with exact hardware/OS/browser/controller/production-build identity meet H5/R1 H7 camera, input, history, select/search and memory targets; preserve raw samples, visible workload assertions and browser/GPU memory accounting. Any measured regression receives a targeted repair and rerun.
- **Depends on:** ML-041 completed and passing release-branch CI; owner baseline machine/browser availability.
- **Specification:** [H5](docs/specifications/2026-10-16-maplab.md#h5-measurable-performance-targets), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix), referenced R1 H7; authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Run production builds on the specified machine and both actual browsers; CI Linux/WebKit samples are comparative evidence only.
  2. Measure end-to-end input feedback and the complete editor, including inspector and browser/GPU working set.
  3. Create owned fixture(s): Visible standard-world sweeps, indexed hit/miss queries, inspector search, history pressure and decoded-art cache pressure.
  4. Add executable checks: Raw timing/memory snapshots, negative workload guards and independent-consumer proof.
- **Task gate:** Run clean `npm ci`, `npm run check` (met by CI), `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back, plus gate/change-id. No merge without protected gates. Agents run only the required non-test checks locally.

### ML-049 / P1 hardening (ML-041 scope split)

- **Source scope:** Full and incremental navigation benchmarks, physical dependency indexes, warm selected-region overlays and bounded progressive generation against H5/R1 E8.
- **Non-goals:** No relaxed witness proof, unbounded all-pairs generation or automatic route certification from coarse graphs.
- **Acceptance:** Full 100/300-support graph targets, incremental foothold-edit regeneration, 2,000-node/8,000-edge search, chained replay, warm overlays and 10,000-support progress targets meet H5/R1 E8 on the baseline machine. Preserve cancellation within 100 ms, explicit budget/no-result status and no main-thread task over 50 ms; a budget-limited graph is never counted as a completed full graph.
- **Depends on:** ML-041 completed and passing release-branch CI; ML-048 baseline measurement setup.
- **Specification:** [E4](docs/specifications/2026-10-16-maplab.md#e4-search-costs-and-scalability), [H5](docs/specifications/2026-10-16-maplab.md#h5-measurable-performance-targets), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix), referenced R1 E8; authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Measure full owned 100/300-support graphs, 10,000-support viewport-first generation, progress and main-thread preparation costs.
  2. Measure single-support invalidation, warm overlays and chained full-body replay; implement only measured dependency/index/cache repairs.
  3. Create owned fixture(s): Multi-level graphs, dense cancellation at preprocessing/replay phases, new/removed obstacle and art-only cache preservation.
  4. Add executable checks: Warm worker samples with per-run statuses, raw timing/memory snapshots, negative/stale results and independent-consumer proof.
- **Task gate:** Run clean `npm ci`, `npm run check` (met by CI), `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back, plus gate/change-id. No merge without protected gates. Agents run only the required non-test checks locally.

### ML-050 / P1 hardening (ML-041 scope split)

- **Source scope:** Validated 10 MiB local revision saves and cancellable 100 MiB worker bundle exports against H5/R1 H7, with UI responsiveness and retained-memory evidence.
- **Non-goals:** No version publication, remote storage backend or file-limit increase.
- **Acceptance:** Five warm runs on the baseline machine meet the 2-second validated save and 10-second worker-export targets, keep UI responsive and cancel functional, and retain source/digest integrity with raw timing/memory samples.
- **Depends on:** ML-041 completed and passing release-branch CI; ML-048 baseline measurement setup.
- **Specification:** [H5](docs/specifications/2026-10-16-maplab.md#h5-measurable-performance-targets), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix), referenced R1 H7; authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Materialize owned 10 MiB changed-document and 100 MiB export workloads without borrowed assets.
  2. Measure complete validation/plugin replacement and worker bundle paths, cancellation latency, UI tasks and retained bytes.
  3. Create owned fixture(s): Interrupted save, stale base, cancelled export and digest mismatch.
  4. Add executable checks: Raw timing/memory snapshots, negative cases and independent final-byte consumer proof.
- **Task gate:** Run clean `npm ci`, `npm run check` (met by CI), `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back, plus gate/change-id. No merge without protected gates. Agents run only the required non-test checks locally.

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
