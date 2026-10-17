# G. Engine integration architecture

An engine consumes **exported bytes**. It never uses MapLab's editor, reducer, storage adapters or
UI. It may optionally use two independently versioned, editor-free packages that MapLab can publish
later: a format validator and the reference controller (RC0). The published schemas, contract
prose and fixtures are enough to write an importer from scratch.

## G1. Load sequence (*adopted §G1*, Kept, condensed)

1. **Read** a folder or STORE ZIP within the bounds in the H4 limits table. Reject unsafe or
   aliased paths, duplicates, symlinks and nested archives. Parse `manifest.json` with
   duplicate-key rejection against the `maplab.export` v1 schema.
2. **Verify bytes**: complete inventory (every entry listed, every listed entry present), exact
   sizes, SHA-256. Optionally check a trusted outer digest. A hash proves integrity against the
   manifest, not who published it.
3. **Negotiate**: every `requiredContracts` and `requiredFeatures` entry, and every catalog entry
   used, must be supported. Otherwise refuse with a capability report.
4. **Validate** documents against the bundled schemas, then the F3 semantic rules. Reference cycles
   among documents are errors. Portal cycles between maps are legal.
5. **Construct** the world source:
   - visual scene (layers, parallax, actor planes, occlusion hints),
   - collision world (bodies to colliders, one-way footholds to one-way supports, segment bodies to
     two-sided walls),
   - a **source-ID → runtime-handle** table,
   - support and traversal indexes.

   Unit and axis conversion happens **once**, here (G4). Collision is built before any actor.
6. **Bind movement**: archetype → profile → the engine's controller. Accept a shipped
   `maplab.navigation` cache only if its full identity matches a controller the engine has tested.
   Otherwise rebuild it, or omit AI navigation honestly.
7. **Spawn**: resolve starts and anchors through stance resolution. Overlapping or unsupported
   required starts are errors. Initially disabled spawns (e.g. the boss) stay definitions until an
   action enables them.
8. **Activate** triggers, encounters, camera, audio and environment zones, and portals under the
   declared tick and event boundary.
9. **Change**: doors, destructibles, gates and platform phases live in a **runtime overlay keyed by
   source ID**, never in the authored JSON. Each change bumps a physical revision and triggers
   navigation invalidation (E5).
10. **Travel and save**: a portal resolves `{mapId, entityId}`, loads and validates the destination
    if needed, places the actor by stance resolution, and applies a re-entry guard so touch portals
    cannot loop. Saves bind the engine save version, bundle digest and per-source-ID overrides.

## G2. Authority boundary (*adopted §G3*, Kept)

| Data | Owner | Persistence |
|---|---|---|
| Geometry, layers, materials, profiles, catalog calls, starts, routes, links, camera and nav intent | Author (MapLab) | Library documents, exported as exact bytes |
| Spatial indexes, decompositions, resolved anchors, nav graphs, witnesses, render batches | Rebuildable | Optional caches with full identity |
| Actor transforms, health, AI targets, flags, door states, platform phases, encounter progress, camera smoothing | **Engine runtime** | Engine save format, separate from maps |
| Selection, zoom, tool, history, recent files, drafts | Editor session | Library sidecars and IndexedDB drafts. Never exported |

## G3. Actor composition and RigLab presentation (Kept, with R1 specifics)

**Authority order, one way only:**

1. physical foot reference `P`, velocity and mode (controller),
2. the contact or support,
3. the **presentation anchor**: `Pv`,
4. the RigLab rig transform,
5. the sampled baked pose,
6. weapon art at baked body transforms.

Nothing flows back. No animation frame may change the collider, mask, velocity, resources,
triggers or combat state. Root translation is visual only.

**Ground contact (R1).** With `groundContact: "supportLine"`, a grounded actor's art is drawn at
`Pv = (P.x, groundY(support, P.x))`, the line under its center. This removes the visual hover of
the full-footprint stance on slopes (D4). Physics keeps `P`. With `"footReference"`, `Pv = P`.

**Rig placement.** `world = Pv + diag(f·s, s) · (p − a)`, where:

- `p` is a rig-space point and `a` is `rigGroundAnchor`,
- `s` is `worldUnitsPerRigUnit`,
- `f = +1` when the actor faces the rig's `nativeFacing`, else −1.

RigLab space is already Y-down, so there is no axis flip. Facing left uses the rig depth profile's
`facingLeft` side map for paint order, not only a mirrored matrix (B2).

