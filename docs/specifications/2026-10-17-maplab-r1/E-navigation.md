# E. Navigation architecture

The adopted design (*adopted §E1–E5*) is sound and **Kept**:

- a directed, multimodal, capability-specific graph per profile and controller,
- witness replay,
- honest result statuses,
- separate free-space models for flight and swimming,
- generated data that is always derived and never authoritative.

R1 makes it concrete for the integer 60 Hz controller (D-reference-controller) and adds the
evidence-backed details below. Surfacer's documented drift and immutability problems (A5) are the
two failure modes this design is built to avoid.

## E1. Guarantees and statuses (Kept)

Every query result names the profile digest, controller identity, world revision and dynamic
assumptions, and is exactly one of:

- **verified reachable**: the whole route replayed exactly,
- **no route within budget**,
- **proven blocked**: for a stated restricted case only, such as "apex < required rise with no
  other ability",
- **unsupported**,
- **stale**,
- **cancelled**.

Finite sampling never proves impossibility.

## E2. Graph structure

**Surfaces.** Maximal chains of footholds welded through `connections` that are walkable for the
profile. Unregistered support faces are excluded, because navigation requires authored identity.

**Standing intervals.** On each surface, the foot-x ranges where the profile's rect:

- has support under its footprint (RC2), and
- intersects no blocking face (full-body clearance), with ceilings checked over the whole rect
  height.

Intervals split at changes of material, `direction`, hazard tags, `planeId`, access points,
explicit-link endpoints and drop groups. With `fullFootprint`, physics lets the rect overhang a
chain end by up to w/2. **Resting anchors** (spawns, waypoints, starts) additionally require
*full* footprint coverage (*adopted §E2*, **Kept**).

**Nodes** are `(intervalId, footX, velocityClass, mode, resources)`.

- `velocityClass` is one of `rest`, `run-left`, `run-right` and refined bins.
- `resources` is only present when the profile has stateful abilities.
- Node keys are derived content keys, never authored IDs.

**Edges**, each carrying `{key, from, to, kind, solver, requiredAbilities, conditions, costTicks,
penaltyTicks, witnessKey, sourceIds, sweptBounds, status}`:

| Kind | Generation | Phase |
|---|---|---|
| `walk` | Inside one interval, computed lazily during search, as in Surfacer. Cost = exact ticks under RC4 acceleration, including run-up for a moving launch class | ML-021 |
| `transfer` | Across a weld whose slope and clearance allow it | ML-021 |
| `fall` | Walk off an interval end at each velocity class, replayed to first landing | ML-022 |
| `drop` | Drop-through from sampled x on a `dropAllowed` one-way surface | ML-022 |
| `jump` | Single ground jump, from candidate takeoff x, velocity class and hold schedule | ML-022 |
| `climbMount` / `climb` / `climbExit` / `climbJumpOff` | Per access point and path segment; airborne mounts come from jump/fall candidates crossing the grab region | ML-019/021 |
| `portal` | From the portal region's standing interval to the destination entity's resolved stance. Cost = activation delay | ML-025 |
| `link` | Explicit author intent, conditional, typed by catalog action. Feasible only under a supporting solver | ML-023 |
| `airJump`, `dash`, `wallSlide`, `wallJump`, `wallClimb`, `ledgeGrab`, `ledgeClimb`, `grapple`, `teleport`, `launch` | Stateful solvers, each a later controller version or module | ML-033–039 |
| `ride` | Phase-aware moving-platform boarding. Static caches never certify it | ML-040 |

## E3. Deterministic generation pipeline

These are the adopted 8 steps (*adopted §E2*), with R1 specifics:

1. **Normalize and index.** Build a uniform-grid spatial index of faces (default cell 256 WU).
   Classify faces per profile (RC3).
2. **Intervals** (E2). Clearance comes from exact integer rect-versus-face tests on the D1 grid.
3. **Reach envelope.**
   - The apex `H` and airtime come from the discrete formula (RC5) per jump variant.
   - Horizontal reach is `maxSpeed × airtime` for each rise `Δh`.
   - The fall depth considered is bounded by world bounds or `settings.maxFallTicks`.
   - Only target intervals whose AABB intersects the envelope are candidates. This is the
     O(S log S) pruning step; all-pairs is never used.
4. **Analytic takeoff windows.**
   - For a target at rise `Δh`, the landing tick `n(Δh)` is exact under RC4.
   - The horizontal travel window is `[n·vmin, n·vmax]` per velocity class and air-control
     schedule.
   - This yields takeoff x windows. Candidates are each window's ends and midpoint, plus
     **obstacle-critical** x values where the swept rect grazes an intervening corner (from the
     index).
   - This is cheap math, not proof.
5. **Replay.**
   - Each candidate's input schedule runs through `stepController` (RC4) from the source stance.
   - The schedule is one of: full-hold run, release at k ∈ `settings.jumpHoldTicks`, delayed air
     control d ∈ `settings.airControlDelays`, or neutral.
   - The candidate is **accepted only if the first support contact is the target interval** and no
     error status occurred.
   - The witness stores per-tick inputs (run-length encoded), checkpoints every 15 ticks, terminal
     state, the contact sequence, and the **swept AABB**: the union of the rect over all ticks.
6. **Climb and mode transitions** use the same replay for mounts, exits and jump-offs. Flight and
   swim use E7.
7. **Resource expansion** applies only when the profile has stateful abilities. It keeps dominance
   pruning on (state ⊑ state′ when every resource is ≥ and cooldowns are ≤). It keeps a bounded
   action depth.
