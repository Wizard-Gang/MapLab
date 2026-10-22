# Owned reference route proofs — ML-023

All fixture data is original MapLab CC0-1.0 material. The tiny flat Forest gap,
integer profiles and core data-only catalog derive from owned R1/ML-018/ML-022
fixtures. Earlier packages are unchanged. No external art or engine code is used.
index.json pins every other final file. cases.json binds the seven query/proof pairs.

This is a bounded static reference-controller proof, not engine AI or a complete
navigation solution. Search state retains exact support/mode/velocity, facing,
input-edge flags, resources, drop state and action depth. Only absolute tick is
omitted from dominance keys, because dynamic bodies, runtime conditions and
time-dependent abilities are unsupported. Chained execution retains absolute ticks.

Surface/climb and airborne templates propose schedules. Ground alignment is itself
reference replay inside a full-footprint accessible interval. A launch may refine
its lattice point by at most one launch-velocity tick (capped at 8192su); the actual
new launch and complete motion are replayed, never assumed equivalent to a cached
witness. First landing determines the actual destination. Every accepted route is
then replayed from its original state with no velocity/resource/input-state reset.
All frames, ordered contacts, exact terminal states and run-length inputs are kept.

A* uses a horizontal displacement/tick lower bound only for the bounded supported
controller subset without climb. Its bound includes initial speed, walk/run slope
ratios, air speed and conveyor run-out. Climb forces h=0 because grab alignment can
move horizontally without that bound. Dijkstra always uses h=0. Costs are duration
plus a nonnegative per-transition penalty; resources/action depth are in the key.
cost-cases.json also supplies abstract directed weighted graphs and a zero-cost
portal shortcut, which forces h=0. Those graph candidates are never physical edges.

The player starts at rest on the west floor and reaches a grounded zero-velocity
east goal. The no-jump enemy has its own profile/digest and finds no gap route
within the declared samples. That failure is not called physically unreachable.
The impossible-stance case has no legal full-footprint center in its declared
support/window; exhaustive integer goal-window geometry checks provide that
narrowly stated proof. An absent accessible interval alone is not that proof:
opposing direction restrictions may leave a perfectly valid standing geometry.

Rect/circle/polygon region queries inspect a bounded set of supported interval
centers and choose a named grounded sample. Actual terminal foot membership is
checked with integer-su shape predicates. A failed sample is never promoted to
region-wide unreachable or globally optimal region arrival. Source/profile,
controller, prerequisite solver identities and target region are hash-bound.

Enemy patrol checks its own movement reference, required tags and empty/static
conditions. Every waypoint leg and wait is replayed, including the loop/ping-pong
return. A second closed cycle must reproduce the first boundary's complete state
except static time. A failed wait, unknown condition, missing capability or
incompatible boundary cannot publish "patrol verified". Runtime behavior remains
engine-owned; a reference proof does not promise an arbitrary AI will follow it.

Standing preparation uses the inherited 2M sample/3600 tick surface limits and
the explicit airborne settings. Search additionally bounds expanded/discovered
states, replay work, ground permission scans, action/route duration, depth and
nearest launch schedules. Generated motion actions obey maxActionTicks, including
alignment; authored waits are separately bounded to 3600 ticks and the total
route duration. maxDepth bounds generated motion transitions. Budget/cancel return no partial proof. Search-limit
variants reuse physical preparation but get distinct complete cache identities.
Same-world physical edits, including new empty-space blockers, invalidate through
the whole-world digest; route/waypoint/source actor edits also invalidate. Artwork
keeps physical identity. Revision/query guards discard stale worker replies.

The isolated Node consumer imports no MapLab implementation. It checks every
accepted tick against independent flat-body integer movement/jump equations,
full-rect clearance, first landing, complete input/frame joins, terminal/resources,
every ordered patrol wait/return, costs and dependency bounds/hashes. Bellman-Ford
independently confirms all abstract graph costs. A rehashed input mutation fails.
This oracle is explicitly limited to these owned flat fixed-impulse fixtures.
