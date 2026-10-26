# Owned airborne-jump conformance corpus

Original MapLab numeric geometry, profiles, inputs and expected checkpoints are dedicated to CC0-1.0. No borrowed artwork or executable source is embedded in the exported maps.

Coordinates are authored WU at 1/16 quantum. Runtime states are integer su (256/WU), su/tick and 60 Hz ticks. Every fixture publishes every resulting state, support ID, remaining charge and semantic consumption/reset event. The integer equation authoring uses a 2×4 WU rectangle, 512 su impulses, 64 su/tick² gravity, 256 su/tick horizontal speed, zero hold duration and a unit release ratio.

The cases cover ground departure without spending the additional charge, rising-edge airborne consumption, held/exhausted input, ground reset while jump remains held, an already-airborne source, walking off a full-footprint edge and two additional charges. Tests also cover malformed original fields/resources, climb attach/jump-off priority, a requested jump away from a forbidden falling landing, moving-platform/Test recording integration, low-ceiling selected-group drops and authored forbid regions.

The three-floor route requires an additional airborne jump at each 20 WU gap. Each intermediate grounded landing actually refills the charge before the next chained full-body witness. The same world with the ground-jump-only profile cannot borrow those transitions. An airborne source with a spent charge cannot reuse the unspent source's query or cache entry.

The selected adapter is `maplab.reference-air-jumps@1` over the unchanged base reference controller. `contracts.json` binds final source bytes; tests independently recompute both adapter and primitive-search hashes. The authored map and movement schemas are unchanged. The published base capability registry still describes the frozen base subset; selected-adapter proof is qualified by its own content identity.

Primitive search samples one-tick jump pulses and bounded coast segments. Default limits are 20,000 generated/expanded states, at most three additional-jump actions per primitive path, eight coast ticks per expansion and the existing action/replay/clearance budgets. Profiles support up to sixteen additional charges; a declared search depth may sample fewer. Exact-state dominance includes velocity, support/mode, input-edge flags and remaining resources. This is an incomplete bounded search, with explicit empty budget/cancelled outcomes; it makes no radius, timed-platform or universal conformance claim.

`tests/consumer/air-jumps.mjs` runs in a separate process with only Node and the independent bundle reader. It imports final exported bytes, checks inventory hashes and source/profile/controller binding, recomputes all owned controller and entire-route integer states without MapLab solver imports, checks full-body clearance, action joins and resource events, and rejects coherently rehashed semantic mutations.

All executable tests run in CI only. `index.json` lists every corpus file's final SHA-256, excluding itself.