8. **Publish atomically**, with sorted keys, settings and full cache identity. A stale worker reply
   (old document or profile revision) is discarded.

**R1 cost argument.** Generation time is dominated by replay ticks T. At 60 Hz a typical jump is
40–90 ticks, half the adopted 120 Hz cost. Analytic windows cut the schedules per pair B from a
lattice to about 3–9 per variant.

## E4. Search (Kept, with R1 heuristic)

- **Dijkstra** (`h = 0`) is the correctness baseline.
- **A\*** uses `h = ⌈|Δx| / maxHorizontalSpeed⌉` ticks. That is admissible only while no enabled
  edge kind moves faster horizontally, so `dash`, `teleport`, `portal` and `launch` force `h = 0`
  or landmark (ALT) bounds (A5).
- The search starts from the actor's actual state: support, mode, velocity class, resources.
- Goals are an anchor or region plus a stance constraint.
- Walk edges are computed during the search, and same-surface alignment is exact.
- **The whole chained route replays** before it is reported verified. A failed chain blacklists the
  incompatible transition and searches again within budget.
- Directed edges are never mirrored: a jump up implies no fall back.

## E5. Dynamic obstacles and invalidation

**Runtime (engine) behavior.**

- Each edge stores `sweptBounds`, and edges sit in a spatial index.
- When a blocker appears (a door closes, a destructible respawns, a gate enables), the engine
  disables every edge whose swept bounds intersect the blocker's AABB. That is conservative, and
  Godot AStar2D's disabled points show the pattern exists in shipping engines (A3).
- The engine may then re-validate exactly by replay, and it replans affected agents.
- When a blocker disappears, the engine re-enables the edges it disabled. Regional regeneration
  inside the blocker AABB, inflated by the reach envelope, may add new edges. That needs MapLab's
  generator or the engine's own.
- A static cache never assumes a door opens without a declared action and capability.

**Editor behavior.**

- Every geometry, material, traversal or nav-intent edit produces a dirty AABB.
- Invalidation covers edges whose swept bounds intersect it, plus candidate pairs whose envelopes
  intersect it.
- Regeneration runs only for those pairs, in a worker, with cancellation.
- **Art-only edits never invalidate.**
- Profile digest changes rebuild that profile's graph. Other profiles stay warm.

**Cache identity** (*adopted §E4*, **Kept**) adds R1's `units` and controller version. A profile's
version string is never enough.

## E6. Enemy authoring proof (Kept, with R1 specifics)

- **Patrol verified** means every route leg, plus the closing leg for loops and ping-pong, replays
  under the **enemy's own** profile, with its declared start resources and blocker assumptions.
- MapleStory's `rx0`/`rx1` single-platform patrol is a two-waypoint ping-pong route on one
  interval. Validation checks both waypoints sit inside one standing interval for that profile.
- In the forest fixture, the no-jump ground enemy proves only its west-floor patrol. A route leg
  across the gap reports **no route within budget**, with the reason "no edge kind for this
  profile crosses …". The leg would need `jump`, which `movement.ground` lacks.
- Runtime invalidation follows the route's `invalidRoute` policy:
  - `wait`, `safeStop`, `returnHome` or a registered fallback,
  - never teleporting the enemy,
  - never granting a missing ability.

## E7. Flying and swimming (Kept model, R1 parameters)

- **Free space** is the union of the profile's matching mode volumes (`navigation.modeVolumes`), or
  world bounds when the profile has none.
- Blocking faces are inflated by the collider half-extents. The configuration-space grid uses a
  default **8 WU cell**, with exact rect-versus-face clearance per cell.
- A* runs on the grid with an octile heuristic in ticks at `fly.speed`, then any-angle shortcut
  smoothing.
- Each smoothed leg replays through the controller's `fly` mode (ML-027). Turn and acceleration
  limits come from the profile.
- The ground graph is never reused for flyers, and flyer routes never use footholds.
- **Swimming** uses the same model inside `swim` volumes. Entry and exit are transition witnesses
  (ML-037).

## E8. Performance strategy and budgets

`S` = support faces, `K` = candidate pairs after envelope pruning, `B` = schedules per pair, `T` =
ticks per replay, `C` = broadphase cost.

**Generation** costs about `O(S log S + K·B·T·C)`. **Search** costs about `O((V+E) log V)` per
query.

| Workload | Target (Chromium baseline, worker) |
|---|---|
| Forest fixture (≈10 footholds, 3 profiles) | Full graph ≤ 200 ms per profile |
| Owned 300-foothold multi-level map | First full graph ≤ 2 s per profile. Progress at least every 250 ms. Cancel ≤ 100 ms |
| Single foothold edit | Incremental regeneration ≤ 150 ms (p95) |
| Query on a 2,000-node / 8,000-edge graph | p95 ≤ 5 ms without replay. Full-route replay ≤ 20 ms |
| Large map (10,000 footholds, H5 fixture) | Bounded jobs with progressive overlays and honest partial status. No main-thread task > 50 ms |

**Techniques**:

- Region hierarchy (HPA-style, A5) over surface components for repeated long queries, after base
  correctness (ML-041).
- Per-profile LRU caches.
- Viewport-first generation.
- Run-length-encoded witness inputs.
- Optional checkpoint thinning in exports.

## E9. What navigation never does

- It never persists generated paths or graphs as map authority.
- It never treats an author link as feasible without its solver.
- It never infers walkability from artwork.
- It never reuses one profile's graph for another.
- It never certifies moving-platform rendezvous from a static snapshot.
- It never reports "unreachable" when it means "not found within budget".
