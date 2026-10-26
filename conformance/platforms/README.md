# Owned rigid translating platform conformance (ML-032)

Original MapLab numeric geometry and schedules, dedicated CC0-1.0. The tiny maps derive from
our owned flat contact document. No external artwork, engine code or data is incorporated.
`index.json` binds every final source/profile/fixture byte with SHA-256. The expectation
arrays publish every integer state, support/resource identity, adapter outcome and ordered
event at every tick; there is no tolerance. Expectations were authored using rectangle
bounds and integer recurrences, without running the implementation to generate them.

The adapter uses absolute ticks plus initial phase. Points are body-origin translation
offsets in WU, quantized once to su (256/WU); each leg floors its rational interpolation,
including negative displacement. Once clamps, a loop repeats its first point, and ping-pong
reverses at endpoints. Disabled schedules keep absolute time; re-enabling never restarts phase.
Bodies resolve by stable ID, X before Y, before the ordinary actor tick. A rider receives
delta once; swept pushes take priority. Clipped horizontal/downward carry can lose the rider.
An obstructed push or upward pinch stops atomically, reports `crushed` and the authored action;
Test reports that action without executing an engine handler. Departure adds the old support's
last tick displacement to terminal velocity once, after actor movement and gravity.

One-way pushes require outward-side separation and relative approach (including horizontal
slope approach); below-side, flat lateral and suppressed contacts pass. Solid masks follow
the body; owned one-way masks remain independent. Solid enablement mirrors its owner in
both authored transactions and ephemeral gameplay overlays. Runtime never rewrites source.
The adapter bounds worlds to 16 kinematic bodies, 4096 faces and eight equal contact resolutions;
invalid states, unsafe integers and exhausted budgets refuse without partial actor advancement.

The cases cover elevator carry, diagonal initial-phase reversal, unregistered riders,
jump-off with/without inherited velocity, edge departure after clipped carry, disabled support, fast full-path push, upward push,
side/ceiling crush, clipped carry, one-way below/suppression/lower landing, masked owners and
horizontal sloped one-way push and partial-footprint endpoint refusal. Unit cases cover negative interpolation, once/loop boundaries,
resume/repeat/order invariance, malformed schedules, finite overlap, contact/body/face budgets,
static parity, real tick-zero gameplay disable and unsupported static navigation.

`tests/consumer/platforms.mjs` runs in an isolated directory with Node built-ins, the separate
final-byte importer and this fixture package. It independently derives this bounded corpus
from shape edges/linear equations and jump/gravity recurrences, compares all checkpoints to
actual adapter reports, loads the actual deterministic exported map/profile and repeats the
elevator proof. Coherently rehashed forged trace/source bytes must fail. This is a compatibility
proof for this corpus, with no general engine-parity, timed boarding, swing or navigation claim.
CI browser cases author motion, undo/redo, disable/re-enable, save/reopen, replay, inspect changing
collision geometry, reset and verify unsupported timed links without authoring live Test state.
