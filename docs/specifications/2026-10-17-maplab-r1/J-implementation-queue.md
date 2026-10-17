# J. Implementation queue

## J1. Where the repository stands (live, 17 October 2026)

- **ML-001** is merged (`b0b1ff57`): governance, pins, static shell, adopted spec, 44 reserved IDs.
- **ML-002 is merged** (update, 17 October 2026): squash `3e270930` from PR #1, exact head
  `f122e730`.
  - The owner's admin `gh` applied both rulesets: `MapLab main` and `MapLab immutable versions`,
    active with no bypass actors.
  - One fix landed first. GitHub stores a tag ruleset's `update` rule without the branch-only
    `update_allows_fetch_and_merge` parameter, so the policy script's read-back could never pass.
  - `delivery:verify` passed, and main CI run 39062228164 is green.
  - **The owner chose option A**, so ML-003 adopts R1.
- The ML-002 queue checker (B4) enforces:
  - exactly 44 J2 rows,
  - verbatim row text in the plan,
  - strictly sequential activation,
  - numeric order of future IDs.

  So R1 cannot add or re-order IDs. It also cannot split a task mid-queue without a checker change.

## J2. How R1 lands (decision for the owner)

R1 keeps **every reserved ID, its order and the count of 44**. Only one J2 row changes text:
**ML-009** (storage). Everything else lands as spec-body deltas under unchanged section headings,
so the checker's section anchors keep resolving.

| Option | What happens | Tradeoff |
|---|---|---|
| **A. Adopt at ML-003** (recommended) | ML-003's single PR starts by committing this revision as `docs/specifications/2026-10-17-maplab-r1/` (this folder). It edits the bodies of the affected 2026-10-16 sections, listed in this folder's README delta table (C3–C4, D1–D4, F1–F5, G2, H1, H4, I1–I2), plus the ML-009 J2 row. It keeps every heading so anchors resolve, records the owner approval in `docs/changes/ML-003.md`, then implements base schemas on R1 rules | One PR carries a docs revision plus the first schemas. That is fine, because ML-003 is the first consumer of the D1/F changes |
| **B. Adopt inside ML-002** | Add the same docs commit to the still-draft ML-002 PR before it merges | Keeps ML-003 pure, but mixes architecture into a security and governance change |
| **C. Keep the adopted spec** | Use R1 as review notes only | The four risks in K2 stay open: Safari storage, 120 Hz versus 60 Hz drift, float parity, float32 import precision |

**Also recommended for ML-002, if the owner agrees.** Let the queue checker accept an explicit
ordered reservation list instead of numeric adjacency. Then an oversized task can be split *before*
implementation, as the repo's own rules intend, without renumbering.

## J3. The reserved queue with R1 deltas

The order and IDs are unchanged. Scope, non-goals and acceptance are as in *adopted §J2*, plus the
R1 delta column. **P** is the adopted priority.

