# I. Validation and acceptance plan

## I1. Validation layers (*adopted §I3*, Kept)

Validation runs as a fixed pipeline:

1. bounded bytes,
2. closed schema,
3. references within and across documents,
4. exact geometry,
5. semantics and capability (F3),
6. optional reachability per declared profile (E),
7. export closure.

Errors block export. Warnings never suppress a missing physical requirement. Navigation validation
runs only for the profiles the map actually references.

## I2. Conformance fixture package (`conformance/`)

Each fixture is a small owned document set (CC0, per `docs/PROVENANCE.md`) with:

```text
{ id, contracts: {controller, collision, versions},
  map: <path>, profile: <path>,
  initial: {x, y, vx, vy, mode, supportId, resources}   // su, su/tick
  input: [{fromTick, moveX, moveY, run, jump, drop, dash}]  // run-length
  expect: { checkpoints: [{tick, state}], events: [...], terminal: {...}, status: "..." } }
```

A fixture index lists every fixture file with its SHA-256. The reference runner is a pure Node
function `(map, profile, initial, input) → trace` built on `src/physics-reference`. Same-version
reruns must be **bit-identical**.

### Fixture matrix

Every case below gets its own tiny map. The forest example is also a fixture.

| Group | Cases (each asserts exact traces for the reference controller) | Task |
|---|---|---|
| **C** Coordinates and edits | World↔screen round trip at DPR 1/2/3, zoom 0.25–16, negative coordinates. Half-away-from-zero quantization. Snap precedence. Resize never moves content. Split/join/paste remaps every reference | ML-003, 008, 010–012 |
| **K** Contact | Flat rest. Run acceleration and braking to exact ticks. Up/down a 0.5 slope, with the stance 6 WU above the line at the center for w=24. Snap distance. Welded seam transfer. **A 40° slope is walkable for `{1,1}` and blocks `{7,10}`.** Body-face and segment walls. Ceiling bump. A 1/16 WU thin wall at max speed without tunneling. `invalidState` on overlap. `contactBudget`. Axis-order corner catch. `unregisteredSupport` reported | ML-017 |
| **J** Jump, fall, drop | Forest gap: from x 480, land on `fh.east` at tick 45. Taking off before x ≈ 413 falls into the pit. **The 144 WU rise is proven blocked for the restricted case "single jump, apex 94.875 < 144".** Low ceiling caps the arc. One-way passes from below. Landing crossing rule. Drop through `fh.elevated` onto the platform below via group suppression. Drop refused on solid footing. Drop timeout | ML-018 |
| **L** Climb | Ladder bottom mount, climb, and top exit onto `fh.elevated`. Rope grab from a west-edge jump at tick 10. Jump-off impulse. An exit blocked by a ceiling is refused. A no-climb profile cannot mount | ML-019 |
| **P** Profiles and advanced | Same gap: a short-jump profile fails, a tall one succeeds. A wide collider is blocked by narrow clearance. Air-jump consumption and reset. A dash through a thin wall stops. An enabled grapple without a solver reports `unsupported` and certifies nothing. A temporary modifier changes the effective profile digest | ML-005, 033–039 |
| **S** Surfaces and dynamics | Conveyor displacement. Ice braking (`traction` 32). A hazard material is forbidden for `movement.ground`. Gate enable blocks and disable unblocks. Moving platform carry, push and squish (Celeste semantics, A6) | ML-017, 031, 032 |
| **N** Navigation | Forest routes for `movement.player`, all **verified with full replay**: start → portal (walk, gap jump, slope, boss floor); start → `fh.elevated` via the ladder; start → `fh.upper` via a rope grab; `fh.upper` → `fh.right` by jump. The ground patrol is verified. Ground enemy → `fh.east` is *no route within budget*, with the reason "no jump ability". The flyer stays in its volume. A\* cost equals Dijkstra cost. The portal forces a zero heuristic. A stale job is discarded. Moving `fh.east` rebuilds only nearby edges. **An art-only edit keeps the cache warm** | ML-021–023, 027, 031 |
| **G** Gameplay and camera | Full-rect trigger enter/exit order. Spawning inside a trigger fires at tick 0. `once` holds. The boss trigger enables the encounter and the gate. An injected `core.encounter.cleared` sets the flag, opens the gate and unlocks the portal. Camera: a jump keeps camera y (platform snap); landing higher snaps; a ladder climb follows; the boss zone locks with a 24-tick blend; small bounds letterbox | ML-024–026 |
| **A** Assets and storage | SVG with script, `foreignObject`, external `href`, entities or `url()` is rejected. Oversized raster rejected. Path traversal, alias or symlink rejected. Torn save detected from the project index digest. A stale `baseDigest` conflicts. The placeholder library refuses writes. Wrong Host or Origin is refused. Backups are written before replacement | ML-009, 015 |
| **E** Export and import | Repeated export is byte-identical: the forest example sources give manifest digest `0a39dafd…` (F5). Reordering source arrays gives the same export. A tampered manifest, a missing dependency, an unknown required contract or a dangling portal is rejected. The optional prefab is excluded. A migration golden pair exists once v2 does | ML-007, 016, 043 |