**Sampling.** The controller runs at 60 Hz, and `riglab.baked` holds one frame per 60 Hz tick
(B2), so presentation picks frame `(tick − stateEnterTick) mod length` for loops, or clamps for
one-shots, with **no resampling**. Engines at other display rates interpolate visually without
touching physics.

**Semantic actions → RigLab clips.**

- The controller state picks a semantic. Each semantic picks an animation or follows a declared
  fallback chain. Cycles and missing targets are validation errors.
- Current RigLab clips are `<class>-{idle, walk, jump, attack, hit}`. Run, fall, climb, dash, wall
  and ledge **do not exist yet**. They fall back, and the preview shows a "missing clip" badge while
  the physical action still works.
- Example binding (documentation, not part of the fixture). It scales the 91-unit chibi to about
  45.5 WU for a 24×48 collider:

```json
{"id": "pres.chibi", "kind": "riglab", "bundleDependencyId": "riglab.chibi", "expectedExportVersion": 1,
 "rigGroundAnchor": [0, 0], "worldUnitsPerRigUnit": {"num": 1, "den": 2}, "nativeFacing": "right",
 "rootMotion": "visualOnly", "groundContact": "supportLine", "artSlots": [],
 "actions": [
  {"semantic": "locomotion.idle", "animation": "unarmed-idle", "fallbackSemantic": null},
  {"semantic": "locomotion.walk", "animation": "unarmed-walk", "fallbackSemantic": "locomotion.idle"},
  {"semantic": "locomotion.run", "animation": null, "fallbackSemantic": "locomotion.walk"},
  {"semantic": "locomotion.jump.rise", "animation": "unarmed-jump", "fallbackSemantic": "locomotion.idle"},
  {"semantic": "locomotion.fall", "animation": null, "fallbackSemantic": "locomotion.jump.rise"},
  {"semantic": "climb.ladder", "animation": null, "fallbackSemantic": "locomotion.idle"},
  {"semantic": "reaction.hit", "animation": "unarmed-hit", "fallbackSemantic": "locomotion.idle"},
  {"semantic": "action.attack", "animation": "unarmed-attack", "fallbackSemantic": "locomotion.idle"}]}
```

**Import.** MapLab validates the bundle with its own validators, because an exporter is not a
security boundary:

- `riglab.export` v1 manifest hashes, safe relative paths,
- `riglab.rig` v1, `riglab.anim` v3, optional `riglab.weapon` v1 and `riglab.baked` v1,
- bone references, finite transforms, frame counts, size limits.

The bytes are stored verbatim under `presentations/<id>/`. Art (skins, palettes, part SVGs) is not
in RigLab exports, so it is imported separately through the SVG pipeline (H4) and bound with
`artSlots`.

**Placeholder actor.** A collider outline, facing arrow, foot marker and state label. It always
works and is the default in Test.

## G4. Engine adapter rules (Added)

| Engine family | Required conversions at the import boundary |
|---|---|
| **Y-up** (Unity 2D, Box2D, Hexframe) | `y′ = −y` (or `boundsTop − y`). Negate vertical velocities and normals. Flip rotation sign. **Reverse polygon vertex order**: clockwise-on-screen polygons become clockwise in Y-up, and Box2D expects counter-clockwise. **Reverse one-sided chains**: Box2D's front face is on the right of a→b (A3), and MapLab's free side becomes the left after the flip. Run slope tests on the converted normals |
| **Y-down** (Godot 2D, Canvas or custom TS) | No axis change. Godot one-way shapes take their direction from the foothold normal. `floor_max_angle = atan(rise/run)`: transcendental math is fine in an adapter, never in the reference controller |
| **Float32 storage** | Authored coordinates import exactly (D1). Keep the source-ID handle table for welds instead of comparing floats |
| **Other tick rates** | Substep at 60 Hz for parity claims, or rebuild navigation under the engine's own controller |
| **Units** | One declared scale from WU to engine units. Convert su/tick by `× 60/256` WU/s. Never round authored geometry for display |

## G5. Compatibility claims

An engine states one of the following per profile and controller (fixtures in I2):

- **Exact**: an integer port of RC4 whose traces equal the reference.
- **Tolerant**: its own physics, within the published per-fixture tolerances. Support IDs, events
  and ability counts must still be exact.
- **Rebuild**: navigation regenerated under its own controller, with the honest statuses of E1.

"Same gravity and jump numbers" is never a claim.
