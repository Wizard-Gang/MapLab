# D (part 2). Reference controller and movement profiles

## RC0. Identity and purpose

`maplab.reference-controller` v1, with collision semantics `maplab.collision` v1, is a **pure
TypeScript module** (`src/physics-reference/`) with no React, editor or storage imports. **Test
mode and navigation call the same entry point.**

It exists to make previews and navigation witnesses reproducible. It is **not** game authority.
An engine may do one of three things:

1. Port it exactly and earn *exact parity* through fixtures.
2. Use its own physics and report *tolerant compatibility* per fixture.
3. Rebuild navigation under its own controller.

Matching coefficients alone never proves parity (*adopted §I1*).

**R1 changes vs adopted §I1**:

- **60 Hz** instead of 120.
- **Integer sub-units** instead of binary64 plus end-of-tick quantization.
- **Rational slope limits** instead of degrees.
- **Horizontal ground speed** instead of arc length.
- **Hexframe's integration order.**

**Kept**:

- Upright rect only. Capsules are declared but unsupported.
- `fullFootprint` stance.
- No coyote time, input buffer, auto-step or actor-to-actor collision.
- Stable-ID tie-breaks.
- An exhausted contact budget is a reported failure, never a silent tunnel.

Evidence for each change is in A6 and K1.

## RC1. Units and arithmetic

| Quantity | Unit | Display conversion |
|---|---|---|
| Position | **su** = 1/256 WU (integer) | WU = su/256 |
| Velocity | su/tick at 60 Hz | WU/s = su/tick × 60/256 (1024 su/tick = 240 WU/s) |
| Acceleration | su/tick² | WU/s² = su/tick² × 3600/256 |
| Ratios | `{num, den}` small positive integers, or fixed 1/256 (`traction`, 256 = 1.0) | — |
| Durations | ticks | s = ticks/60 |

**Arithmetic rules**:

- Every state value and intermediate is a safe integer.
- Products of coordinate differences are at most 2⁵² by the D1 range.
- **Division is exact floor division**: estimate with `Math.trunc(a/b)`, then correct with one
  exact multiply-compare. `Math.floor(a/b)` alone is not allowed, because the double quotient can
  round across an integer.
- No transcendental `Math` functions, no `Math.hypot` and no float state kept between ticks.

The result is that identical inputs give identical traces in V8, JavaScriptCore and SpiderMonkey,
and in any exact integer port.

## RC2. State, input and stance

**State**:

- `x, y` (foot reference, su) and `vx, vy` (su/tick)
- `mode`: `ground | air | climb`. `wall | ledge | swim | fly | grapple | dash` are reserved
- `supportId`, `traversalId`, `planeId`
- `facing`: ±1
- `jumpHeldPrev`, `ticksSinceJump`
- `dropSuppression {group, ticksLeft} | null`
- `resources {airJumps, dashCharges, cooldowns{}}`
- `tick`

**Input per tick**: `{moveX, moveY ∈ {−1,0,1}, run, jump (held), drop, dash, action|null}`.
`jumpPressed = jump && !jumpHeldPrev`.

**Body** = `[x − w/2, x + w/2] × [y − h, y]`.

**Stance (`fullFootprint`)**:

- *Support under the footprint* = every support face whose x-span overlaps `(x − w/2, x + w/2)`
  with positive length.
- Each face contributes its highest (minimum y) point inside the overlap:
  `groundY(s, x) = a.y + floorDiv((x − a.x)·(b.y − a.y), b.x − a.x)`, evaluated at both clamped
  ends.
- Grounded `y` = the minimum of those values. No support under the footprint means the actor is
  unsupported.

## RC3. Face classes for a profile

- **Support faces**: enabled, mask-compatible, walkable (D3) footholds, one-way or solid, that are
  not in a suppressed drop group.
  - Upward-facing walkable *body* faces without a foothold also support. They are reported as
    `unregisteredSupport {bodyId, shapeId, edgeIndex}`, validation warns, and navigation ignores
    them.
- **Blocking faces**:
  - every other enabled solid-body edge, one-sided, blocking motion against its outward normal
    `(dy, −dx)`,
  - two-sided segment bodies, blocking both ways,
  - steep solid faces.