## I3. Test layers

| Layer | Tooling | Scope |
|---|---|---|
| Unit and property | Vitest, plus small in-repo generators (no new dependency without a security review) | Geometry, floorDiv, quantization, commands and inverses, remapping, canonicalization |
| Fixture conformance | Vitest driving the `conformance/` runner | I2 matrix, exact traces |
| Consumer | Separate Node process; imports only `tests/consumer/` and published schemas | Final bytes from `examples/` and editor exports |
| Browser E2E | Real browsers on **WebKit and Chromium** (a Playwright-class runner, added by a reviewed dependency task; browser binaries are installed outside npm lifecycle scripts) | Pointer capture and cancel, keyboard focus, paint transactions, overlay toggles, Save through the plugin, draft recovery |
| Performance | A benchmark page plus a scripted runner on the H7 machine | H7 and E8 targets, p50 and p95 |
| Fuzz (bounded) | Generators in Vitest | Parsers, paths, SVG sanitizer, polygons, archives |

RigLab's lesson applies to the browser layer: static markup tests alone are insufficient, and the
built-in browser pane pauses animation frames when hidden. Use a headless runner for timing-sensitive
checks.

## I4. Engine conformance suite

`conformance/CONFORMANCE.md` defines how an engine reports results:

```json
{"engine": "<name>", "version": "<v>", "claim": "exact | tolerant | rebuild",
 "controller": {"key": "maplab.reference-controller", "version": 1},
 "results": [{"fixture": "J-gap-480", "status": "pass", "maxPositionErrorSu": 0, "maxVelocityErrorSu": 0, "supportIdsExact": true, "eventsExact": true}]}
```

**Proposed tolerant defaults**, to be calibrated in ML-018 and ML-043:

- position ≤ 16 su (1/16 WU) and velocity ≤ 4 su/tick at checkpoints every 15 ticks,
- support IDs, ability counts and event order exact,
- ±1 tick contact timing only where the fixture says so.

Raising a tolerance to hide tunneling or wrong support is forbidden (*adopted §I2*, **Kept**).

## I5. Final acceptance scenario (directive §20)

The milestone is ML-028. Advanced movement acceptance comes later, without any map change.

1. Open the forest from `placeholder-library/`. Toggle Art, Footholds, Collision, Traversal,
   Navigation, Spawns, Triggers and Camera independently. Art can dim without hiding collision.
2. Validation reports zero errors.
3. **Test** with the placeholder actor:
   - walk and run, clear the gap, fall into the pit (hazard event shown as declared),
   - climb the ladder to `fh.elevated`, drop back through it,
   - grab the rope and exit onto `fh.upper`, jump to `fh.right`.

   The HUD shows support ID, mode and velocity throughout.
4. **Navigation**:
   - the player routes in I2-N all verify,
   - the ground enemy's patrol verifies and it cannot leave the west floor,
   - the flyer patrols inside `region.flight` on the free-space planner.
5. **Edits**:
   - recoloring art leaves the cache warm,
   - raising `fh.right` by 80 WU makes `fh.upper → fh.right` *no route within budget*, a rise of
     112 > 94.875, and the badge updates incrementally,
   - undo restores the route.
6. **Export** twice with identical digests. In a **separate process with no MapLab imports**, the
   consumer verifies, loads both maps, builds collision, spawns actors, registers triggers and
   camera zones, injects `core.encounter.cleared`, and traverses the portal to `start.arrival` and
   back to `checkpoint.east`.
7. **Later, no schema or geometry change.** Set `airJumps: 1` on the player profile: the digest
   changes, the cache rebuilds, and `fh.elevated` becomes reachable without the ladder (ML-033).
   Dash and wall abilities follow in ML-034 and ML-035. A RigLab baked presentation replaces the
   placeholder (ML-030) with no trace changes.
