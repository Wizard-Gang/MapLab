# Planned physics conformance authority

No controller, collision solver, Test mode or navigation witness exists in ML-001.
The adopted numerical authority is [specification D, E and I](specifications/2026-10-16-maplab.md).
ML-005 documents executable-contract requirements; ML-017 onward implements them.

The proposed `maplab.reference-controller` v1 / `maplab.collision` v1 uses upright
rectangles, fixed 120 Hz ticks, binary64 arithmetic, and end-of-tick state quantum
1/65536 WU and WU/s with half-away-from-zero rounding and normalized negative zero.
Capsules remain explicitly unsupported until a solver and fixtures exist.

Preserve the specified tick order, relative kinematic sweeps, full-body clearance,
bounded contact iterations/recovery, stable ID tie-breaks, slope stance, one-way
crossing and selected-group drop suppression. Exhausted solver budgets fail visibly.
No coyote time, input buffer, automatic step or actor collision is implicit in v1.
Source anchors and resolved profile-specific body poses are distinct.

Test and navigation call the same controller entry point. Edges record launch and
terminal state, inputs, resources, sweep dependencies and collision/controller
identity; entire routes require replay, including alignment and patrol closure.
Finite samples cannot establish universal impossibility. Dynamic rendezvous cannot
be certified by static geometry snapshots. Unsupported abilities must not certify.

Specification I2 defines the contact, jump/drop, climb, ability, dynamic, graph,
invalidation, camera, storage and export fixture matrix. Identical reference inputs
must replay identically. Independent engines report compatibility per profile and
controller, using published checkpoints and tolerances (normally ≤1/256 WU and
≤1/128 WU/s), exact support/resource/event outcomes, and only explicitly allowed
timing tolerances. Matching coefficients alone never establishes solver parity.

All acceptance results remain pending their roadmap task. The forest numerical
world is documentation until schemas and independent fixtures land; it is not
shipping content or a measured game implementation.
