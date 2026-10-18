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
