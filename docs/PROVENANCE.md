# Provenance and license boundaries

Original MapLab code/documentation uses the repository MIT license. The supplied
architecture text is preserved as user-provided planning material in
`docs/specifications/2026-10-16-maplab.md`; its external links are research references,
not vendored implementations or assets. No RigLab, Hexframe, community map code,
commercial art, or character library is copied or required.

Owned numeric fixture data, including numerical examples in the supplied design,
is separately dedicated under **CC0 1.0 Universal** to the extent the contributors
hold rights: https://creativecommons.org/publicdomain/zero/1.0/ . No executable
world fixtures shipped in ML-001. R1's `examples/` (adopted at ML-003) and the
ML-003 parser, ML-004 geometry ML-005 movement fixtures/digest vectors and ML-006 gameplay fixtures/mutation records and ML-007 bundle-reader mutation records and ML-008 history step scripts and ML-009 library storage step scripts and ML-010 viewport numerical/session fixtures in `conformance/`, and the `placeholder-library/` byte-identical copy of R1's forest example, are owned
CC0 data. Their indexes pin the source bytes and expected diagnostics. Future fixture files must
identify provenance and this dedication explicitly; third-party data retains its original terms and must
never be represented as owned CC0 material.

npm dependencies retain their own package licenses and integrity metadata in the
lockfile. ML-009 added `@playwright/test` (Apache-2.0) as a reviewed dev dependency;
the browsers it installs through `npx playwright install` keep their own terms and
are never committed. They are installed tooling/runtime dependencies, not copied source.
Action revisions are pinned in CI. Review licensing and registry/security evidence
in the scoped dependency/security task before public release.

## ML-011 selection and editing fixtures

`conformance/selection/cases.json` contains original CC0 numeric movement vectors
and interaction cases over the owned R1 forest primitives. `index.json` pins its
SHA-256. `tests/selection.test.ts` interprets the numeric expectations; real
Chromium/WebKit tests in `tests/browser/selection.spec.ts` exercise pointer,
keyboard, cancellation, references, clipboard, history and saved source bytes.
No third-party art, fixtures or implementation source was borrowed.

## ML-012 physical edit fixtures

`conformance/physical-edits/cases.json` is original owned CC0-1.0 data over the
owned R1 forest geometry, with a SHA-256 index. `tests/physical-edits.test.ts`
checks its flat, sloped and one-way split seams, exact topology and reference
remaps, negatives, history and separate-process final-byte consumer results.
`tests/browser/physical-edits.spec.ts` checks real Chromium/WebKit interactions.
No third-party assets or source were borrowed.

## ML-013 terrain painting fixtures

`conformance/terrain/cases.json` is original owned CC0-1.0 gesture data over the
owned R1 forest map and tileset, with a SHA-256 index. `tests/terrain.test.ts`
and `tests/terrain-properties.test.ts` replay its negative-chunk, bounded-fill,
cancellation, 10,000-cell history, art-only, forbidden-transform and seeded
replay cases, plus a separate-process final-byte consumer result.
`tests/browser/terrain.spec.ts` checks real Chromium/WebKit interactions.
No third-party assets or source were borrowed.

## ML-014 terrain rule fixtures

`conformance/terrain-rules/rules.tileset.json` and `cases.json` are original
owned CC0-1.0 data with a SHA-256 index: a two-terrain rule tileset and edit
scripts over the owned R1 forest map. Their golden resolved cells and FNV-1a 64
vectors were computed by an independent reference outside the repository,
archived with the ML-014 delivery evidence. `tests/terrain-rules.test.ts`,
`tests/terrain-rules-model.test.ts` and `tests/browser/terrain-rules.spec.ts`
check them. No third-party assets or source were borrowed.

## ML-015 visual and asset fixtures

`conformance/visuals/` is original owned CC0-1.0 material. `owned.png` is an
8×8 two-color RGBA pattern generated with Python stdlib PNG chunks/zlib.
`owned.webp` is an independent green/purple 8×8 Canvas pattern encoded by the
pinned Chromium browser. `owned.svg` is original literal geometry with an
internal gradient and clip, including a negative viewBox origin. The hostile
SVG, cyclic-reference SVG and oversized raster are deliberately invalid data.
`index.json` pins all fixture bytes and expected acceptance. Runtime-generated
budget probes test aggregate paths/nodes/reference expansion without storing
megabytes of repeated source. No borrowed art, scripts or external asset URLs.

## ML-016 export fixtures

`conformance/export/cases.json` and its SHA-256 index are original owned
CC0-1.0 export mutation recipes over the existing owned forest/clearing source
fixtures and ML-015 approved PNG. Tests generate final STORE archives rather
than checking in timestamped tool output. The independent Python ZIP/inventory
consumer and isolated ML-007 schema/reference reader use final files only.
No engine, controller or navigation execution is claimed. No borrowed assets.

## ML-017 reference contact fixtures

`conformance/contact/` contains original owned CC0-1.0 tiny maps, profiles and
run-length replay fixtures. Every file is pinned by `index.json`. Exact
intermediate states and contacts cover flat/run/brake, slopes and finite lift,
welds, snap, solid and segment walls, ceilings, thin-wall sweep, overlap,
tangency, clearance, source edge mapping, masks, traction/conveyor motion,
contact budget and rational/stable-ID tie ordering. No third-party geometry,
assets, physics implementation or engine source was borrowed.
