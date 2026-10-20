# Reference contact controller (ML-017)

`createWorld(map, profile)` validates the map geometry and movement profile and
snapshots their source. `step(world, state, {moveX, run})` is the shared pure
contact entry point; `replay(map, profile, initial, runLengthInput, ticks)` runs
it in Node or a browser. There are no editor, storage, rendering or React imports.

This is the contact subset of `maplab.reference-controller` v1 and
`maplab.collision` v1 (adopted D2/D4/I1/I2; R1 RC0–RC5, D2–D4 and I2).
It implements flat acceleration/braking, slope speed ratios, traction/conveyors,
static rect/polygon/segment sweeps, finite rectangular stance, reciprocal welds,
slope catch, snap, ceilings and gravity after movement. Concave shapes use their
original boundary edges directly, preserving source shape/edge identity without
inventing internal decomposition faces. Actor dimensions and map geometry stay
in WU in source; the solver converts them once to integer su.

Full-footprint coverage must come from the same compatible support chain.
Stance chooses its highest footprint point. A solid foothold annotates its body
edge, so that face is resolved once. Unregistered walkable body edges support
physically and report `unregisteredSupport`; they supply no navigation claim.
Symmetric masks and enabled state govern physical participation. One-way faces
never become blocking walls. Normals in traces are exact, unnormalized outward
integer vectors, including the contacted side of a two-sided segment. Points
are floor-quantized physical face witnesses, independent of presentation anchors.
A rational sweep can stop less than 1 su before a face; witness quantization
adds less than 1 su in the interpolated coordinate. This declared reporting
precision never loosens exact replay checkpoints or collision ordering.

X precedes Y. Sweeps use the Minkowski expansion of a source edge by the actor
rect, with exact rational contact ordering before conservative integer rounding.
Equal blocking contacts use body ID, shape ID, then source edge index (code-unit
order); support ties use foothold ID. More than eight simultaneous resolutions
on one axis returns `contactBudget`, retaining the previous state. Initial solid
overlap returns `invalidState`. Unsafe arithmetic returns `unsafeInteger` rather
than rounding a predicate. Stale ground support and malformed schedules reject.
Slope lift checks the upward sweep and final full-body clearance; an obstructed
lift checks relevant blocker X intervals at su resolution and stops at the first obstruction, even with separated ceilings. There is no overlap recovery or auto-step.

Replay traces include every intermediate state/contact, the versioned contracts,
source and canonical movement profile SHA-256, and a digest over the canonical
trace envelope (excluding its own digest). Schedules and documents are snapshotted
before asynchronous hashing. All same-version checkpoints are exact, without
numeric tolerances. `conformance/contact/index.json` pins every owned CC0 fixture.
The tests also calculate run/brake, lift and wall/ceiling numbers independently,
and consume final fixture bytes from an isolated process. Chromium and WebKit
execute this same module and compare exact serialized replay identities.

`scope: "contact"` and `canCertify: false` are explicit. Jump, drop, climbing,
combat, sensors, moving-body resolution, advanced abilities, Test UI and navigation
integration belong to later tasks. Additional input fields report `unsupported`;
configured abilities are not executed. Moving enabled collision bodies, capsules,
center-foot stance and unknown controller contracts reject. This module cannot
certify a navigation edge or assert future-engine parity. The capability registry
remains conservatively unavailable for the complete future runtime. The source
digest identifies the passed map snapshot; it is not a future navigation-cache key.
