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

Geometry, layers, gameplay, camera, environment and navigation members are only
type-checked until ML-004–006, so these fixtures make no claim about them beyond
inheriting R1's checked example content.
