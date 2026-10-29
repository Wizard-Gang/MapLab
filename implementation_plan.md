# Permanent implementation plan — current and future delivery queue

**Authority:** this file is the only live queue. [The specification](docs/specifications/2026-10-16-maplab.md), with the owner-approved R1 revision amended into its bodies at ML-003, governs design; its J2 table is the original 44-ID baseline, and the queue below may depart from it. To work, read only the active block: `sed -n '/^<!-- active-queue:start/,/^<!-- active-queue:end/p' implementation_plan.md`.

**Editing the plan (owner ruling, 2026-10-27):** any PR may add, edit, reorder or remove queued tasks at any time, whatever the queue holds. A PR that changes only this file is titled `[PLAN] Imperative summary` on a `plan-<summary>` branch into the open release branch; it takes no task ID and joins no release task list. IDs are unique and never recycled: a new task takes the ID above the mark below, which then rises to it, and a removed queued ID is retired for good, so IDs need not be contiguous.

**Highest ID ever used:** ML-053.

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

### ML-051 / P2 operations (baseline delivery contract)

- **Source scope:** On 2026-10-29 the labs' copies of baseline's delivery scripts, launcher and workflows had drifted into two to four versions each, so baseline queued BASE-045…050 to host one shared copy under a pinned `contract/` lock. Vendor `contract/` from the merged baseline commit that holds BASE-045 and BASE-046, with its `contract/vendor.lock.json`, and replace MapLab's forked delivery scripts that the vendored copy covers (change and release checks, delivery verification, repository policy) with it, keeping MapLab-specific values in `config/` and the MapLab-only queue check (`scripts/check-queue.mjs`) local. Replace `repository-policy.mjs`, `policy:check` and `policy:apply` with the shared settings-as-code scripts. Remove `delivery:verify` and the "evidence package" wording, per the 2026-10-27 no-records ruling. Carry baseline `AGENTS.md` and `CONTRIBUTING.md` byte for byte, move MapLab's invariants (standalone boundary, source/derived/runtime separation, finite-body witness and qualified nav claims, semantic reference/ID stability, owned CC0 fixture provenance, negative tests and independent-consumer proof) to `README.md`, and drop the lab's own "Keep sessions cheap" section because the owner rulebook already covers it.
- **Non-goals:** No change to the required check names, rulesets or strict current-with-base policy, no product code, no rewrite of specification text, and no hand edit of a vendored file.
- **Acceptance:** The conformance `pin` check passes against the lock; MapLab's `gate`, `change-id`, `verify` and `security` keep their names and decisions; `AGENTS.md` matches baseline's hash; `delivery:verify`, `policy:check` and `policy:apply` are gone and no process document or script refers to them or to an evidence package.
- **Depends on:** Baseline release r002 (BASE-045 and BASE-046) merged to baseline `main`; no parallel implementation with a task that edits the delivery scripts.
- **Specification:** [J1](docs/specifications/2026-10-16-maplab.md#j1-repository-and-change-governance), [I3](docs/specifications/2026-10-16-maplab.md#i3-validation-layers-and-release-gates); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Vendor `contract/` and `contract/vendor.lock.json` from the merged baseline commit, record that commit in `config/`, delete the superseded forks and point the `package.json` scripts at the vendored copies.
  2. Swap `policy:check` and `policy:apply` for the shared settings-as-code scripts over `config/github-repository-settings.json`, remove `delivery:verify` and the evidence-package wording, and carry `AGENTS.md` and `CONTRIBUTING.md` from baseline byte for byte.
  3. Create owned fixture(s): A tampered vendored file, a stale lock, a diverged `AGENTS.md` and a leftover `delivery:verify` reference, each of which must fail the `pin` or foundation check.
  4. Add executable checks: Run the conformance `pin` check in the foundation gate, keep the existing change-id and release negative cases passing on the vendored scripts, and link-check the invariants moved to `README.md`.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check` (met by CI), `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back, plus gate/change-id. No merge without protected gates. Agents run only the required non-test checks locally.

### ML-052 / P2 operations (baseline dev launcher)

- **Source scope:** MapLab's `npm start` runs `node scripts/dev.mjs` with `scripts/dev-lifecycle.mjs`, one of three different copies of the launcher across the labs; BASE-047 hosts one launcher in baseline's `contract/`. Replace both scripts with the vendored launcher, taking the repository name, port variable, default port and build steps from `config/`. Make `.gitignore` ignore only `.claude/worktrees/` and `.claude/settings.local.json`, and track a `.claude/launch.json` whose entry runs `npm start` with no absolute or `/tmp` path.
- **Non-goals:** No change to what `npm start` does for the owner beyond the vendored launcher's behavior, no toolchain beyond the pinned Node and npm, and no hand edit of a vendored file.
- **Acceptance:** `scripts/dev.mjs` and `scripts/dev-lifecycle.mjs` are gone and `npm start` runs the vendored launcher with MapLab's port and build steps; `.claude/launch.json` is tracked and passes the shared repository contract; the conformance `pin` check passes.
- **Depends on:** ML-051 merged, so the lab holds the vendored `contract/`; BASE-047 released to baseline `main`.
- **Specification:** [J1](docs/specifications/2026-10-16-maplab.md#j1-repository-and-change-governance), [I3](docs/specifications/2026-10-16-maplab.md#i3-validation-layers-and-release-gates); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Re-vendor `contract/` and its lock from the baseline commit that holds BASE-047, then replace `scripts/dev.mjs` and `scripts/dev-lifecycle.mjs` with the vendored launcher configured from `config/`.
  2. Narrow `.gitignore` to the two `.claude/` entries and add a tracked `.claude/launch.json` that runs `npm start`, with the README command map pointing at it.
  3. Create owned fixture(s): A `.gitignore` that ignores all of `.claude/` and a `launch.json` with an absolute path and one with a `/tmp` path, each of which must fail the repository contract.
  4. Add executable checks: Cover the launcher's configuration (port variable, default port, build steps) and the `launch.json` rule in the foundation gate, with the `pin` check passing on the re-vendored lock.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check` (met by CI), `npm run security`, exact PR-head `verify/change-id/security`, independent review and the shared contract's settings read-back, plus gate/change-id. No merge without protected gates. Agents run only the required non-test checks locally.

### ML-053 / P2 operations (baseline CI shape)

- **Source scope:** MapLab's `gate.yml`, `change.yml` and `verify.yml` differ from the other labs' workflows, and BASE-048 picks one CI shape for `gate`, `change-id`, `verify` and `security`. Replace MapLab's four checks' workflow files with baseline's pinned files, byte for byte under the lock and with the required check names unchanged. MapLab-specific steps (the build, the chromium and webkit browser shards, fixtures) run through package scripts, never through workflow edits.
- **Non-goals:** No change to the required check names, rulesets or strict current-with-base policy, to what the browser shards cover, or to any deploy or release workflow.
- **Acceptance:** A task PR and a release PR pass on the shared shape with `gate`, `change-id`, `verify` and `security` unchanged; the shared workflow check accepts the files; a workflow that differs from its lock fails `pin`.
- **Depends on:** ML-051 merged, so the lab holds the vendored `contract/`; BASE-048 released to baseline `main`.
- **Specification:** [J1](docs/specifications/2026-10-16-maplab.md#j1-repository-and-change-governance), [I3](docs/specifications/2026-10-16-maplab.md#i3-validation-layers-and-release-gates); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Re-vendor baseline's workflow files and lock from the commit that holds BASE-048, replacing MapLab's `gate.yml`, `change.yml` and `verify.yml` byte for byte.
  2. Move every MapLab-specific workflow step into package scripts (build, browser shards, fixture setup) so the vendored files carry no MapLab edits, and keep the `security` job's advisory scripts intact.
  3. Create owned fixture(s): A workflow edited after vendoring and a workflow that renames or drops a required check, each of which must fail the `pin` or workflow check.
  4. Add executable checks: Run the shared workflow check and the `pin` check in the foundation gate, and read the required check names back from a task PR and a release PR on the new shape.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check` (met by CI), `npm run security`, exact PR-head `verify/change-id/security`, independent review and the shared contract's settings read-back, plus gate/change-id. No merge without protected gates. Agents run only the required non-test checks locally.

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
