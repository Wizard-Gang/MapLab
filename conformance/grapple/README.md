# Owned grapple reference corpus

All geometry, profiles, inputs and checkpoints are original MapLab numeric work,
dedicated to CC0-1.0. No external artwork or rope implementation is included.
`index.json` pins final bytes, including the separate motor/geometry/planner
identities in `contracts.json`. Export tests include every fixture map and profile.

`maplab.reference-grapple@1` is a dedicated, fixed 60 Hz, safe-integer solver.
Positions and rope length use su (256/WU). The harness is the actor's bottom
center minus `grabHeight`; it must lie within the upright rectangular body.
Only static rectangle solids, reciprocal masks and grapple-only profiles are
supported. Anchor points are body-local points on their named physical face;
the actor's bottom center must be in the authored rectangular approach region
to attach. Permission tags, Euclidean reach, rope limits and line visibility
are all checked. An unsupported solver produces no route witness.

Attach and release each consume one stationary tick and preserve velocity.
Attachment length is the ceiling integer square root of squared harness distance.
Coast first applies the selected horizontal air control and scaled gravity,
then clamps the requested reel length. A proposed harness outside the rope
circle projects toward its pivot with integer truncation using the ceiling
square root. Outward radial velocity is removed by integer truncation of
`dot(v,r)*r/dot(r,r)`. No floating point square root or angle enters state.
Projection may leave under two su of slack; stored length remains exact.

The actor takes the inner axis corner: prefer X then Y when that corner is
inside the larger old/new rope circle, otherwise Y then X. Both segments sweep
the entire rectangular body, stay in world bounds and check the triangle swept by the straight
rope. Only a single contact at the pivot is exempt from rope occlusion. Each
axis corner must fit within the larger old/new length during a reel tick.
Blocked actions preserve the old state and report their collision outcome;
they never tunnel or become successful navigation edges. Contact at the exact
end of a body sweep is allowed. Release removes the rope; subsequent free
ticks still sweep the body. This separate solver uses gravity before movement.

The planner uses uniform-cost search over exact pose, velocity, anchor point
and rope length. Expansion, control-sample, replay-work and duration limits
are explicit. Every reported route is replayed again through the same motor
used by Test. Worker publication binds world, profile, query and revision.
No wrapping, elasticity, dynamic bodies, fluid, runtime conditions or arbitrary
rope completeness is claimed. Search exhaustion is qualified, never universal
unreachability. `canCertify` and `complete` remain false.

`traces.json` pins attachment/reel/release, swing and extension checkpoints.
`steps.json` covers reach, rope length, occlusion, a thin wall during release,
pendulum collision and wide/narrow bodies. `cases.json` pins route queries;
negative queries explicitly allow exhaustion of their small search budget.
The separate-process consumer uses slab clipping and rectangle overlap from
exported bytes, with no imports of the application, its solver or its planner.
