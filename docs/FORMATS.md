# Format contracts

[Specification D, F and G](specifications/2026-10-16-maplab.md), amended by
[R1](specifications/2026-10-17-maplab-r1/F-formats.md), govern the contracts.
ML-006 completes the eight typed F sketches with local, closed JSON Schema
2020-12 files: map, tileset, prefab, movement, catalog, project, export and
navigation. `maplab.palette` has no adopted field sketch yet; it and the reserved
`maplab.world` name fail closed until their separately governed tasks.

`loadSourceGraph` accepts an explicit array of bounded JSON byte/string inputs;
`validateSourceGraph` accepts parsed JSON values. Both validate authored maps,
tilesets, prefabs, movement and catalogs as one source dependency graph. No I/O,
network lookup, runtime handlers or editor imports occur in these APIs. A failure
returns diagnostics only; success returns detached frozen typed documents,
warnings, per-profile movement compatibility, and explicit deferred runtime work.
`contractSupported`, `runtimeImplemented` and `canCertify` remain distinct.
Unsupported movement configuration retains ML-005's capability report; a valid
source graph never claims engine parity, a runnable controller or a route proof.

Required dependencies and all used reference targets must exist with the declared
format/kind. Optional unused prefab provenance may be absent from exported maps.
Portal cycles between maps are legal; dependency cycles involving templates are
errors. Cross-map `ObjectRef.mapId` identifies a declared map, never a prefab's
local namespace. IDs are unique within each map and documents within the supplied
graph. Encounters own distinct groups; route abilities must match their actors.
Catalog `(key, version)` identities are unique across the graph. Calls resolve
only through the owning document's declared transitive catalog dependencies.
Movement documents have no dependency list: catalog extensions bind in each map/
prefab dependency scope that uses them, or the explicit supplied catalog set for
unowned profiles. Unowned profiles cannot resolve map-local parameter references.

Every parameter binds to one of six field types: integer, number with positive
quantum, bounded string, boolean, enum or typed reference. Unknown/missing fields,
wrong handler kinds and dangling/wrong-kind references reject. Decimal field
quanta use exact decimal divisibility, without floating tolerance. Params cannot
contain arrays, nested arbitrary objects, code or executable extension payloads.
Field names are bounded strings (R1 uses camelCase names such as `lootTable`);
catalog keys and object IDs retain the adopted lowercase grammar.

Handler-kind bindings are explicit:

| Use | Catalog kind |
|---|---|
| Entity archetype; quest/objective definition | archetype |
| AI behavior and registered fallback | behavior |
| Checkpoint activation, interaction, trigger/onComplete, crush action | action |
| Material/hazard/environment/transition, cutscene marker, camera shake | effect |
| Respawn event, encounter wave/completion identity | event |
| Scripted traversal, explicit nav link, registered ability/ledge action | traversal |
| Movement-modifier zone and allowed movement modifiers | modifier |

Conditions are data trees, at most depth 8 and 256 leaves per condition list;
flag references and entity state names resolve. Camera settings use 60 Hz integer
ticks, normalized 1/256 dead zones contained within the view, `platformSnap` and
`climbFollow`. Bounds constrain the visible rectangle. Smaller bounds produce a
letterbox warning; equal-priority overlapping zone bounds warn with stable ID
precedence. Region shapes and resolved navigation anchors obey world limits.
Environment audio references audio assets; all four zone kinds remain data only.
RigLab presentation bindings validate local assets/semantic fallback graphs and
name foreign dependencies. ML-030 separately validates foreign bytes and baked animation through `src/riglab/`; the source-graph validator alone still establishes no foreign-byte claim.

`validateDocumentSchema` validates syntax for every published format. For project,
export and derived-navigation documents it does **not** establish library-save
integrity, inventory/digest closure, witness replay or cache identity correctness.
Those implementations remain in their reserved tasks. No exporter, library saver,
AI, camera runtime, script interpreter, navigation solver or authoring UI is added.

`loadMapHeader`, `loadMapGeometry`, `loadTileset` and `loadPrefab` remain explicit
partial readers with `deferred` scopes. Their schema views preserve the earlier
scope boundaries; only the full graph reader establishes gameplay/catalog closure.
Geometry checks retain stable shape/edge ownership, exact welds, polygons,
actor planes, anchor cycles, motion legs, terrain permissions and prefab provenance.
Profile-dependent resting stance/full-body clearance and controller replay remain
explicitly deferred.

ML-007 adds the independent final-byte reader in `tests/consumer/reader/`. It is a
separate Node program that imports only Node built-ins and its own folder, never
`src/`. It reads a folder bundle plus the pinned `schemas/` from disk and performs
the following parts of adopted G1 steps 1–4:

- a bounded safe-path inventory that refuses symlinks, special files, empty
  directories, hidden, reserved and aliased names, and nested archives;
- duplicate-key-rejecting strict UTF-8 JSON;
- a canonical JCS manifest with complete inventory, exact sizes, SHA-256 and the
  bundle digest;
- exact format/version and contract negotiation, for closed bundles only (external
  maps are deferred). Each contract member is checked for its role: `requiredFeatures`
  names distinct semantic contracts, `collisionContract` only `maplab.collision` v1,
  the camera `model` only `maplab.camera` v1 and a profile `controller` only
  `maplab.reference-controller` v1;
- independent closed-schema evaluation and dependency closure, where an absent
  optional dependency still names one path per ID and one ID per case-folded path;
- reference resolution inside each map's dependency closure, including portals,
  typed parameter refs, every catalog entry a map uses, and asset paths. Every
  movement profile in a map's closure is resolved in that map, whether or not the
  map declares it, and terrain must declare its tileset directly.

Every `*Id`/`*Ids` member and every `{key, version}` member of the published v1
schemas is classified explicitly: as a contract, a catalog entry or a solver
declaration. An unknown member fails closed. The reader checks that catalog entries
exist. It does not check handler kinds, parameter semantics or the F3 semantic
rules, which remain `src/contracts` validation. It constructs no world, renderer,
engine or navigation, and its report says so.

## RigLab foreign boundary

Supported exact versions are riglab.export v1, riglab.rig v1, riglab.anim v3, optional riglab.weapon v1 and riglab.baked v1. Source paths remain relative to the inner manifest beneath their own immutable prefix; no authored path is extracted into a general library location. File hashes establish consistency, not publisher identity. Unknown fields, unsafe/aliased paths, broken references, nonfinite transforms and unsupported versions refuse before preview/export. A valid unbaked bundle remains storable and referenceable, with an inert placeholder.

Limits: 16 MiB per foreign bundle/ZIP, 8 MiB per JSON file, 128 files and bones, 64 animations, 32 weapon definitions, 64 bodies per weapon, 250,000 bone transforms per baked clip, and absolute numeric transform components at most 1,000,000. Bindings admit 256 art slots and 128 semantic actions. Baked frame count must exactly match the clip's 60 Hz loop/one-shot timing; no arbitrary frame-rate resampling or simulation evaluation occurs. Missing approved art uses a placeholder. Existing source schemas remain v1, unchanged.
