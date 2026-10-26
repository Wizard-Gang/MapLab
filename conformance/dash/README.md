# Owned dash conformance (ML-034)

Original CC0-1.0 numeric flat-floor, two-gap and 1/16 WU thin-wall geometry. No borrowed assets.

The selected `maplab.reference-dash@1` module extends the frozen contact/jump controller and is bound by final source SHA-256. It supports horizontal ground/air dash starts (moveX, otherwise facing), exact swept movement for durationTicks, collision stop, per-mode cooldown and charge pools. `resources.dashCharges` is the checked sum of both mode pools. No authored map or movement schema changes.

Cooldown decrements before actions; a new start sets cooldownTicks without decrementing on its starting tick. Timer recovery fills that mode's pool when its cooldown reaches zero. Real ground contact refills ground-reset pools, including same-tick landing; it does not erase cooldown. Holding dash never repeats. Duration continues across ground/air transitions; blocking contact or the last movement tick ends it. Gravity scales acceleration with truncation toward zero and preserves incoming vertical velocity. Climb requests precede new dash starts; jump/drop do not interrupt active dashes. Runtime state is resumable and stays outside source documents.

The bounded navigation module samples actual launch velocities, neutral/left/right controls, jump hold variants, dash pulses and coast segments. Every edge retains exact full-body frames, charges, cooldowns, remaining dash duration and input edges. Whole routes replay without resets at joins; dash profiles use h=0. State/replay/action limits and cancellation never publish partial edges. No completeness, wall/grapple solver or moving-platform rendezvous claim.

Fixtures carry tick inputs, exact integer states and action events generated from separate restricted equations. CI compares runtime/Test/browser replay to those bytes, checks every final-byte digest, verifies an independent exported-bundle consumer, and rejects semantic corruption after digests are recomputed. Thin-wall fixtures require the exact first finite-body contact; tolerance is zero. Independent equations deliberately cover the owned axis-aligned numeric corpus only, not arbitrary geometry or universal engine parity.
