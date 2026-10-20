# Owned CC0 climb conformance — ML-019

All final source, fixture and trace files are SHA-256 pinned by `index.json`.
`cases.json` lists exact run-length schedules and every intermediate integer
state/contact. No tolerance is used. These are kinematic ladder/rope reference
fixtures, never navigation certificates, a swing simulation or engine authority.

The shared `step`/`replay` API adds `ClimbState`: complete ML-018 locomotion state,
`traversalId: string|null`, `climbReady: boolean`, and mode `ground|air|climb`.
Inputs add `moveY: -1|0|1`. `scope:"climb"`, controller/collision versions,
source/profile digests and `canCertify:false` identify these traces. The previous
contact and jump state/input subsets retain every published byte unchanged.

At attach, horizontal distance is within the inclusive grab radius and the grab
point (`feetY-grabHeight`) is within the vertical path span. A grounded endpoint
access also admits the feet at its anchor (including a top mount whose hands
are above the path). Grounded entries need the old named physical support and
clearance. An airborne/either access grants airborne grabbing along the path's
grab region, including an intentionally unsupported rope bottom. Ability tags,
kind permissions and data-only ability conditions must pass. Flag/entity-state
conditions report unsupported; no gameplay state or code is inferred.

The actor's feet lock to path X and move at `moveY*climb.speed`, clamped to the
path endpoints. Gravity and horizontal control are off. Climb plane comes from
the path or the default actor plane; facing stays fixed. Explicit crossed access
points resolve in motion order then ID order. Grounded exits re-stance on their
named foothold (or resolve a world/body/entity anchor to real support). They must
match the surface line under the path; full-footprint stance can lift the feet
on slopes. Either exits prefer valid ground, then airborne. None creates no exit.
Access-point conditions apply to both entry and exit. Missing/blocked grounded
exits leave the actor attached; motion stops at a blocking face. All attachment,
climb and exit motion checks X then Y body sweeps and final overlap, including
thin obstacles between otherwise clear endpoints. Debug traces report traversal
identity while attached and exact support/contact identity after grounded exits.

A fresh jump detaches with `jumpOff.x*facing, jumpOff.y`; normal RC4 air control,
axis sweeps and gravity run that tick. Dismount/jump-off sets `climbReady:false`
until a neutral vertical input rearms attachment, so a held direction cannot
immediately remount an airborne rope end. No extra jumps, charges, swing, grapple,
physics extensions or gameplay solver are implied. Unsupported enabled abilities
still fail closed. Source geometry/profile documents never receive live state.

Numerical assertions independent of trace generation pin 2 WU/tick climbs:
300→156 WU in 72 ticks; inverse descent onto `fh.floor`; explicit midpoint
exit at 228 WU in 36 ticks; blocked headroom stops feet at 120+48=168 WU.
Rope radius 12 WU admits x110 and refuses x113 for a path at x100.
Jump-off [1024,-1536] gets air braking 48 and gravity 96 in its detach tick.
The tiny west jump activates grab input at tick10; the next state is attached.

The unchanged forest source also mounts/climbs to `fh.elevated`. Its finite-body
west takeoff is x468 (24-WU body), consistent with ML-018; x480 is unsupported.
With speed 4 WU/tick, the rope at x528 enters its 12-WU grab radius at the
start of tick12 (x516), so this source case attaches at tick12, not the R1
provisional edge-centered tick10 sketch. The tiny west-jump case separately
pins the tick10 transition. No geometry or stance rule is weakened to force it.

Negative probes cover radius/span misses, missing permissions/tags, direction,
unknown conditions/abilities, blocked exit, malformed/stale state, through-wall
attachment, absent endpoint exit, and rejected atomic authoring. A separate
process consumes final fixture files with no editor/storage/server imports;
Chromium and WebKit replay the same module and compare every final trace hash.
