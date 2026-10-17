# F. Format proposal

The normative field vocabulary is the type-checked TypeScript contract in [`contract/`](contract/):
`common.ts`, `map.ts`, `gameplay.ts` and `documents.ts`. Published JSON Schemas (closed, 2020-12,
bundled locally, never fetched) and the semantic rules in F3 enforce what TypeScript cannot:
ranges, quanta, closure and references. The complete example bundle is in
[`examples/forest/`](examples/forest/), and its exported, hashed form is in
[`examples/forest-export/`](examples/forest-export/).

## F1. Format family

Each format below gets its own document type and its own version. Maps, tilesets, prefabs,
movement and the export container all change independently (*adopted §F1*, **Kept**).

| Format | Authority | Exported? | Phase |
|---|---|---|---|
| `maplab.map` v1 | Authored world: geometry, layers, gameplay, camera, navigation intent | Yes, prefab-expanded | ML-003–006 |
| `maplab.tileset` v1 | Tile identity, art, transform permissions, deterministic terrain rules, tile-local trace shapes (R1) | Yes, when a tile layer uses it | ML-004 |
| `maplab.prefab` v1 | Reusable template with local IDs | **No.** It expands on placement. `map.prefabPlacements` keeps provenance (R1) | ML-004 / ML-029 |
| `maplab.movement` v1 | Collider, controller binding, integer kinematics, all ability families (RC5) | Yes | ML-005 |
| `maplab.catalog` v1 | Engine-owned vocabulary: archetype, behavior, action, effect, event, traversal, modifier, animation. Data only | Yes: the vocabulary the map was validated against | ML-006 |
| `maplab.export` v1 | Bundle manifest: closure, byte inventory, required contracts | Yes, as `manifest.json` | ML-016 |
| `maplab.navigation` v1 | Derived graph, witnesses and full cache identity | Optional, off by default, always discardable | ML-021+ |
| `maplab.project` v1 | **R1.** Library index with per-document digests, written last on save (H4) | Never | ML-009 |
| `maplab.palette` v1 | Editor authoring aid | Never. Expanded to literals | ML-013/014 |
| `maplab.world` | **Reserved name** for a multi-map layout or streaming document | Deferred | — |

**Named semantic contracts** (not documents): `maplab.collision` v1,
`maplab.reference-controller` v1, `maplab.camera` v1 and `maplab.climb` v1. Each has prose rules and
conformance fixtures (I2). A map's `requiredFeatures` and a profile's `controller` bind them, and
unknown required contracts fail closed.

## F2. R1 changes to the adopted field vocabulary

Relative to *adopted §F2*:

| Area | Change |
|---|---|
| Coordinates | `coordinates = {units:"WU", …, quantum:0.0625, ticksPerSecond:60}`. Range ±131,072 WU (D1) |
| Bodies | `BodyShape.id` added. `EdgeRef.shapeId` replaces `shapeIndex` |
| Footholds | `planeId` added. Layer kind `actors` added. Foreground is decided by order, so the `foreground` kind is removed, and `occlusionFade` is advisory (D5) |
| Time | All seconds become ticks: `waitTicks`, `delayTicks` (respawn and portal), `dampingTicks`, `transitionTicks`, `fadeTicks`, `cooldownTicks`, `extraCostTicks`, `penaltyTicks`, `frameTicks` (the separate frames rate is removed), background `scrollWUPerTick` |
| Materials | `traction` is an integer where 256 = 1.0. `conveyorSu` is su/tick |
| Camera | `verticalPolicy: continuous \| platformSnap \| locked` (the adopted `groundedHysteresis` renamed after Keren, A7), plus `climbFollow` |
| Movement | Integer `units`, `support`, `grabHeight`, `maxSlope {rise, run}`, `uphill`/`downhill` ratios, `drop {canDrop, timeoutTicks}`, integer abilities, `fly.turnAcceleration` (RC5) |
| Tileset | `traceShapes` per tile, used only by "Trace from tiles" (D2) |
| Catalog | Field types `integer` and `number` (with quantum). Entry kind `animation`. Entry `stage: planned \| available` |
| Entities | `presentationId` is now explicit nullable instead of optional, since closed objects avoid absent-versus-null ambiguity. Portals gain `delayTicks`. Region roles gain `hazard` and `checkpoint` |
| Presentation | `RigPresentationBinding.groundContact` and `worldUnitsPerRigUnit` as a ratio (G3) |
| Map | `prefabPlacements` provenance |
| Navigation cache | su/tick units. Witness inputs are run-length (`fromTick`) |