- **Ignored**: one-way footholds never block anything. A one-way foothold too steep for this
  profile is ignored by it.

## RC4. Normative tick order

1. **Snapshot** input and conditions. Validate the old state: initial overlap of a blocking face is
   `invalidState`.
2. **Climb transitions** (if the profile has `climb`):
   - **Attach** when `moveY ≠ 0` and the grab point (`x`, `y − grabHeight`) is within the path's
     `grabRadius` and span.
   - **Climbing**: `x` locks to the path, `vy = moveY·climb.speed`, and gravity is off.
   - **Exits**: an access point whose exit is allowed hands off to its anchor with stance
     resolution. A jump detaches with `climb.jumpOff` (an impulse vector). The path ends stop motion
     unless an exit applies.
3. **Ground transitions**:
   - `jumpPressed` while grounded sets `vy = −jump.impulse`, `mode = air`, `ticksSinceJump = 0`.
   - `drop` on a one-way support with `dropAllowed` and `canDrop` sets `dropSuppression {group,
     ticksLeft = dropTimeoutTicks}`, `mode = air`, `vy = 0`.
   - `jumpPressed` while airborne with `airJumps > 0` sets `vy = −jump.airborneImpulse` and
     decrements `airJumps`. This is in the schema now, and its solver is ML-033.
4. **Horizontal velocity**:
   - Ground target is `moveX · (run ? runSpeed : walkSpeed)`. Air target is `moveX · air.maxSpeed`.
   - Approach the target by `floorDiv(accel·traction, 256)` on the ground (`air.acceleration`
     airborne). Brake toward 0 by `floorDiv(braking·traction, 256)`. Never overshoot the target or
     zero.
   - Slope multipliers (`uphill`, `downhill`) scale the ground target, rounded toward zero.
