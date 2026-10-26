# Permanent implementation plan — current and future delivery queue

**Authority:** this file is the only live queue. [The specification](docs/specifications/2026-10-16-maplab.md), with the owner-approved R1 revision amended into its bodies at ML-003, governs design and holds J2, the 44-ID baseline that every task block below must match. To work, read only the active block: `sed -n '/^<!-- active-queue:start/,/^<!-- active-queue:end/p' implementation_plan.md`.

**Selection and retirement:** the first open reserved ID after [the delivery chain](docs/deliveries.json) is the only executable task and sits alone in the active block. Every later ID stays in the future block once, in order. After a verified protected squash into the open release branch on its green exact-head gate, the next activation appends the predecessor's evidence to the delivery chain, retires it to one history line, promotes exactly the next ID and leaves all later tasks untouched. Never reuse, renumber, skip, implement early or silently delete IDs. An oversized task needs a separately governed queue/spec revision first.

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
<!-- completed-history:end -->

## Current first-open task

<!-- active-queue:start -->
### ML-034 / P1

- **Source scope:** Ground/air dash controller and stateful dash-edge witnesses.
- **Non-goals:** No wall or grapple solver.
- **Acceptance:** Thin-wall sweep, duration/cooldown/reset/resource compatibility; whole-route replay and budget tests.
- **Depends on:** ML-033 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [D4](docs/specifications/2026-10-16-maplab.md#d4-movement-contract-and-runtime-separation), [E2](docs/specifications/2026-10-16-maplab.md#e2-deterministic-graph-building-pipeline), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Add ground/air dash start/stop, duration/cooldown/cost and collision-safe high-speed sweeps.
  2. Make dash graph edges stateful and replay full chosen route with profile-specific resources.
  3. Create owned fixture(s): Thin-wall dash, start permission, resource depletion, landing reset and cooldown.
  4. Add executable checks: No tunneling, deterministic budget and witness tests.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

<!-- active-queue:end -->

## Preserved future reserved tasks

<!-- future-queue:start -->
### ML-035 / P1

- **Source scope:** Wall slide/jump/climb geometry permissions, controller and bounded wall-sequence solver.
- **Non-goals:** No ledge/grapple/swing.
- **Acceptance:** Contact side, stamina and launch-state fixtures; routes differ by permissions; no physics from artwork.
- **Depends on:** ML-034 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [D4](docs/specifications/2026-10-16-maplab.md#d4-movement-contract-and-runtime-separation), [E2](docs/specifications/2026-10-16-maplab.md#e2-deterministic-graph-building-pipeline), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Add wall side contact, slide, jump and climb permission/resource handling to reference controller.
  2. Bound wall-sequence graph expansion with clearance and release/launch transition checks.
  3. Create owned fixture(s): Left/right wall, stamina exhaustion, blocked roof, launch velocity and incompatible profiles.
  4. Add executable checks: Collision truth/route-profile distinction tests.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-036 / P2

- **Source scope:** Ledge-grab/climb capability and supported transition solver.
- **Non-goals:** No arbitrary scripted animation-to-physics authority.
- **Acceptance:** Approach/clearance/body-size/resource fixtures; explicit action metadata; unsupported cases qualified.
- **Depends on:** ML-035 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [D4](docs/specifications/2026-10-16-maplab.md#d4-movement-contract-and-runtime-separation), [E2](docs/specifications/2026-10-16-maplab.md#e2-deterministic-graph-building-pipeline), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Specify ledge approach/grab/climb transitions, body clearance and explicit action metadata.
  2. Implement bounded supported solver paths and return qualified unsupported results for other geometry.
  3. Create owned fixture(s): Ledge approach clearance, narrow body, missing stamina, failed reach.
  4. Add executable checks: Witness replay with no animation-derived physics authority.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-037 / P2

- **Source scope:** Swimming/entry/exit plus refined flight acceleration/turn-state navigation.
- **Non-goals:** No fluid simulation.
- **Acceptance:** Bodies stay in bound swim/flight volumes; mode changes have witnesses; distinct profiles produce distinct routes.
- **Depends on:** ML-036 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [D4](docs/specifications/2026-10-16-maplab.md#d4-movement-contract-and-runtime-separation), [E1](docs/specifications/2026-10-16-maplab.md#e1-representations-and-guarantees), [E2](docs/specifications/2026-10-16-maplab.md#e2-deterministic-graph-building-pipeline), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Add bounded swim entry/exit and distinct flight acceleration/turn-state search capabilities.
  2. Build body-aware mode-volume transitions and cache identities specific to each profile.
  3. Create owned fixture(s): Swim volume edge, blocked exit, flyer acceleration/turn corner and wrong-mode profile.
  4. Add executable checks: Finite-body mode transitions, no fluid-simulation claim.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-038 / P2

- **Source scope:** Grapple anchor/reel/swing capability with a named reference solver and bounded planning.
- **Non-goals:** No arbitrary rope physics completeness guarantee.
- **Acceptance:** Attachment/range/occlusion/rope length and finite-body swing fixtures; unsupported solver cannot certify.
- **Depends on:** ML-037 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [D4](docs/specifications/2026-10-16-maplab.md#d4-movement-contract-and-runtime-separation), [E2](docs/specifications/2026-10-16-maplab.md#e2-deterministic-graph-building-pipeline), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Author grapple anchor/range/occlusion, reel and swing parameters with named deterministic reference solver.
  2. Bound planning state/sample budget, verify finite-body swing/contact witnesses and publish unsupported cases.
  3. Create owned fixture(s): Anchor out of range, blocked line, rope length, pendulum collision and bad release.
  4. Add executable checks: Repeat solver trace and never certify unsupported rope dynamics.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-039 / P2

- **Source scope:** Teleport, launch/knockback and temporary modifier solvers, effective-profile hashing.
- **Non-goals:** No combat damage resolution.
- **Acceptance:** Destination body clearance, launch recoverability, modifier stack/clamp, cache invalidation and zero-heuristic shortcut fixtures.
- **Depends on:** ML-038 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [D4](docs/specifications/2026-10-16-maplab.md#d4-movement-contract-and-runtime-separation), [E4](docs/specifications/2026-10-16-maplab.md#e4-search-costs-and-scalability), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Implement teleport target body-clearance check, launch/knockback recoverability and temporary modifier stacking/clamps.
  2. Hash effective per-state profile for cache invalidation; use zero admissible heuristic when shortcuts break assumptions.
  3. Create owned fixture(s): Teleport into solid, launch recovery, stacked buff changes and stale cache.
  4. Add executable checks: Determinism, stateful route verification and forbidden destination cases.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

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
