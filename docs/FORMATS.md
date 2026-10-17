# Format contracts

[Specification D, F, and G](specifications/2026-10-16-maplab.md), amended by
[R1](specifications/2026-10-17-maplab-r1/F-formats.md), are adopted design material.
ML-003 implements the bounded parser in `src/contracts/` and the `maplab.map` v1 header
subset: IDs, 1/16 WU coordinates within ±131,072 WU, 60 Hz tick fields, safe paths,
dependencies, assets and bounds. ML-004 extends `schemas/maplab.map.v1.schema.json`
with geometry, layers, visuals, terrain and prefab provenance, and publishes
`schemas/maplab.tileset.v1.schema.json` and `schemas/maplab.prefab.v1.schema.json`.
ML-005–006 complete movement and gameplay contracts; ML-007 adds the complete
independent bundle reader.

Use `loadMapGeometry`, `loadTileset` and `loadPrefab` from `src/contracts/` for
bounded parsing, structural validation and semantic validation of these scopes.
Their `validate…` counterparts accept already parsed JSON. Successful results
contain a detached, deeply frozen document, an explicit `deferred` list and
`unresolved` external tileset/prefab IDs; failures contain diagnostics only.
`loadMapHeader` remains a base-header API: its use of the expanded published
schema does not establish semantic geometry validity.

Geometry checks include clockwise simple polygons, stable shape-edge ownership,
exact source-edge equality, reciprocal endpoint welds, layer/visual parent cycles,
actor-plane references, anchor reference cycles and access-point attachment.
Visuals paint only in sprite/background layers. Tileset trace shapes remain
tile-local suggestions. Prefab provenance preserves expanded object kinds and
visual/actor-plane slot bindings. Motion paths validate durations, loops and
initial phase, without running a moving-platform solver.

Pass only validated tileset/prefab documents as `GeometryContext`. With those
documents present, map validation checks terrain cell permissions and prefab
namespaces/bindings. Missing context is named as unresolved, and is never fetched.
Gameplay collections, catalog-bound calls/conditions and profile-specific stance,
support and clearance remain explicitly deferred. A successful geometry result is
not a claim of gameplay validity, dependency closure or controller compatibility.

Future formats use closed versioned headers, stable IDs, bounded X-right/Y-down
world coordinates, explicit asset/dependency references, and independent authored
documents. Geometry, visual layers, prefabs, every movement ability family,
gameplay catalogs, camera/environment intent and navigation intent have explicit
source boundaries. Generated graphs are optional caches; mutable simulation state
is never canonical authored content. Unknown required versions/features fail.

Parsing must bound bytes and depth, reject duplicate keys and unsafe/aliased paths,
validate cross-document references and exact geometry, and stage before opening.
Schemas are local, closed JSON Schema 2020-12 plus independent semantic validators;
network schema fetching and executable extension strings are forbidden.

Exports require complete transitive closure, SHA-256 byte inventories, JCS property
and number serialization, specified semantic array ordering, deterministic STORE
ZIP metadata, and independent final-byte verification. Do not infer ZIP determinism
from canonical JSON or publisher authenticity from an unsigned manifest. Current
and previous schema migrations need deterministic proof fixtures. Asset/archive
limits and path rules remain specification H4 authority until implemented.

Optional RigLab manifests/baked data must be independently validated and bound to
explicit art, scale, ground anchors and actions. They never supply collider, root
motion, or gameplay authority. Unbaked/missing-art input uses a placeholder.
