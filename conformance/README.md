# Conformance fixtures

Owned golden inputs with expected outcomes, as specified in the adopted
specification I2 and R1 I2. All files here are dedicated under **CC0 1.0
Universal** (see [provenance](../docs/PROVENANCE.md)); none is third-party data.

## `map-header/` (ML-003)

Golden inputs for the `maplab.map` v1 header and base subset, read by
`loadMapHeader` in `src/contracts/` against `schemas/maplab.map.v1.schema.json`.

- `cases.json` is the index. Each case names a repository-relative file, its
  SHA-256 and the expected outcome: `{"valid": true}` or exactly one diagnostic
  `{"code", "jsonPath"}`. Tests fail if a file is unlisted, listed twice or
  changed without updating its digest.
- `valid/base.map.json` is R1's `examples/forest/maps/clearing.map.json` with
  conformance metadata and ID. `valid/extremes.map.json` exercises range,
  quantum, path-length, ID-length and asset edges that must still pass.
- Every `invalid/*.map.json` is the base with exactly one defect: malformed or
  ambiguous JSON bytes, the wrong format or version, an extra or missing member,
  ID and key grammar, off-quantum or out-of-range coordinates, unsafe or aliased
  paths, unsupported contracts and inconsistent assets.
- R1's two example maps are listed in place as valid golden inputs.

The header API now checks the expanded structural schema; semantic geometry
validation belongs to the geometry API below. Gameplay, camera, environment and
navigation remain deferred. The deferred-member-type case uses `regions`, which
is still outside ML-004's scope.

## `geometry/` (ML-004)

`cases.json` pins every owned valid/invalid geometry fixture and the unchanged R1
forest, clearing, tileset and prefab examples, including exported map bytes.
Every invalid golden file expects exactly one diagnostic code and JSON path.
The suite covers stable shape IDs, source-edge ownership/equality, clockwise and
self-intersecting polygons, reciprocal welds, parent cycles, dangling/wrong-kind
anchors, actor planes, terrain cells and prefab slot/provenance failures.

Additional executable regressions check entity-anchor chains/cycles, visual
content layers, expanded prefab object kinds and actor-plane bindings, motion
phase bounds and tile permissions. A separate Node process reads final forest
JSON and independently resolves solid-edge endpoints using only the published
contracts/schema modules. Node's built-in TypeScript stripping prepares that
consumer; the TypeScript compiler API and editor runtime are not imported.

## `movement/` (ML-005)

The index pins unchanged R1 player/ground/flyer source/export bytes plus owned
valid/invalid examples for every family and version. Valid cases record expected
unsupported diagnostics separately from parsing errors. Capsules, center-foot,
extra jumps and advanced solvers never certify movement.

Valid cases also pin canonical-profile SHA-256 vectors independently generated
from ASCII-key JSON, normalized domain sets and separately hashed UTF-8 bytes.
Tests compare Web Crypto and Node crypto, same-version coefficient/effective
profile edits, Unicode/JCS boundaries and semantic reorderings. A separate Node
process reads final profile bytes and computes the digest without editor imports.
Numerical controller traces remain their reserved tasks.

## `gameplay/` (ML-006)

Owned CC0 `all-kinds` map/catalog bytes extend the unchanged R1 forest closure
with every entity kind, every catalog field type, every environment zone kind,
nav links and compound conditions. `cases.json` pins those bytes and supplies 32
inert mutation records with expected rejection codes. Tests apply them only to
clones: wrong handler/ref kinds, unknown params/flags, portal destinations,
capability mismatch, camera ticks/dead zones and arbitrary script payloads reject.

Additional executable regressions cover every ObjectRef kind, cross-map scopes,
non-map cycles, decimal quanta, unused-profile extensions, resolved nav-anchor
ranges, compatibility reports, warning saturation and immutable outputs. A separate
process checks final catalog bytes and closed schema rejection without importing
the editor. Full independent bundle/fixture loading is ML-007's `bundle/` below.

## `bundle/` (ML-007)

`cases.json` pins the golden inputs for the independent reader `consumer/read-bundle.mjs`.
The inputs are the unchanged R1 forest source documents and `maplab.project.json` index,
each listed with its declared schema, and the R1 export bundle with bundle digest
`0a39dafd…`. The source digests must equal the project index digests. Each source
document must validate against its declared schema under the reader's own evaluator.

Tests copy only `consumer/` and `schemas/` into a scratch folder and spawn the reader
there. It must read both maps and resolve the reciprocal portals. Each of the 54 inert
edit records changes a temporary copy of the export bundle. JSON edits re-encode the
edited file as JCS and re-hash it, unless the record says otherwise, so each negative
record isolates one defect. It must then produce exactly its expected diagnostic code,
file and JSON path. The records cover:

- inventory: symlinks, unsafe or reserved names, nested archives, unlisted or missing files;
- manifest: tampering, duplicate keys, non-canonical bytes, case aliases, schema mismatch;
- document bytes: malformed JSON, UTF-8, BOM, duplicate members, lone surrogates;
- negotiation: future, older and unknown versions and formats, unsupported or undeclared
  contracts, external maps;
- closure: missing dependencies and unreachable documents;
- references: duplicate object IDs, dangling or wrong-kind references, portal map and
  entity, movement profiles, undeclared calls;
- asset paths: reserved, traversal, media mismatch, unbundled.

Two positive records add a listed asset file and the five pinned schemas in the F4
layout; both must still be accepted. A differential test runs the reader's parser and
evaluator against `src/contracts` on every owned conformance file and R1 example. The
two must agree on byte acceptance and closed-schema validity.
