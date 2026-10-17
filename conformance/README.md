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
