# Owned RigLab presentation corpus

CC0-1.0, MapLab authors. The rig, animation keys and armor primitive are new owned data, not copied artwork. source-model.json is the input to the pinned RigLab exporter identified in provenance.json; no authoring tool or solver is shipped in MapLab. The exact inner manifest and file bytes are retained under bundle/; owned-rig.zip is the original STORE container.

The three 60 Hz clips cover looping idle/walk and a clamped jump. Nonzero root translation is deliberately visual. Facing-left depth sides swap near/far arms and legs. Every body slot is explicitly bound to separately approved armor.svg in the proof; missing art or baked data yields an inert generic actor.

CI exercises hash/version/path/reference/frame bounds, source/outer digest tampering, malformed bindings, mirrored matrices, fallbacks, unbaked/missing-art placeholders, immutable library reads, guarded import endpoints, export closure and unchanged physics traces. The separate final-byte consumer imports Node and its own reader only.
