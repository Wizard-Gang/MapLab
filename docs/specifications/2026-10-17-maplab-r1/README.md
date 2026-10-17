# MapLab architecture — Revision R1

Planning-only deliverable for `Wizard-Gang/MapLab`, researched 16–17 October 2026. No repository,
branch, PR or setting was created or changed. The live repo, RigLab and Hexframe were read through
fresh read-only clones in a scratch folder.

R1 is a **verified revision of the architecture MapLab already adopted** in ML-001
([`docs/specifications/2026-10-16-maplab.md`](https://github.com/Wizard-Gang/MapLab/blob/b0b1ff57859371be5aef7071394cb50c405d4794/docs/specifications/2026-10-16-maplab.md)).
It re-audits that spec's sources, keeps what holds up, changes five things on evidence, and adds
the pieces the adopted spec lacked. Each section marks its content **Kept**, **Changed** or
**Added**.

## Contents (directive order)

| § | File |
|---|---|
| A | [A-research.md](A-research.md): sources, evidence classes, verified behavior |
| B | [B-riglab-hexframe-review.md](B-riglab-hexframe-review.md): reuse/adapt/replace with paths; the MapLab repo's state |
| C | [C-product.md](C-product.md): workflows, modes, tools, viewport, interactions |
| D | [D-world-physics.md](D-world-physics.md) and [D-reference-controller.md](D-reference-controller.md): coordinates, geometry, footholds, traversal, layers; controller and profiles |
| E | [E-navigation.md](E-navigation.md): graph, generation, search, invalidation, flight, budgets |
| F | [F-formats.md](F-formats.md), [contract/](contract/) (type-checked TypeScript), [examples/forest/](examples/forest/), [examples/forest-export/](examples/forest-export/) |
| G | [G-engine-integration.md](G-engine-integration.md): load sequence, authority, RigLab composition, adapters |
| H | [H-editor-architecture.md](H-editor-architecture.md): modules, state, storage, rendering, workers, launcher |
| I | [I-validation-acceptance.md](I-validation-acceptance.md): fixtures, test layers, engine conformance, final scenario |
| J | [J-implementation-queue.md](J-implementation-queue.md): repo status, how R1 lands, ML-001…ML-044 with R1 deltas |
| K | [K-decisions-risks.md](K-decisions-risks.md): decisions, rejected alternatives, risks, open questions |
| — | [NEXT-SESSION-PROMPT.md](NEXT-SESSION-PROMPT.md) |

## Recommendation

Keep the adopted architecture's backbone:

- a standalone React/TS/Vite tool,
- footholds and bodies as physical authority, separate from art,
- capability-specific navigation certified by replaying the reference controller,
- catalog-driven gameplay data,
- deterministic JCS bundles with SHA-256 inventories,
- Canvas 2D with workers.

**Change five things before ML-003 and ML-005 freeze them:**

1. **Controller: 60 Hz integer** sub-units (1/256 WU), with no transcendental math. This matches
   Hexframe's integer rule and RigLab's 60 Hz clips, and halves navigation replay cost. *Adopted:
   120 Hz binary64.*
2. **Coordinates: quantum 1/16 WU, range ±131,072 WU.** Every coordinate is exact in float32
   engines, and every controller predicate is exact JavaScript integer math. *Adopted: 1/256 and
   ±1,048,576.*
3. **Storage: a library folder through a loopback plugin, the RigLab pattern.** The owner uses
   Safari, which has no File System Access API and evicts IndexedDB data. *Adopted: IndexedDB plus
   download.*
4. **Durations in ticks; slope limits as exact ratios; horizontal ground speed** (MapleStory-like).
5. **Stable shape IDs** in edge references.

**Add**:

- `actors` layers with foothold `planeId` (MapleStory-style actor depth),
- a presentation-only ground-contact offset, so full-footprint slope lift doesn't look like
  hovering,
- `maplab.project` with per-document digests for torn-save detection,
- the `npm start` launcher,
- WebKit as a first-class test target,
- Y-up adapter rules (winding and one-sided chains).

**Prioritized queue** (IDs and order unchanged, J3):

1. **ML-002**: done 17 October 2026 (`3e270930`, rulesets live).
2. **ML-003** adopts R1 (owner chose option A) and builds base schemas. The prompt is in
   [NEXT-SESSION-PROMPT.md](NEXT-SESSION-PROMPT.md).
3. ML-004–007: contracts and an independent reader.
4. ML-008–016: authoring, library, export.
5. ML-017–023: controller, Test, navigation.
6. ML-024–028: gameplay, portals, camera, flight, forest acceptance.
7. ML-029–040: advanced. ML-041–044: hardening and release.

## Delta map: adopted spec section → R1

| Adopted § | R1 change | Where |
|---|---|---|
| C3 Visual layers | `actors` layer kind. Foreground decided by order. `occlusionFade` | D5 |
| C4 Camera | `platformSnap` (renamed), `climbFollow`, ticks | F2, `contract/gameplay.ts` |
| D1 Coordinates | Quantum 1/16, range ±2¹⁷, 60 Hz ticks | D1 |
| D2 Geometry | `shape.id`, support versus blocking faces, ground-contact offset | D2–D4, G3 |
| D3 Traversal | Climb `planeId`; access semantics kept | D4 |
| D4 Movement | Integer profile, rational slope, `support` enum, `drop` block | RC5 |
| F1–F5 Formats | + `maplab.project`, `maplab.world` reserved, prefab provenance, vocabulary deltas, new validated example, library form | F1–F5, `contract/`, `examples/` |
| G2 Actor composition | `groundContact`, facing-left depth profile, 60 Hz frame index | G3 |
| H1 / H4 Modules, storage | `src/library` plugin replaces IndexedDB-first storage. Boundary check | H1, H4 |
| I1 / I2 Controller, fixtures | 60 Hz integer RC4. Updated fixture numbers | RC1–RC4, I2 |
| J2 row ML-009 | Library folder, launcher, drafts only | J3 |

## Evidence of checking (planning QA, throwaway scripts)

- `contract/*.ts` type-checks under `strict`, `exactOptionalPropertyTypes` and `noUnused*`
  (TypeScript 7.0.2, the repo's pin).
- All 8 example documents, the generated `maplab.project.json` and the export manifest type-check
  against the contract with `satisfies`. A deliberately corrupted copy is rejected.
- A semantic pass over the examples reports zero errors. It checks:
  - ID grammar (it caught four camelCase IDs, now fixed),
  - quantum and range, clockwise polygons,
  - solid-edge equality, weld reciprocity,
  - access-on-path and grounded-on-support,
  - full-footprint resting anchors,
  - typed catalog calls,
  - cross-map portals, expanded prefab IDs.
- Two consecutive exports are **byte-identical**. Bundle digest:
  `0a39dafd637c7cefa184ce9f18bd909d47f3eef317de3418bb3573614bf323ea`.
- An integer simulation of RC4's flat cases confirms the forest numbers: gap landing at tick 45
  from x 480, apex 94.875 WU, rope grab at tick 10.

None of this is an implemented validator or controller.
