# Permanent implementation plan — current and future delivery queue

**Authority:** this file is the only live queue. [The specification](docs/specifications/2026-10-16-maplab.md), with the owner-approved R1 revision amended into its bodies at ML-003, governs design and holds J2, the 44-ID baseline that every task block below must match. To work, read only the active block: `sed -n '/active-queue:start/,/active-queue:end/p' implementation_plan.md`.

**Selection and retirement:** the first open reserved ID after [the delivery chain](docs/deliveries.json) is the only executable task and sits alone in the active block. Every later ID stays in the future block once, in order. After a verified protected squash and resulting main CI, the next activation appends the predecessor's evidence to the delivery chain, retires it to one history line, promotes exactly the next ID and leaves all later tasks untouched. Never reuse, renumber, skip, implement early or silently delete IDs. An oversized task needs a separately governed queue/spec revision first.

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
<!-- completed-history:end -->

## Current first-open task

<!-- active-queue:start -->
### ML-016 / P0

- **Source scope:** Deterministic dependency-closed export, inventory/hash verification and STORE ZIP.
- **Non-goals:** No external-map resolution or derived nav cache export.
- **Acceptance:** Repeat exports byte-identical; independent harness verifies final bytes; path/size/unlisted-file/digest corruption rejects.
- **Depends on:** ML-015 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [F4](docs/specifications/2026-10-16-maplab.md#f4-tileset-prefab-and-export-examples), [F5](docs/specifications/2026-10-16-maplab.md#f5-canonicalization-versions-and-migrations), [G1](docs/specifications/2026-10-16-maplab.md#g1-exact-load-sequence), [H4](docs/specifications/2026-10-16-maplab.md#h4-project-storage-and-safe-assets), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Collect transitive required map/movement/catalog/assets and local schema closure; canonicalize properties, numbers and semantic arrays.
  2. Build deterministic STORE ZIP with fixed metadata and final-byte SHA-256 inventory; independently verify final files and reject corruption.
  3. Create owned fixture(s): Forest+clearing bundle, unlisted entry, duplicate paths, zip bomb, altered digest, missing dependency.
  4. Add executable checks: Repeat export byte equality and independent process bundle verification.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

<!-- active-queue:end -->

## Preserved future reserved tasks

<!-- future-queue:start -->
### ML-017 / P0

- **Source scope:** Reference controller flat/slope/wall/ceiling collision, finite rect stance, sweep/contact ordering.
- **Non-goals:** No jump, climbing, actor combat or future-engine parity claim.
- **Acceptance:** Contact fixture matrix including slope lift, seams, corners, thin wall and overlap; deterministic repeat replay.
- **Depends on:** ML-016 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [D2](docs/specifications/2026-10-16-maplab.md#d2-physical-geometry-and-authority), [D4](docs/specifications/2026-10-16-maplab.md#d4-movement-contract-and-runtime-separation), [I1](docs/specifications/2026-10-16-maplab.md#i1-reference-controller-identity), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Implement named deterministic reference controller's finite rectangular stance, static shape sweep, ordered contacts and slope projection.
  2. Track exact support IDs/normals and profile constraints; serialize replay trace with version and digest.
  3. Create owned fixture(s): Flat/run/brake, slope lift, welded seam, initial overlap, thin wall and corner tie-break.
  4. Add executable checks: Contact I2 replay at intermediate ticks and deterministic repeat.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-018 / P0

- **Source scope:** Fixed/variable-height ground jump, falling, one-way landing and targeted drop suppression.
- **Non-goals:** No extra jumps/dash/wall abilities.
- **Acceptance:** Reachable/blocked/ceiling/drop fixtures; body sweep and lower-platform rearm verified; reference trace format published.
- **Depends on:** ML-017 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [D3](docs/specifications/2026-10-16-maplab.md#d3-traversal-and-anchors), [D4](docs/specifications/2026-10-16-maplab.md#d4-movement-contract-and-runtime-separation), [I1](docs/specifications/2026-10-16-maplab.md#i1-reference-controller-identity), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Add ground takeoff, fixed/variable-height jump and fall with one-way upward pass/downward landing.
  2. Implement targeted drop-group suppression, rearm and solid-floor refusal on continuous body sweeps.
  3. Create owned fixture(s): Forest gap, impossible high target, low ceiling, release early, upper one-way and lower platform.
  4. Add executable checks: Tick replay/landing and resource tests with support identity.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-019 / P0

- **Source scope:** Ladder/rope authoring and reference attach/climb/dismount; grounded/air access/exit validation.
- **Non-goals:** No physical swinging/grapple solver.
- **Acceptance:** Ladder top/bottom/invalid exit and airborne rope fixtures; permissions enforced; debug support reports correct.
- **Depends on:** ML-018 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [D3](docs/specifications/2026-10-16-maplab.md#d3-traversal-and-anchors), [D4](docs/specifications/2026-10-16-maplab.md#d4-movement-contract-and-runtime-separation), [I1](docs/specifications/2026-10-16-maplab.md#i1-reference-controller-identity), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Add ladder/rope authoring with bounded access/exit anchors, direction/grab radius and ability validation.
  2. Extend reference controller to attach, climb, dismount and airborne rope release with validated body clearance.
  3. Create owned fixture(s): Ladder top/bottom/midpoint, airborne rope, blocked ceiling exit, missing ability.
  4. Add executable checks: Controller trace/semantic access tests with explicit unsupported diagnoses.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-020 / P0

- **Source scope:** Integrated Test snapshot, generic debug actor, pause/step/reset/replay and movement/contact HUD.
- **Non-goals:** No AI/combat/inventory simulation.
- **Acceptance:** Forest walk/jump/climb/drop replay works without RigLab; author history/source unchanged; current foothold/velocity/state visible.
- **Depends on:** ML-019 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [C2](docs/specifications/2026-10-16-maplab.md#c2-modes-and-tools), [D4](docs/specifications/2026-10-16-maplab.md#d4-movement-contract-and-runtime-separation), [I1](docs/specifications/2026-10-16-maplab.md#i1-reference-controller-identity), [I4](docs/specifications/2026-10-16-maplab.md#i4-fundamental-acceptance-run), [H2](docs/specifications/2026-10-16-maplab.md#h2-state-and-history); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Create immutable integrated Test snapshot plus generic debug actor, pause/step/reset/replay and HUD contacts/state/velocity.
  2. Use the same reference controller as navigation; isolate ephemeral Test state from source and undo history.
  3. Create owned fixture(s): Forest walk/jump/climb/drop replay without RigLab, pause/reset, source-history checksum.
  4. Add executable checks: Browser Test and deterministic trace tests; no AI/combat/inventory simulation.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-021 / P0

- **Source scope:** Profile-specific accessible support intervals and surface/climb graph; worker revision/cancel protocol.
- **Non-goals:** No jump graph or advanced search.
- **Acceptance:** Slope/clearance/material/directional intervals correct; no-jump enemy walk/climb permissions differ; stale job cannot publish.
- **Depends on:** ML-020 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [E1](docs/specifications/2026-10-16-maplab.md#e1-representations-and-guarantees), [E2](docs/specifications/2026-10-16-maplab.md#e2-deterministic-graph-building-pipeline), [E4](docs/specifications/2026-10-16-maplab.md#e4-search-costs-and-scalability), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Generate profile-specific support intervals from clearance, one-way/material/direction restrictions and connected climb surfaces.
  2. Implement revisioned worker message/cancel protocol and cache keys tracking world+controller+profile digests.
  3. Create owned fixture(s): Slope support, narrow clearance, hazardous materials, no-jump ground enemy, cancelled old job.
  4. Add executable checks: Graph snapshot validity tests and stale-result rejection.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-022 / P0

- **Source scope:** Single-jump/fall/drop candidate generator and finite-body reference witnesses.
- **Non-goals:** No completeness claim, multi-jump or moving-platform graph.
- **Acceptance:** Forest gap witness replays; narrow/corner/ceiling failures; deterministic samples/budget/status and dependency hash tests.
- **Depends on:** ML-021 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [E2](docs/specifications/2026-10-16-maplab.md#e2-deterministic-graph-building-pipeline), [E3](docs/specifications/2026-10-16-maplab.md#e3-one-way-drops-dynamic-movement), [D4](docs/specifications/2026-10-16-maplab.md#d4-movement-contract-and-runtime-separation), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Generate bounded directed jump/fall/drop candidate launch states from accessible intervals and clearance checks.
  2. Replay every accepted candidate through finite-body reference controller, recording witness inputs, statuses and dependency hashes.
  3. Create owned fixture(s): Forest gap, ceiling/corner impossible jump, narrow stance, budget exceeded, profile edit.
  4. Add executable checks: Witness determinism and invalidation/no-completeness-claim tests.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-023 / P0

- **Source scope:** Augmented A*/Dijkstra, same-surface alignment, full-route replay, Navigation mode and enemy patrol proof.
- **Non-goals:** No runtime AI or assumed feasible author links.
- **Acceptance:** A*=Dijkstra cost fixtures; incompatible chain rejects/refines; no-route differs from unreachable; no-jump enemy cannot cross gap.
- **Depends on:** ML-022 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [E4](docs/specifications/2026-10-16-maplab.md#e4-search-costs-and-scalability), [E5](docs/specifications/2026-10-16-maplab.md#e5-enemy-authoring-and-proof-boundary), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix), [I4](docs/specifications/2026-10-16-maplab.md#i4-fundamental-acceptance-run); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Implement weighted A*/Dijkstra with compatible incoming/outgoing state, same-surface alignment and complete-route witness replay.
  2. Expose Navigation mode, route breakdown and enemy patrol proof/unsupported states.
  3. Create owned fixture(s): A* vs Dijkstra cost, mismatched terminal velocity, player gap, no-jump patrol, unreachable vs no route.
  4. Add executable checks: Whole-route replay; no fabricated feasible links.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-024 / P0

- **Source scope:** Typed gameplay/region/spawn/route/encounter/trigger inspectors and declarative test-event boundary.
- **Non-goals:** No combat, executable scripts, arbitrary behavior graphs.
- **Acceptance:** All F gameplay types inspect/edit before engine implementation; full-body trigger timing/once/order fixtures; boss event injection clear.
- **Depends on:** ML-023 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [C2](docs/specifications/2026-10-16-maplab.md#c2-modes-and-tools), [F2](docs/specifications/2026-10-16-maplab.md#f2-normative-typescript-contract-sketch), [F3](docs/specifications/2026-10-16-maplab.md#f3-concrete-complete-numeric-acceptance-world), [E5](docs/specifications/2026-10-16-maplab.md#e5-enemy-authoring-and-proof-boundary), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Provide typed inspectors for every spawn/region/waypoint/route/trigger/encounter/entity with closed catalog bindings.
  2. Create declarative Test event injection and deterministic full-body trigger entry/exit, once and ordering semantics.
  3. Create owned fixture(s): Forest enemy/boss region, high-speed enter/exit, simultaneous events, reset once, wrong handler kind.
  4. Add executable checks: Inspector save/reopen and event-sequence tests; no combat/script executor.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-025 / P0

- **Source scope:** Cross-map portal authoring, destination validation and Test map transition/reentry policy.
- **Non-goals:** No world streaming or remote map fetch.
- **Acceptance:** Forest→clearing works after injected clear event; bad target fails; no touch-loop; source documents stay unchanged.
- **Depends on:** ML-024 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [F3](docs/specifications/2026-10-16-maplab.md#f3-concrete-complete-numeric-acceptance-world), [G1](docs/specifications/2026-10-16-maplab.md#g1-exact-load-sequence), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix), [I4](docs/specifications/2026-10-16-maplab.md#i4-fundamental-acceptance-run); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Add portal destination pickers, dependency checks, arrival anchors, activation/flag rules and reentry policy.
  2. Support forest-to-clearing Test snapshot transitions without modifying source maps or fetching remote content.
  3. Create owned fixture(s): portal.clearing/start.arrival, broken target, boss-cleared flag, touch-loop and reentry reset.
  4. Add executable checks: Independent load plus injected clear-event portal trace.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-026 / P0

- **Source scope:** Camera/environment zone authoring and reference camera/audio intent preview.
- **Non-goals:** No engine camera parity or advanced audio mixer.
- **Acceptance:** Tall jump/drop/ladder/stacked-floor/small-bounds fixtures; locked center/zone precedence deterministic; no physics feedback.
- **Depends on:** ML-025 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [C4](docs/specifications/2026-10-16-maplab.md#c4-camera-and-environment-behavior), [F2](docs/specifications/2026-10-16-maplab.md#f2-normative-typescript-contract-sketch), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Author camera default/zones and environment audio/visual intent with deterministic region priority.
  2. Preview viewport footprint, grounded hysteresis, locked-center confinement and transitions as read-only Test overlays.
  3. Create owned fixture(s): Tall jump, stacked floors, long drop, ladder, small bounds and boss zone.
  4. Add executable checks: Camera numerical tests; preview never feeds physics.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-027 / P0

- **Source scope:** Basic flight free-space planner/controller and mode-volume bindings for flying patrols.
- **Non-goals:** No swim/grapple or generalized kinodynamic optimizer.
- **Acceptance:** Full-body flight route inside fixture volume; obstacle/narrow-clearance/turn cases; ground graph not reused.
- **Depends on:** ML-026 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [E1](docs/specifications/2026-10-16-maplab.md#e1-representations-and-guarantees), [E2](docs/specifications/2026-10-16-maplab.md#e2-deterministic-graph-building-pipeline), [E5](docs/specifications/2026-10-16-maplab.md#e5-enemy-authoring-and-proof-boundary), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix), [I4](docs/specifications/2026-10-16-maplab.md#i4-fundamental-acceptance-run); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Implement separate obstacle-aware 2D free-space flight search and acceleration/turn-limited reference movement.
  2. Bind mode volumes and profile/mask constraints to authored flying patrol and fallback reports.
  3. Create owned fixture(s): region.flight/route.flyer, narrow clearance, obstacle, turn radius, outside volume.
  4. Add executable checks: Full-body fly witness and ground-graph separation tests.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-028 / P0 milestone

- **Source scope:** Fundamental forest acceptance integration and independent consumer construction test.
- **Non-goals:** No new feature family or actual boss combat.
- **Acceptance:** All baseline I4 steps pass from exported bytes, with repeat digest and independent world construction; fix only scenario integration defects.
- **Depends on:** ML-027 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [F3](docs/specifications/2026-10-16-maplab.md#f3-concrete-complete-numeric-acceptance-world), [F4](docs/specifications/2026-10-16-maplab.md#f4-tileset-prefab-and-export-examples), [G1](docs/specifications/2026-10-16-maplab.md#g1-exact-load-sequence), [I4](docs/specifications/2026-10-16-maplab.md#i4-fundamental-acceptance-run), [I3](docs/specifications/2026-10-16-maplab.md#i3-validation-layers-and-release-gates); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Execute end-to-end I4 forest+clearing scenario using exported bytes, generic actors, overlays and declared events.
  2. Have a separate consumer reconstruct geometry, spawns, patrol, camera intent and portal transition with repeatable hashes.
  3. Create owned fixture(s): Owned forest numerical integration: gap/slope/ladder/rope/boss event/portal; no-jump ground enemy and flyer.
  4. Add executable checks: I4 checklist and reproducible digest; integration defects only, no new feature family.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-029 / P1

- **Source scope:** Prefab create/place/expand/edit provenance, including assets/flags/presentations/internal refs.
- **Non-goals:** No recursive prefabs/live override propagation.
- **Acceptance:** IDs remapped; layer slots bound; two placements independent; dependency closure and undo correct.
- **Depends on:** ML-028 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [C3](docs/specifications/2026-10-16-maplab.md#c3-visual-layers-and-reusable-content), [F4](docs/specifications/2026-10-16-maplab.md#f4-tileset-prefab-and-export-examples), [H2](docs/specifications/2026-10-16-maplab.md#h2-state-and-history), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Implement prefab creation/placement/expansion with explicit slot binding and provenance tracking.
  2. Remap every nested stable ID/reference/flag/presentation and dependency on each independent placement; preserve inverses.
  3. Create owned fixture(s): prefabs/tree-marker.prefab.json and two placements with overlapping local IDs.
  4. Add executable checks: Placement, export closure and undo golden tests; no recursive/live overrides.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-030 / P1

- **Source scope:** Optional RigLab bundle verification, baked presentation and explicit anchor/art/action bindings.
- **Non-goals:** No IK/skeleton/weapon editor or physics root motion.
- **Acceptance:** Supported format versions/hash fixtures; unbaked/missing-art placeholder; mirrored matrices; rig animation cannot change actor traces.
- **Depends on:** ML-029 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [B2](docs/specifications/2026-10-16-maplab.md#b2-actual-export-and-coordinate-contracts), [G2](docs/specifications/2026-10-16-maplab.md#g2-actor-composition-and-riglab-import), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Validate optional RigLab bundle version/digest, bounded baked presentation, scale/coordinate and action/anchor bindings.
  2. Draw inert placeholders for unsupported/unbaked art; mirror presentation matrices without root-motion or collider authority.
  3. Create owned fixture(s): Pinned RigLab sample, missing-art, unbaked, mirrored armor frames and malicious reference.
  4. Add executable checks: Import rejection and unchanged controller traces with/without art.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-031 / P1

- **Source scope:** Runtime blocker overlay and regional navigation invalidation/replan preview.
- **Non-goals:** No arbitrary gameplay AI or moving-platform rendezvous.
- **Acceptance:** New blocker invalidates empty-space witness; deletion opens candidates; art-only edit stays warm; bounded cancellation.
- **Depends on:** ML-030 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [E3](docs/specifications/2026-10-16-maplab.md#e3-one-way-drops-dynamic-movement), [E4](docs/specifications/2026-10-16-maplab.md#e4-search-costs-and-scalability), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Overlay runtime blockers on immutable source nav data and index affected geometry/witness regions.
  2. Invalidate/replan bounded candidates on insertion/removal using cancellable revisioned jobs; preserve art-only cache warmth.
  3. Create owned fixture(s): Blocker enters empty swept corridor, deletion opens jump candidate, stale job, sprite-only edit.
  4. Add executable checks: Incremental-vs-clean rebuild comparison and cancellation budget tests.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-032 / P1

- **Source scope:** Rigid translation moving-platform/elevator authoring and reference carry/departure/crush semantics.
- **Non-goals:** No rotating platforms, timed navigation or swing.
- **Acceptance:** Carry/jump-off/initial phase/disable/crush fixtures; navigation labels unsupported timed links.
- **Depends on:** ML-031 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [D4](docs/specifications/2026-10-16-maplab.md#d4-movement-contract-and-runtime-separation), [E3](docs/specifications/2026-10-16-maplab.md#e3-one-way-drops-dynamic-movement), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Author rigid translating body motion phase and finite contact/carry/depart/disable/crush states.
  2. Show moving links as unsupported until the later timed navigator; never certify static rendezvous.
  3. Create owned fixture(s): Elevator carry, jump-off, initial phase, disable, crush/pinch.
  4. Add executable checks: Deterministic controller trace and explicit unsupported nav states.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

### ML-033 / P1

- **Source scope:** Additional airborne jumps and bounded stateful navigation primitive search.
- **Non-goals:** No treating extra jumps as a radius multiplier.
- **Acceptance:** Charge-reset/consumption and player-profile-specific chained witness fixtures; unchanged world schema.
- **Depends on:** ML-032 completed and passing main CI, plus all named prerequisites in source scope; no parallel implementation.
- **Specification:** [D4](docs/specifications/2026-10-16-maplab.md#d4-movement-contract-and-runtime-separation), [E2](docs/specifications/2026-10-16-maplab.md#e2-deterministic-graph-building-pipeline), [I2](docs/specifications/2026-10-16-maplab.md#i2-fixture-matrix); authoritative full contract: [2026-10-16-maplab.md](docs/specifications/2026-10-16-maplab.md).
- **Subtasks:**
  1. Add stateful extra-jump charges, air/ground reset and bounded candidate state expansion.
  2. Generate chained full-body witnesses with consumed/remaining resources, not expanded jump radii.
  3. Create owned fixture(s): Player double jump vs ground-only profile, consumption/reset and stale resource cache.
  4. Add executable checks: Controller and entire-route chained witness fixture.
- **Task gate:** Source scope and non-goals intact; fixture failures are negative tests; run clean `npm ci`, `npm run check`, `npm run security`, exact PR-head `verify/change-id/security`, independent review and authenticated policy/delivery read-back. No merge without protected gates and successful predecessor main CI. Acceptance above must be demonstrably satisfied, not asserted.

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