| ID | P | Scope (adopted, abbreviated) | R1 delta |
|---|---|---|---|
| ML-001 | P0 | Governed repo, pins, static shell | Done |
| ML-002 | P0 | CI, change-id, security, live settings read-back | **Done** (`3e270930`, J1). The ordered-list checker change can still come as a later reviewed plan change |
| ML-003 | P0 | Base schemas/parser: headers, IDs, coordinates, assets, dependencies, bounds, bounded parsing | **Adopt R1 (J2-A).** Quantum 1/16, range ±2¹⁷, ID and key grammar, ticks at 60 Hz. Tests for float32 exactness and the safe-integer bound |
| ML-004 | P0 | Geometry/layer/visual/tileset/prefab schemas and validators | `shape.id` and `EdgeRef.shapeId`, `actors` layer, `planeId`, clockwise polygons, `traceShapes`, `prefabPlacements` |
| ML-005 | P0 | Full movement schema, every ability family, controller/collision contract, registry | **Integer RC5 profile**: units, rational slope, `support` (only `fullFootprint` supported). Publish `maplab.reference-controller` v1 at 60 Hz with RC4 as the contract document |
| ML-006 | P0 | Gameplay/catalog/camera/env/nav-intent schemas, cross-map references | Tick durations, `platformSnap`/`climbFollow`, catalog `stage`, integer/number fields. **Size flag**: if it cannot fit one focused PR, split it before starting (needs the J2 checker change) |
| ML-007 | P0 | Independent fixture reader in a separate process | Uses `examples/forest/` and the R1 example bytes (F5) as golden inputs |
| ML-008 | P0 | Commands, history, revision, dirty, paint deltas | Dirty compares digests. Revert semantics from RigLab RL-049 |
| ML-009 | P0 | **Changed row**: Library folder through the loopback plugin (RigLab pattern) and the `npm start` launcher. New/Open/Save/Save As/Duplicate/Revert. Torn-save detection from project digests. IndexedDB drafts only | Non-goals: no hosted write API, no picker/OPFS, no writes to external libraries. Acceptance: two maps reopen with IDs intact; stale-base conflict refuses; backups precede replacement; torn save detected; wrong Host/Origin refused; placeholder read-only; WebKit and Chromium |
| ML-010 | P0 | World↔screen, Canvas viewport, grid, pan/zoom, overlay passes | Real-browser tests on **WebKit and Chromium** |
| ML-011 | P0 | Selection, move/duplicate/delete, search, inspector, clipboard | — |
| ML-012 | P0 | Foothold/collider handles, snap/weld/split/join, solid-edge ownership | Vertical strokes create wall segments. Slope readout per profile |
| ML-013 | P0 | Sparse 32² chunks, brush/rect/line/fill/erase, palette | — |
| ML-014 | P1 | Deterministic autotile, seeds, transforms | — |
| ML-015 | P0 | Sprites, layers, groups, backgrounds/foreground, asset allowlist, culling | Foreground decided by order relative to `actors` layers. SVG pipeline per H4. **Size flag** |
| ML-016 | P0 | Deterministic export, inventory, STORE ZIP | Folder and/or zip into `exports/`. Golden forest digest (F5 method) |
| ML-017 | P0 | Reference controller: flat/slope/wall/ceiling, rect stance, contact order | **60 Hz integer RC4**, exact floorDiv, no transcendental functions (lint rule), I2-K matrix |
| ML-018 | P0 | Jump, fall, one-way, drop | I2-J matrix including the forest gap. Trace format published |
| ML-019 | P0 | Ladder/rope authoring and climb | I2-L matrix |
| ML-020 | P0 | Test mode, debug actor, pause/step/replay, HUD | Parity badge. Placeholder actor (G3) |
| ML-021 | P0 | Intervals, surface/climb graph, worker protocol | E2/E3 steps 1–2. Unregistered support excluded |
| ML-022 | P0 | Single jump/fall/drop candidates and witnesses | Analytic windows plus replay (E3). Swept bounds stored |
| ML-023 | P0 | A\*/Dijkstra, alignment, route replay, Navigation mode, patrol proof | E4 heuristic rules. I2-N |
| ML-024 | P0 | Gameplay inspectors, triggers, test-event boundary | **Size flag** |
| ML-025 | P0 | Cross-map portals and Test transitions | `delayTicks`, re-entry guard |
| ML-026 | P0 | Camera/env zones, reference preview | `platformSnap` (Keren), `climbFollow` |
| ML-027 | P0 | Flight planner and controller, mode volumes | 8 WU configuration grid, replay in fly mode |
| ML-028 | P0 milestone | Forest acceptance plus independent consumer | I5 steps 1–6 |
| ML-029 | P1 | Prefab create/place/expand | `prefabPlacements` provenance |
| ML-030 | P1 | RigLab bundle verification and baked presentation | `groundContact`, facing-left depth profile, 60 Hz frame indexing (G3) |
| ML-031 | P1 | Runtime blockers, regional invalidation | Swept-bounds index (E5) |
| ML-032 | P1 | Moving platforms and elevators: carry, departure, crush | Celeste carry/push/squish semantics (A6) |
| ML-033–ML-040 | P1/P2 | Air jumps, dash, wall, ledge, swim and flight refinements, grapple, teleport/launch/modifiers, timed platforms | Integer, tick-based ability entries already in v1 (RC5). **No map schema change** |
| ML-041 | P1 | Large-world benchmarks, incremental indexes | Safari measured (H7). HPA-style regions (E8) |
| ML-042 | P1 | Optional handle/OPFS adapters, directory journal | **Unchanged text.** It now serves a possible hosted or static mode, because the plugin is primary |
| ML-043 | P1 | Migration proof, second consumer and adapter | Y-up adapter fixture (G4): winding and chain reversal |
| ML-044 | gate | Security/perf/conformance review, immutable first release | — |

## J4. The next tasks in full

**ML-002 (finish).** This finishes existing scope. Nothing new is added unless the owner chooses
J2-B or the ordered-list change.

1. Fetch `main` and PR #1.
2. Apply the committed policy with the owner's admin `gh`, then read it back
   (`policy:apply`, `policy:check`).
3. Refresh exact-head evidence and mark the PR ready.
4. Squash with the controlled subject and body.
5. Verify `main` CI. Delete the branch.

*Acceptance* is the adopted ML-002 row. *Non-goals*: no world features, no deployment.

**ML-003 (with R1 adoption).**

- **Scope**:
  - commit `docs/specifications/2026-10-17-maplab-r1/` (this folder),
  - edit the adopted section bodies from the README delta table and the ML-009 row, under
    unchanged headings,
  - implement the `src/contracts/` parser: bounded size and depth, duplicate keys rejected,
    closed objects,
  - header, ID and key grammar, quantum and range, ticks, safe paths, dependencies, bounds,
  - publish `schemas/maplab.map.v1.schema.json`, covering the header and base subset.
- **Non-goals**: geometry or gameplay schemas (ML-004–006), UI.
- **Acceptance**:
  - golden valid and invalid inputs, including camelCase IDs and off-quantum 1/256 values,
  - ±2¹⁷ edges, duplicate keys, `..` and backslash paths, unknown versions,
  - no network schema fetch,
  - float32-exact property test over the full quantum range,
  - `npm run check` green, with the queue checker passing on the edited J2.

**ML-004.**

- **Scope**: geometry, layers, visuals, tileset and prefab schemas and validators per R1 (J3 row),
  plus the forest geometry from `examples/forest/` as fixtures.
- **Acceptance**:
  - solid-edge equality by `shapeId`,
  - weld reciprocity,
  - clockwise polygons,
  - x-monotone footholds,
  - an `actors` layer is present,
  - parent cycles are rejected,
  - layer-slot binding for prefabs.
