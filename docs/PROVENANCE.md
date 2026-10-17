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
ML-003 parser fixtures and ML-004 geometry fixtures in `conformance/` are owned
CC0 data. Their indexes pin the source bytes and expected diagnostics. Future fixture files must
identify provenance and this dedication explicitly; third-party data retains its original terms and must
never be represented as owned CC0 material.

npm dependencies retain their own package licenses and integrity metadata in the
lockfile. They are installed tooling/runtime dependencies, not copied source.
Action revisions are pinned in CI. Review licensing and registry/security evidence
in the scoped dependency/security task before public release.
