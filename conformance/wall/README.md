# Owned wall conformance (ML-035)

Original CC0-1.0 numeric corridor and roof geometry. Collision masks, enabled bodies and material permissions govern contact; artwork has no physical authority. The selected maplab.reference-wall@1 module is bound to final source hashes.

Qualified vertical blocking faces only. Push into a wall to slide at slideMaxSpeed; add vertical input to climb at climbSpeed. A rising jump edge launches away from the actual contact side with horizontal jumpImpulse magnitude and signed vertical impulse. Every active wall-action tick costs one stamina tick, including launch. Ground alone refills stamina. Switching walls, releasing, and climbing paths do not replenish it. Ladder attachment and active/new dashes take priority. State remains ephemeral and resumable; launched marks the full wall-jump arc for intent restrictions.

The finite-body controller sweeps both axes. Wall slide/climb suppress gravity for their movement tick; a wall jump applies ordinary gravity after its launch displacement. Ceiling contact stops upward motion. No ledge grab, mantle, grapple, swing, sloped-wall or timed moving-wall navigation claim.

The bounded primitive solver samples direction, pulse/coast and vertical controls with exact stamina, velocity, side, jump/dash pools and input edges. Only replayed ground landings publish edges. Whole routes retain state across joins and use h=0. Budget/cancellation discards partial output. No completeness claim. Independent restricted equations verify fixture states and a separately packaged consumer binds the exported profile and geometry; semantic corruption must fail after rehashing.
