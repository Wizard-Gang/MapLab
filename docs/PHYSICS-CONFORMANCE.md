# Controller conformance authority

ML-005 publishes the [controller/collision contract](CONTROLLER-CONTRACT.md),
[complete movement schema](../schemas/maplab.movement.v1.schema.json) and
[capability registry](../contracts/maplab.reference-controller.v1.capabilities.json).
The adopted [R1 RC0–RC5](specifications/2026-10-17-maplab-r1/D-reference-controller.md)
is normative: 60 Hz, integer sub-units (1/256 WU), exact division, X then Y motion,
full-footprint rect stance and explicit unsupported capabilities.

No numerical controller, Test mode or navigation certificate is implemented by
ML-005. Its fixtures prove profile syntax, resource rules, support diagnostics and
complete-profile digest behavior. ML-017 onward owns the numerical I2 traces;
ML-043 owns additional engine conformance. Identical coefficients never establish
solver parity. Adopted R1's proposed tolerant defaults are position ≤16 su,
velocity ≤4 su/tick, exact support/resources/events and only fixture-permitted
±1-tick timing. They cannot be raised to hide tunneling or incorrect support.

Source, resolved poses and mutable runtime state stay separate. A valid profile
with `contractSupported: true` still has `runtimeImplemented: false` and
`canCertify: false` in this task. Advanced unsupported configuration is reported,
never silently approximated or executed.
