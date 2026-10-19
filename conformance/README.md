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

`cases.json` pins the golden inputs for the independent reader
`tests/consumer/reader/read-bundle.mjs`. The inputs are the unchanged R1 forest
source documents and `maplab.project.json` index, each listed with its declared
schema, and the R1 export bundle with bundle digest `0a39dafd…`. The source digests
must equal the project index digests. Each source document must validate against its
declared schema under the reader's own evaluator.

Tests copy only the reader folder and `schemas/` into a scratch folder and spawn the
reader there. It must read both maps and resolve the reciprocal portals. Each of the
104 inert edit records changes a temporary copy of the export bundle. JSON edits
re-encode the edited file as JCS, using the helper's own encoder, and re-hash it,
unless the record says otherwise, so each negative record isolates one defect. It
must then produce exactly its expected diagnostic code, file and JSON path. The
records cover:

- inventory: symlinks, FIFOs, empty directories, depth, unsafe or reserved names,
  case aliases (case-sensitive hosts only), nested archives, unlisted or missing files;
- manifest: tampering, order, duplicate keys, non-canonical bytes, unindexed or
  non-authored documents, schema mismatch;
- document bytes: malformed JSON, UTF-8, BOM, duplicate members, lone surrogates;
- document limits: out-of-range numbers and nesting deeper than 64 containers;
- negotiation: versions, formats, contracts, external maps, and contracts bound to
  the wrong role (collision contract, camera model, required feature, controller),
  including a duplicate required feature;
- closure: missing, duplicate or mismatched dependencies, unreachable documents,
  absent optional dependencies with two paths or aliasing another file;
- references: duplicates outside maps, dangling, wrong-kind, wrong-owner and
  out-of-closure references, catalog entries without params, movement-profile uses,
  profile refs that dangle in any map whose closure holds the profile, and terrain
  naming a tileset its map does not declare;
- asset paths: reserved, traversal, media mismatch, unbundled.

Ten positive records must still be accepted:

- a listed asset;
- the five pinned schemas in the F4 layout;
- a self portal;
- a third map with a transitive portal;
- an in-closure cross-map ref;
- a declared profile catalog use;
- reference-like parameter names;
- a map-scoped profile ref used from a map that does not declare the profile;
- terrain naming a directly declared tileset;
- a group-kind layer as a `group` target.

A test requires every diagnostic code the reader can emit to have a record, or one of
six named in-process tests for codes no bundle edit can produce: a non-directory
input, schema-directory defects, unclassified members and non-map dependency cycles.
On a case-insensitive host the case-alias record is reported as skipped. A differential
test runs the reader's parser and evaluator against `src/contracts` on every owned
conformance file and R1 example. The two must agree on byte acceptance and
closed-schema validity.

## `history/` (ML-008)

`cases.json` holds inert step scripts over R1's unchanged
`examples/forest/maps/forest.map.json`, pinned by SHA-256.
`tests/history-conformance.test.ts` interprets each step through `src/domain` and
`src/editor` and checks its expectations. After every step it also checks that
history bytes stay within the budget and equal the sum of the entries. The cases:

- `paint-10000-cell-delta`: one brush gesture over 100 pointer moves paints a
  100×100 rectangle across 16 signed chunks. It records one entry with exactly
  10,000 changed cells in at most 100,768 accounted bytes. Undo restores the saved
  bytes and a clean state, and redo makes the document dirty again.
- `undo-redo-no-op`: empty undo/redo, an unchanged set, a stroke painted and erased
  within one gesture, and a drag back to its start all record nothing.
- `one-gesture-one-entry`: eight drag moves make one entry. A cancelled brush
  gesture records nothing.
- `duplicate-ids`: duplicate top-level and nested IDs refuse to normalize. An
  insert with a taken ID is refused. Two pastes allocate `-2`, then `-3`, IDs and
  re-normalize cleanly.
- `saved-revision-conflict`: a save ticket whose base a later save replaced is
  refused. Dirty state follows the saved content identity through undo and redo.
- `memory-bound`: twenty 10,000-cell strokes under a 400,000-byte budget keep three
  entries. They drop 17 with visible notices, and the authored content keeps every
  stroke.
- `gesture-chunk-bound`: a gesture limited to four working chunks refuses a fifth.

## `library/` (ML-009)

`cases.json` holds inert step scripts for adopted I2's asset/storage group (R1 I2
group A): two-map library reopen, stale `baseDigest` conflict, torn save, backup
before replacement, wrong Host/Origin requests and placeholder write refusal.
`tests/library-conformance.test.ts` runs each case against the real library plugin
on a Vite dev server, over a fresh copy of `placeholder-library/`. The index pins
every base file by SHA-256, and the test checks that the base is a byte-identical
copy of R1's `examples/forest`. Saves rename maps from the content as opened, with
the file digests as opened; refused steps must leave every library byte unchanged.

## `visuals/` (ML-015)

`index.json` pins original owned PNG/WebP/SVG and hostile/cyclic/oversized bytes.
`scene-cases.json` pins primitive geometry, parent/pivot affine, negative repeat
and parallax vectors. Unit probes independently assert these exact results and
parser/cache/filesystem boundaries. Chromium/WebKit tests read real pixels,
refuse unsafe imports without source/DOM/network mutation, exercise ordered
frames and offscreen culling, abort reads on close, decode tile assets, and save
then reopen valid parent-frame content. Final saved bytes are also checked by a
separate archived Python consumer, without editor/runtime imports. ML-016's
bundle/export work is not implemented here.
