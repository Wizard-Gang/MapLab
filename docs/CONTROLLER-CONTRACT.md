# Reference controller and collision v1

`maplab.reference-controller` v1 binds `maplab.collision` v1. Adopted
[R1 RC0–RC5](specifications/2026-10-17-maplab-r1/D-reference-controller.md) and
[R1 D1–D4](specifications/2026-10-17-maplab-r1/D-world-physics.md) remain normative.
ML-005 publishes the complete profile schema and
[capability registry](../contracts/maplab.reference-controller.v1.capabilities.json).
It implements no movement/collision/advanced solver. Numerical implementation and
conformance belong to ML-017 onward; matching coefficients never proves parity.

## Units and collision authority

Authored geometry uses X-right/Y-down WU, quantum 1/16 WU within ±131,072 WU.
Runtime position uses integer **su = 1/256 WU**, velocity su/tick, acceleration
su/tick², and durations ticks at **60 Hz**. R1 supersedes the 120 Hz binary64
proposal. Every state and arithmetic intermediate must be a safe integer. Exact
floor division corrects a truncated quotient through exact multiply/compare;
rounded floating division alone is insufficient. No transcendental functions,
`Math.hypot` or floating state between ticks belongs in the reference kernel.
Safe source coefficients do not prove safe products; the future kernel must
refuse unsafe intermediates explicitly.

The upright rect foot reference is bottom-center, with bounds
`[x-w/2,x+w/2] × [y-h,y]`. Full-footprint stance uses the highest support under
the overlapping footprint and connected coverage. Source anchors, resolved finite
body poses and presentation ground-contact offsets remain separate. Capsules and
`centerFoot` are representable, explicitly unsupported by controller v1.

Bodies own solid faces and stable local shape IDs. Rect edges are top/right/
bottom/left; clockwise Y-down polygon edge normals are `(dy,-dx)`; segments are
two-sided barriers. Body translation applies to owned geometry. Artwork, visual
transforms, actor planes and tile trace suggestions have no collision authority.

The registry accepts explicit case-sensitive category/mask keys with symmetric
mask checks. `world` and `actor` are fixture labels, not a reserved whitelist.
A pair participates only when enabled and both masks admit the other category.
Gameplay roles are separate. Controller v1
has no actor-to-actor collision, even if masks would otherwise admit it.

Walkable upward faces support; remaining solid faces and two-sided segments block.
Walkability is `abs(dy)*run <= dx*rise`, without angles. Enabled mask-compatible
one-way footholds support from above, never block sides/upward passage, and are
ignored when too steep for the profile. A solid foothold exactly names its source
edge and agrees with body collision settings. Resolve the face once, with the
foothold material for top support and body material for bulk/side contacts.
Unregistered upward body faces may support but are reported and never become
authored navigation support.

Initial blocking overlap is `invalidState`. Sweep X then Y. Equal contacts use
body ID, shape ID and edge index in code-unit order; foothold ties use foothold ID.
At most eight resolutions per axis per tick; exhaustion is `contactBudget`, never
a silent tunnel. Narrow walls, corners, slopes and seams require finite-body tests.

## Tick order and runtime separation

