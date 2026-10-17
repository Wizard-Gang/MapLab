# K. Architectural decisions and risks

## K1. Decisions

Status: **K** = kept from the adopted spec, **C** = changed by R1, **A** = added by R1. "Cost
later" is the cost of reversing the decision after the named task merges.

| # | Decision (recommended default) | St. | Rejected alternatives | Evidence | Cost later |
|---|---|---|---|---|---|
| 1 | Standalone authoring app. Engines consume bytes, never the editor | K | Embed in RigLab or Hexframe | Directive §2; B3 | Very high |
| 2 | X-right/Y-down WU, **quantum 1/16, range ±2¹⁷**, durations in **60 Hz ticks** | C | Adopted 1/256 and ±2²⁰ (float32 imprecision past 65,536 WU, no exact integer predicates). 1 WU integers (no fractional snap). Decimal seconds (rounding per engine) | D1 reasoning; IEEE binary32 | High after ML-003 fixtures and assets exist |
| 3 | Footholds and bodies are physical authority. Tiles never collide; "Trace from tiles" is a one-shot draft | K | Collision derived from a tile or IntGrid layer (LDtk/Tiled style) | A2; directive §5 | Very high |
| 4 | Upright-rect **fullFootprint** stance, plus a presentation-only ground-contact offset | K+A | MapleStory point stance in v1, which needs special overlap rules beside solid bodies (kept declared for later). Capsule in v1 | A4 (JourneyClient point stance); the adopted slope-lift example | Medium: a new controller version, no map change |
| 5 | **Reference controller at 60 Hz with integer sub-units of 1/256 WU**, Hexframe integration order, exact floorDiv, no transcendental math | C | Adopted 120 Hz binary64 with end-of-tick quantization | A6: Hexframe integer rule and FPS 60; RigLab 60 Hz baked frames; MDN Math precision; GCC FMA contraction; half the replay cost | **High after ML-005/017.** Decide now |
| 6 | Slope limits as exact rationals `{rise, run}` | A | Degrees with trig | A6 | Low before ML-005 |
| 7 | Horizontal ground speed, with optional uphill/downhill ratios | C | Arc-length speed (needs square roots; less like MapleStory) | A4 JourneyClient moves x and places y on the line | Medium |
| 8 | Per-profile directed graph. **Witnesses replayed by the identical controller.** Honest statuses | K | Grid jump-value A* (A5). Navmesh plus links. Persisted paths | Surfacer drift and immutability (A5). Physics-aware A* cost (A5) | Very high |
| 9 | Candidate edges from analytic discrete-kinematics windows plus obstacle-critical x, certified by replay | A | Blind lattice sampling only (slow). Analytic only (ignores collisions) | E3 | Low: a solver version |
| 10 | Flight and swimming on a clearance grid inside mode volumes | K | Reusing the ground graph | E7 | Low |
| 11 | Catalog-driven gameplay, data-only conditions and actions, `stage: planned` for vocabulary not yet implemented | K+A | Embedded scripts or expressions. Free-form property bags | Directive §9–10 | High |
| 12 | **Storage: library folder through a loopback dev-server plugin** (RigLab pattern) with digest conflicts, backups, an index written last, and IndexedDB drafts only | **C** | IndexedDB-primary (Safari LRU eviction and the 7-day ITP cap). File System Access primary (not in Safari or Firefox). Hosted write API | A8; RigLab RL-030…035; the owner's choice that Save writes the folder | Medium before ML-009, high after |
| 13 | Library form: schema-ordered pretty JSON. Export form: JCS bytes, domain-ordered, STORE ZIP | K+A | Timestamped or unsorted output. Hashing only the top-level map | F4; RFC 8785 | Medium |
| 14 | Canvas 2D world, DOM controls, workers. WebGL only on measured failure | K | SVG DOM world (RigLab's choice suits one rig, not 100k cells). WebGL first | B1; H7 | Medium |
| 15 | Command and inverse-delta history, chunk paint deltas | K | RigLab whole-model snapshots | B1 | Medium |
| 16 | **`actors` layers plus foothold `planeId`** for depth | A | One implicit actor slot. Per-actor z integers | A4: MapleStory's per-layer foothold actor depth | Low now, medium later |
| 17 | **Stable `shape.id`** in edge references | A | Shape array index (fragile on reorder) | Adopted text needed same-transaction index remaps | Low now |
| 18 | RigLab presentation from **baked** frames only, 60 Hz frame index, explicit bindings and fallbacks | K+A | Importing RigLab IK/solvers. Inferring colliders or root motion | B2; G3 | Low |
| 19 | Y-flip adapters must reverse winding and one-sided chains | A | Leaving it to each engine | A3 Box2D one-sided chains | Low (documentation) |
| 20 | R1 lands at ML-003 with no renumbering | A | Inside ML-002 (mixes scope). Not at all (keeps the K2 risks) | B4 checker rules | — |

## K2. Risks, ranked

1. **Controller feel and parity.** Integer 60 Hz numbers may need tuning before advanced
   abilities. *Mitigation*: the "derive from feel" tool (RC5), versioned controllers with fixtures,
   and parity claims scoped per fixture (G5).
2. **Navigation cost and completeness.** *Mitigation*: envelope pruning, analytic windows,
   incremental invalidation, worker budgets, statuses that never lie (E1, E8).
3. **Governance rigidity.** The ML-002 checker locks J2 text, count and numeric order, so
   oversized tasks cannot be split mid-queue. *Mitigation*: an ordered reservation list (J2).
   Otherwise tasks such as ML-006, ML-015 and ML-024 will produce large PRs.
4. **Local write endpoint.** *Mitigation*: RigLab's proven checks (Host, Origin, Sec-Fetch-Site,
   content type, size, path confinement, symlink refusal), tests for every refusal (I2-A), loopback
   bind, no reliance on framework defaults (Vite advisory, A8).
