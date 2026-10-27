# Owned stateful action corpus (CC0-1.0)

Original ML-039 numeric geometry, controls and ballistic checkpoints, authored for
this repository. No assets or outside engine traces are used. `index.json` binds
every final file; `contracts.json` pins the motor, modifier policy and planner.

`maplab.reference-actions@1` composes teleport, launch/knockback and temporary
kinematic modifiers with the 60 Hz integer reference contact controller. It handles
bounded static rectangles and rectangular actors. Other ability combinations,
moving bodies, one-way surfaces, authored launch/modifier zones and navigation
overrides/links are explicitly unsupported. These are sampled runtime controls,
not automatic gameplay events or combat damage resolution.

Each action costs one tick. A teleport checks Euclidean range and the complete
destination body, clears velocity, and starts its cooldown. Anchor targeting binds
an exact authored world waypoint and may cross obstacles. Line-of-sight targeting
requires a clear straight torso-center segment and no anchor ID. Cooldown 1 still
blocks the current tick; normal aging makes it available on the following tick.

A launch sets or adds an L1-bounded integer impulse before X-then-Y swept contact
motion. Gravity applies after displacement. The rising airborne contact subset
prevents snapping back onto the departure floor. While launched, `canRecover`
scales air acceleration by the profile ratio, truncating toward zero; false locks
air control until grounded. `launch-and-land` derives its nine checkpoints from
`x=2048+256*t`, `y=10240-512*t+128*t*(t-1)/2`, with exact floor landing at tick 9.
The continuation planner must also brake to a grounded stop.

The sole built-in modifier is `maplab.modifier.kinematic@1`. Its catalog declares
closed `field,num,den,durationTicks` parameters. It can scale the listed ground/air
coefficients, never collider size or permissions. Runtime IDs are unique, at most
eight entries, with factors 0..16 / 1..16 and durations 1..600 ticks. Application
holds pose/velocity for one tick, ages previous entries, and inserts the new entry
for the next tick. Replacement removes all earlier modifiers on the same field;
multiplication uses exact rational products, truncates once, then clamps to
0..8192 su. Duration 1 affects the next motion tick and then expires.

The whole clock, cooldown, velocity, support, recovery flag and active modifier
records form the augmented search state. Effective profile hashes include the
profile and sorted active records, including expiry. Initial-state cache identity
also binds the complete state. Every successful frame carries a recomputed
effective-profile hash; changed coefficients or timers invalidate the identity.
A* and Dijkstra both use h=0, including the one-tick cross-wall shortcut.

Planner limits are explicit: at most 24 supplied actions, 20,000 expansions,
200,000 samples, 1,000,000 replay ticks and 600 route ticks. Cancellation and stale
worker results cannot publish a witness. Success requires complete chained replay;
failure makes no global reachability claim. `canCertify` and `complete` stay false.

CI executes unit and Chromium/WebKit worker/UI cases. The independent consumer
reads final exported maps, profiles and catalog through the format reader and
recomputes rectangle motion, visibility, modifier rationals, semantic contacts,
cache identities and goal checks without importing MapLab runtime code. Forged
controls, contact IDs, expiry, effective hashes and rehashed profile bytes fail.
