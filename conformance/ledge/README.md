# Owned ledge conformance

Original CC0-1.0 numeric worlds, profiles and projected expectations for ML-036.
The runtime uses `core.ledge.climb@1`, independently of presentation and artwork.
The catalog binds the action as typed traversal metadata; it executes no code.

A supported grip names a static vertical collision face, its upper endpoint in
body-local WU, a registered horizontal top and a rectangular foot approach region.
Hold toward the face and Up while adjacent and nonascending. The hand at
`footY - grabHeight` must be within `grabReach` of the grip. One stationary grab
tick precedes `climbTicks - 1` integer vertical lift ticks and one horizontal
transfer tick. Every displacement sweeps the full finite body. The landing
requires full-footprint support. Releasing toward/Up cancels without a refill.

When the profile has a wall stamina pool, each grab/climb tick consumes one;
landing resets it through the underlying adapter. The ledge schema itself has no
stamina coefficient; profiles without a wall pool have no stamina cost. Dash,
additional-jump and cooldown resources retain the underlying adapter semantics.
Unsupported action references, nonvertical/ambiguous grips and unsupported
approach shapes return qualified results. Failed reach and spent resources create
no ledge witness. Search is bounded to declared approach/jump/hold schedules.

CI verifies fixture byte hashes, source identities, exact projected equations,
repeat/resume, resource-compatible full route replay, A*/Dijkstra costs, blocked
roofs, narrow/wide bodies, intent restrictions and atomic budget/cancellation.
A separate exported-bundle reader and numeric consumer use no controller code;
rehashing corrupted expectations or exported profiles does not conceal errors.
