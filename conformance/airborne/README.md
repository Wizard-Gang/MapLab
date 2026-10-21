# Owned single-action navigation fixtures (ML-022)

All files are original MapLab CC0-1.0 data derived from the owned jump fixtures.
`index.json` pins every other final file. `cases.json` binds complete maps/profiles
to canonical `.actions.json` outputs; no incoming evidence or earlier fixture is edited.

`maplab.airborne-actions` v1 is a bounded, incomplete set of exact directed actions,
not a route/completeness certificate. Inputs start at absolute tick zero and retain
run-length changes; each accepted action includes every reference-controller frame,
ordered contacts and the exact terminal velocity/resources/drop state. An action's
launch speed is a precondition. No run-up, walk from a prior landing, charge reset,
moving-platform timing, multi-jump or search result is inferred.

Samples use sorted support intervals, world-anchored integer lattice positions,
interval endpoints/midpoints, obstacle/landing critical positions and one bounded
half-spacing refinement around critical positions; rest, signed walk/run and
intermediate speed bins; zero/half/full hold durations; steady/coast air controls.
A conservative horizontal envelope rejects targets outside declared duration/speed
bounds. Full finite-body reference replay alone admits an action. First landing
selects the actual destination; same-support and inaccessible/intervening landings
cannot produce an edge to a farther target. Blocked wall/ceiling arcs are rejected.

Sample, total replay, per-action tick and standing-clearance budgets return `budget`
with no partial graph. Cancellation likewise discards all edges. Exhaustive failure
of the declared finite samples reports only “no route found within declared
search/sampling budget”. Unsupported intent/dynamic bodies/advanced abilities
produce `unsupported`. These offline builds have no publication side effects;
ML-021's revision/cancellation worker remains unchanged.

The cache key binds world geometry/materials/intent/planes, full movement digest,
reference-controller source identity, surface solver and every action setting.
Each edge's hash binds that identity, full input/replay and the swept rect bounds,
including empty space. Any physical insertion/deletion requires a full rebuild;
regional regeneration is deferred to its owning task. Art-only edits keep identity.

Forest is the tiny owned 128-WU gap, with x=480 launch and x=660 landing at tick45;
full integer trajectory equations are checked independently at every tick. The
original source forest's last full-footprint takeoff remains x=468, as pinned by
ML-018; ML-021's rope inputtick12/result tick13 and controller bytes are unchanged.
The x=480 forest arc clears the corner as a point but hits it with the finite body;
that sample is rejected, while later clear launches remain eligible. Ceiling,
16-WU landing, short-jump and no-jump cases produce no witness.
Drop ignores only the selected welded group and lands on the other group 16 WU
below; edge-fall retains explicit horizontal velocity. The isolated standalone
consumer imports no MapLab module, verifies final hashes and numerical contracts,
checks full rect overlap/dependency bounds, and rejects rehashed semantic corruption.
