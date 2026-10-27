# ML-037 mode conformance

Owned CC0 numeric fixtures for static swimming, shoreline entry/exit and velocity-state flight.
No external art, physics data or fluid simulation is used. Existing CC0 MapLab document headers
provide format scaffolding; all water, shore and corner geometry is original for this task.

The rectangular body is foot-referenced in integer su at 60 Hz. Normal swimming first adds
`air.gravity - swim.buoyancy` to vertical velocity, clamps to the L1 speed budget, then applies
the same bounded integer propulsion/turn motor as flight. Drift must fit acceleration so that
rest is a supported state. Flight retains both velocity components through turns. Full-body
X/Y sweeps must remain inside world bounds and the matching mode-volume union. Swimming
requires a binding; flight falls back to world bounds. A seam is allowed; a gap is not.

`core.mode.transition@1` has string parameters `fromMode` and `toMode` and cardinal, distinct
authored anchors. Supported links are static, unconditional, zero extra cost and rest-to-rest.
The motor accelerates and brakes along the anchor axis; authored ticks or animation never move
the body. Every sweep must fit the union of participating mode domains. A ground endpoint
contributes only its standing footprint and requires a registered flat full-footprint stance.
Neutral-buoyancy horizontal shore entry/exit and fly takeoff/landing are supported. A vertical
water exit is additionally capped by breachImpulse; vertical water entry is unsupported.
Bidirectional links receive reverse action IDs; collisions with authored IDs are rejected.

Only rectangular fullFootprint swim/fly-only capability profiles are supported. Other enabled
families, non-hover flight, excessive coefficients, dynamic worlds, modifiers, restricted
materials, navigation overrides and unsupported transition intents are qualified unsupported.
These bounds do not claim arbitrary multimodal or continuous reachability.

The search samples cardinal/stop controls, short macro durations and exact goal/anchor deltas.
Its state includes position, velocity and mode. Static shortest paths dominate later visits to
the same physical state. A* uses L1 distance divided by the largest motor speed; Dijkstra uses
zero. Work, expansion, transition and duration budgets never publish partial witnesses.

`turn.fixture.json` contains hand-authored momentum checkpoints. `tests/consumer/modes.mjs`
independently imports final export bytes, binds profiles and controller identities, integrates
reported controls with integer arithmetic, checks rectangle sweeps/union coverage and verifies
every mode action and exact join. CI checks forged traces, controls and rehashed profile bytes.