## F3. Semantic validation rules (beyond the schema)

| Group | Rules (each has a stable diagnostic code) |
|---|---|
| Identity | ID and catalog-key grammar `^[a-z0-9][a-z0-9._:-]{0,95}$`. IDs unique across all collections of a map. Document IDs unique across the dependency closure. Catalog `(key, version)` unique. IDs never reused after deletion within a document's history |
| Numbers | Coordinate quantum and range (D1). `u` on a 1/65536 grid. Positive sizes. Integer ticks and su. Bounded counts (H4 limits table) |
| Geometry | Polygons simple and clockwise on screen. Footholds non-degenerate and x-monotone. `solid` footholds equal their `{bodyId, shapeId, edgeIndex}` edge exactly, with a matching owner. Welds exactly coincident and reciprocal. No two same-facing supports with ambiguous ownership. Climb paths vertical in v1, with access anchors on the path. Grounded access on a support with body clearance for each declared ability profile |
| References | Every reference resolves to its **expected kind**: layer, visual, body/shape, foothold, region, route, waypoint, entity, encounter, flag, material, movement, catalog entry. Catalog calls bind to the right entry kind, with closed and type-checked params. Cross-map portal destinations exist in the closure |
| Semantics | Exactly one default `playerStart`. At least one `actors` layer. Resting anchors (starts, spawns, waypoints) have full-footprint support for their own profile. Encounter groups are not shared by two encounters. Camera bounds smaller than the view produce a letterbox warning. Equal-priority overlapping zones produce a warning |
| Capability | Abilities the controller does not support produce an "unsupported" diagnostic. Route `requiredAbilities` must be a subset of its actor's profile tags. A "planned" catalog entry produces a "configured, not simulated" notice |

**Diagnostics** are `{code, severity, documentId, objectId, jsonPath, worldBounds, message, repair?}`.
Errors block save of an invalid document (it stays as a read-only recovery copy) and block export.
Warnings never suppress missing physics.

## F4. Serialization

- **Library form** (files in the library folder):
  - UTF-8, LF, trailing newline, 2-space indentation,
  - **key order = the published schema's `properties` order** (`format`, `version`, `id` first),
  - domain-ordered arrays (below),
  - shortest round-trip numbers.

  This is deterministic and diff-friendly, like RigLab's files. The example sources in `examples/forest/`
  are hand-formatted; MapLab's first save rewrites them in library form.
- **Export form** (bundle bytes): RFC 8785 JCS, no trailing newline, after domain normalization
  (*adopted §F5*, **Kept**).
- **Domain order**:
  - Sorted by `id`: dependencies, assets, presentations, visuals, materials, bodies, shapes,
    footholds, traversals, access points, regions, entities, waypoints, routes, triggers,
    encounters, flags, prefab placements, camera/environment zones, navigation volumes, links and
    overrides, tileset tiles/terrains/rules.
  - Layers by `(order, id)`. Catalog entries by `(key, version)`. Abilities by `kind`.
  - String sets sorted and de-duplicated: masks, tags, ability lists, actor categories, profile
    IDs, override actions, body IDs, expanded IDs.
  - **Order preserved**: vertices, route waypoints, conditions, actions, `onComplete`, frames,
    motion legs and chunk cells. Chunks are ordered by `(row, column)`.

## F5. The complete example bundle

`examples/forest/` holds 8 source documents and a generated `maplab.project.json`:

- `maps/forest.map.json`, `maps/clearing.map.json`
- `movement/player.movement.json`, `movement/ground.movement.json`, `movement/flyer.movement.json`
- `catalogs/core.catalog.json`, `tilesets/forest.tileset.json`, `prefabs/tree.prefab.json`

Together they cover the whole acceptance scenario (directive §20):

- solid west ground,
- a welded east floor, slope and boss floor on one polygon body,
- three one-way platforms with drop groups,
- a ladder whose top exit lands on a platform,
- a rope over the gap with an airborne bottom access,
- a 128 WU jump gap with a hazard pit,
- segment world-edge walls,
- three background layers (camera sky plus two parallax layers),
- an `actors` plane and a foreground layer with occlusion fade,
- one expanded prefab tree,
- a slime patrol (ping-pong, no-jump profile), a bat (flight volume), a boss encounter with a gate
  body toggled by trigger and completion,
- an NPC, a chest with typed params, a checkpoint,
- camera defaults plus a locked boss zone, environment effects,
- a nav override forbidding pit routes,
- a cross-map portal to `map.clearing`, which has its own return portal (portal cycles are legal).

`examples/forest-export/` is that closure exported as JCS bytes plus `manifest.json`
(`maplab.export` v1). It has 7 files plus the manifest. The optional prefab is excluded, because
its content is already expanded. **Bundle digest** (SHA-256 of the manifest bytes):
`0a39dafd637c7cefa184ce9f18bd909d47f3eef317de3418bb3573614bf323ea`.

The bundle omits `schemas/*.json`, which do not exist until ML-003. A real export includes the
schemas it validated against.

**Planning QA performed** (throwaway scripts, not shipped):

- All 8 documents and the generated project index and manifest type-check against `contract/`
  with `satisfies` under `strict`. A deliberately corrupted copy fails, so the check is real.
- A semantic pass found no errors after one fix. It covered:
  - ID and key grammar (this caught four camelCase IDs, now renamed),
  - quantum and range,
  - clockwise polygons,
  - solid-edge equality,
  - weld reciprocity,
  - access anchors on paths and on support,
  - full-footprint resting anchors,
  - typed catalog calls and params,
  - cross-map portal targets,
  - expanded prefab IDs.
- Two consecutive exports of the same sources are byte-identical.

This is specification evidence, not an implemented validator.

## F6. Export bundle rules (Kept, with R1 notes)

- `manifest.json` excludes itself. The bundle identity is SHA-256 of its JCS bytes.
- Files are sorted by path. Each has its exact byte size, SHA-256 and a role
  (`authored | asset | schema | derived | foreign`).
- `requiredContracts` lists every format version and semantic contract the consumer must support.
- Export closure is the required-dependency closure from the entry maps. Optional dependencies are
  included only when they are needed.
- **Containers**: a folder, and/or a STORE ZIP with lexical order, a 1980-01-01 DOS date, UTF-8
  names, no extras and no directory entries (RigLab's writer pattern, B1).
- No timestamps, absolute paths, handles or editor state. The same inputs plus the same generator
  version give identical bytes.
- RigLab bundles are copied verbatim under `presentations/<bundle-id>/`, with role `foreign`.
  MapLab hashes the exact bytes, and their own manifest is validated on import (G3).

## F7. Versioning, compatibility and migration (Kept)

- Format versions are integers, independent of the app's semver.
- With closed grammars, **any** field change needs a new format version. The one exception is new
  catalog or ability entries under the extension contract.
- `requiredFeatures` and `requiredContracts` fail closed.
- Consumers declare the exact versions they accept, or a tested migration chain. They never accept
  "`version ≤ latest`" blindly.
- The editor reads the current and the previous version through pure, deterministic migrators,
  each with golden before/after fixtures. Migration is copy-on-write with a report.
- Migration never invents collision from art, ground anchors from rig feet, or ability
  feasibility.
- An older app can preserve an unsupported newer document byte-for-byte, read-only.

**R1 timing.** Nothing is implemented yet, so R1's deltas cost nothing now. From ML-003 onward,
every change follows this policy, including R1's own follow-ups.