5. **Safari performance** of a large Canvas 2D scene. *Mitigation*: measure in ML-010 rather than
   ML-041; chunk bitmaps; on-demand redraw.
6. **A long path to the first complete acceptance.** ML-028 is 27 tasks away. The owner sees the
   first viewer at ML-010 and the first playable Test at ML-020. *Mitigation*: keep each PR small,
   and show the forest in the viewer early (ML-010 renders `placeholder-library/`).
7. **RigLab contract drift.** *Mitigation*: pin the supported RigLab versions and fixture each one
   (ML-030).
8. **Two specifications in the repo during transition.** *Mitigation*: ML-003 replaces adopted
   section bodies under the same headings and marks each with "R1".
9. **SVG and asset attacks.** *Mitigation*: allowlist re-serialization, image-only rendering,
   limits, fuzzing (H4, I3).

## K3. Open questions and the cost of changing them later

| Question | Default if unanswered | Impact if changed later |
|---|---|---|
| Adopt R1 (A), adopt inside ML-002 (B), or keep the adopted spec (C)? | **A** | C keeps the K2 storage and parity risks. Switching after ML-005 is expensive |
| Should the ML-002 checker take an ordered reservation list? | Yes, in ML-002 | Without it, splits mean renumbering or large PRs |
| MapleStory point stance for the actual game feel? | `fullFootprint` in v1, point stance declared | A new controller version. No map change |
| Coyote time or jump buffering? | Not in v1 (navigation stays conservative) | A new controller version. Edges regenerate. No map change |
| Default RigLab art scale against colliders | `worldUnitsPerRigUnit = 1/2` for the chibi on 24×48 | Presentation only |
| A static or hosted viewer | Read-only static build. ML-042 stays optional | Low |
| License before first public release | MIT for code, CC0 for owned fixtures (ML-001) | ML-044 gate |
| Multi-map world layout and streaming (`maplab.world`) | Deferred. Maps keep local coordinates | Additive. No map rewrite |