5. **Move X** (`dx = vx`, plus the support material's conveyor su/tick along a→b when grounded):
   - The rect sweeps along X against blocking faces. It stops at the earliest contact and sets
     `vx = 0`.
   - **Grounded**: re-stance at the new x, following welds. If the new stance is lower by at most
     `snapDistance`, stay grounded. If lower by more, or there is no support under the footprint,
     set `mode = air`, `vy = 0`. If a face rises more than the walkable slope allows, it is a
     blocking face (already handled).
   - **Airborne**: a walkable support face met by the rect's leading bottom corner lifts the rect
     onto it if the lift is at most `w/2 · rise/run + 1` su (a slope catch). Otherwise it blocks.
6. **Move Y** (`dy = vy`):
   - **Rising** (`vy < 0`): the rect top sweeps against blocking faces facing down and two-sided
     segments. It stops at contact with `vy = 0` (a ceiling).
   - **Not rising**: the rect bottom sweeps against support faces under the footprint. The
     **one-way crossing rule**: a face lands the body only if the body's bottom was at or above
     that face's footprint height at the start of the tick.
   - The first contact sets `y`, `mode = ground`, `supportId`, `vy = 0`, and resets `airJumps` and
     dash charges per their ability rules.
7. **Gravity** (Hexframe order: after moving), airborne only:
   - Rising, holding jump and `ticksSinceJump < jump.holdTicks`: add `jump.holdGravity`.
   - Otherwise add `air.gravity`.
   - On the first rising tick after jump is released: `vy = trunc(vy·release.num/release.den)`,
     once.
   - Clamp to `air.maxFall`.
8. **Drop suppression**: decrement. Clear when the rect top is below the suppressed group at the
   body's x-span, or when `ticksLeft = 0`.
9. **Plane and facing**:
   - Grounded: `planeId = support.planeId ?? defaultPlane`.
   - `moveX ≠ 0` sets `facing` (not while climbing).
10. **Sensors**: trigger and volume regions test the full rect, then the end-of-tick action queue
    runs (*adopted §F2 trigger timing*, **Kept**).

**Budget and ties**:

- At most 8 contact resolutions per axis per tick. Exceeding that is `contactBudget`.
- Equal contact positions resolve by body ID, then shape ID, then edge index (code-unit order).
- Foothold ties resolve by ID.

Axis-separated motion (X, then Y) is a declared semantic, as in Celeste (A6), not an approximation
of a continuous sweep. Fixtures pin its corner behavior.

## RC5. Movement profile (`maplab.movement` v1, Changed)

All kinematic values are integers in the units of RC1. Geometry (collider) is in WU on the D1
quantum.

| Group | Fields |
|---|---|
| Identity | `id`, `name`, `controller {key:"maplab.reference-controller", version:1}`, `units {subunitsPerWU:256, ticksPerSecond:60}` |
| Body | `collider: {kind:"rect", width, height} \| {kind:"capsule", radius, height}` (capsule unsupported in v1). `support: "fullFootprint" \| "centerFoot"` (only `fullFootprint` supported in v1). `category`, `mask`, `grabHeight` |
| Ground | `walkSpeed`, `runSpeed`, `acceleration`, `braking`, `maxSlope {rise, run}`, `uphill {num, den}`, `downhill {num, den}`, `snapDistance` |
| Air | `gravity`, `maxFall`, `acceleration`, `maxSpeed` |
| Drop | `canDrop`, `dropTimeoutTicks` |
| Abilities | Discriminated entries, unique per `(kind, mode)`: `jump`, `climb`, `dash`, `wall`, `ledge`, `swim`, `fly`, `grapple`, `teleport`, `launch`, `modifier`, `registered`. Fields as in *adopted §F2*, converted to integer ticks and su |
| Gates | `abilityTags`, `forbiddenMaterialTags` |

- Absent or disabled abilities are unavailable.
- An enabled ability the controller does not support is reported **unsupported** and can never
  certify a navigation edge.
- The profile digest is SHA-256 over its JCS bytes. Any coefficient change changes the digest and
  invalidates its navigation caches, even under the same name (*adopted §E4*, **Kept**).
- Live state (RC2) is never stored in a profile.

**Editor aid**: "derive from feel". Under the RC4 order the rise after *n* airborne ticks is
`n·v₀ − g·n(n−1)/2`, peaking at `n = ⌊v₀/g + ½⌋`. The editor solves for integer `v₀` from a desired
apex height and shows airtime and run distance, all exact. RigLab animation lengths (60, 48, 36
and 24 ticks) are on the same clock, so a jump animation and a jump arc can be tuned together.

## RC6. Reference profiles for the forest fixture

| Profile | Collider (WU) | Ground (su/tick) | Air | Abilities |
|---|---|---|---|---|
| `movement.player` | rect 24×48 | walk 512 (120 WU/s), run 1024 (240 WU/s), accel 64, brake 96, maxSlope {1,1}, snap 1024 | gravity 96 (1350 WU/s²), maxFall 3072 (720 WU/s), accel 48, maxSpeed 1024 | `jump` impulse 2112 (495 WU/s, apex **94.875 WU** at tick 22, airtime 45 ticks), hold 0. `climb` speed 512 (ladder and rope), `grabHeight` 40 WU. Drop on. The map's climb paths use `grabRadius` 12 WU |
| `movement.ground` | rect 24×40 | walk = run 256 (60 WU/s), accel 64, brake 64, maxSlope {7,10} (~35°) | gravity 96, maxFall 3072, accel 0, maxSpeed 0 | none. No drop, no climb, forbids `hazard` materials |
| `movement.flyer` | rect 24×24 | — | gravity 0 | `fly` speed 512, accel 32, hover. Flight volumes from `navigation.modeVolumes` |

**QA sketch**, a throwaway integer simulation of RC4 for the flat cases. It is not a fixture, and
the exact windows are ML-018 fixture outputs:

- From foot x = 480 at run speed, the player clears the 128 WU gap and lands on `fh.east` at
  tick 45 (foot x 660).
- Taking off before x ≈ 413 falls into the pit.
- `fh.upper` to `fh.right` lands at tick 41 from x = 600.
- A jump from the west edge reaches the rope's grab region at tick 10.
- The 144 WU rise to `fh.elevated` is unreachable without the ladder (apex 94.875 WU).