Follow [RC4](specifications/2026-10-17-maplab-r1/D-reference-controller.md#rc4-normative-tick-order)
for each condition, exact rounding rule and slope-catch bound:

1. Snapshot inputs/state and reject initial blocking overlap.
2. Resolve climb attach, locked-path movement, exits and jump-off.
3. Resolve grounded jump, selected one-way drop and declared airborne jumps.
4. Approach horizontal targets with ground traction/air acceleration and braking;
   apply slope target ratios without overshoot.
5. Sweep X with support conveyor motion. Re-stance across welds, snap within
   `snapDistance`, leave unsupported edges and apply the bounded slope catch.
6. Sweep Y: rising rect tops meet ceilings; non-rising bottoms meet support.
   One-way landing requires the old bottom at or above its footprint height.
   Ground contact resets resources according to ability rules.
7. Add airborne gravity after moving. Apply hold gravity while rising/held inside
   `holdTicks`, release scaling once on the first rising release tick, then clamp
   to `maxFall`.
8. Decrement selected drop-group suppression. Clear when the rect top is below
   the group's span or the timeout expires; other supports remain active.
9. Update actor plane/facing from support/climb rules.
10. Test full-rect sensors, then apply the authored end-of-tick action queue through
    runtime overlays. Source JSON never changes.

No coyote time, input buffer or automatic step is implicit. Test and navigation
must share one future pure controller entry point. State includes integer pose,
velocity, mode, support/traversal/plane IDs, facing, previous jump state, tick,
drop suppression, airborne jumps, dash charges and cooldowns. Solver-specific
resources must appear in future replay state, never source profiles.

## Complete profile and resource rules

The [movement schema](../schemas/maplab.movement.v1.schema.json) mirrors R1 F:
controller/units, collider/support/grab geometry, category/mask, ground/air/drop
coefficients, abilities and tag sets. Presence enables an ability; omit it to
disable it. The closed R1 union has no `enabled` member. `jump.airJumps: 0` disables
extra airborne jumps while retaining a ground jump. Unknown members and runtime
state reject. Dash ground/air entries may coexist; other kinds occur once.

Kinematics/counts/ticks are safe integers with field-specific signs; WU values use
the geometry quantum. Ratio numerators are 0–65535, denominators 1–65535; slope
rise allows zero, run is positive. Zero ratios suppress gravity/control. Release
cannot amplify ascent. Dimensions are positive, capsule height includes both end
caps, rope length bounds are ordered within reach, and drops need positive timeout.

| Family | Coefficients, permissions and resources |
|---|---|
| `jump` | Positive ground/airborne impulses, hold ticks/gravity, release ratio and additional-jump count. Initial airborne charges equal `airJumps`; consume one per airborne jump and refill on ground contact. Ground jump is separate. Extra jumps require ML-033. |
| `climb` | Positive speed, ladder/rope permission and signed jump-off vector. At least one permission is required. Attach, exits and gravity follow RC4. Climbing does not implicitly refill other abilities. |
| `dash` | Mode, positive speed/duration/charges, cooldown ticks, ground/timer reset, gravity ratio and `collision: stop`. Consume one charge at activation. Ground-reset refills on ground contact; timer reset recovers one per completed positive cooldown interval. No sweep bypass. |
| `wall` | Slide/jump/climb set, slide cap, signed jump impulse, climb speed and stamina ticks. Climbing consumes stamina ticks; ground contact refills. Wall attachment does not refill other resources. |
| `ledge` | Grab reach, climb ticks and versioned action. Action/catalog binding is deferred; no embedded executable code. |
| `swim` | Speed/acceleration, signed buoyancy and breach impulse. Fluid membership/state is solver-owned. |
| `fly` | Speed/acceleration/turn acceleration and hover permission. Solver/volume/replay support is ML-027. |
| `grapple` | Reach, reel speed, positive ordered rope lengths, gravity ratio and solver identity. The solver must declare its rope state/resources; an unknown solver remains unsupported. |
| `teleport` | Reach, cooldown ticks, anchor/line-of-sight target and full-body clearance. Point-only clearance rejects. |
| `launch` | Maximum impulse, air-control ratio and recovery permission. Launch sources and live velocity are separate data. |
| `modifier` | Allowed versioned definitions and replace/multiply-then-clamp policy. Definition binding/effective-coefficient calculation is deferred. Hash the resulting effective profile. |
| `registered` | Versioned call and solver, bounded scalar/typed-reference parameter envelope. No executable scripts/expressions, arbitrary nested payloads or external solver loading. Catalog field closure/reference existence remains ML-006. |

## Capability and digest results

`loadMovement`/`validateMovement` return diagnostics or a detached frozen profile,
explicit `compatibility` and any catalog deferrals. Unsupported diagnostics name
controller/version, collider, stance, extra jumps and advanced
families. `contractSupported` describes the base contract; it is distinct from
`runtimeImplemented` and `canCertify`, which remain **false for every profile**.
Authoring fixtures cannot certify a simulation or navigation edge.

`movementProfileJcs` validates then normalizes masks/tags, wall permissions,
allowed modifier references and ability order (dash ties by mode). Impulse vectors
stay ordered. Object keys sort by UTF-16 code units. ECMAScript JSON number/string
serialization preserves Unicode and normalizes negative zero; non-finite values
and lone surrogates refuse hashing. `movementProfileDigest` uses Web Crypto
SHA-256 over the complete canonical UTF-8 bytes without a trailing newline.
Every field participates, including ID/name/controller, coefficients, tags and
extension references. Same-version edits invalidate caches; property/set reorder
does not. Hashing an effective profile does not implement modifiers.

Navigation identity additionally pins source/settings/controller/collision/solvers.
Independent engines earn exact parity or fixture-specific tolerant compatibility,
or rebuild under their own solver. R1's proposed tolerant defaults are position
≤16 su and velocity ≤4 su/tick, exact support/resources/events and only explicitly
permitted ±1-tick timing. Numerical proofs remain ML-017 onward and ML-043.
