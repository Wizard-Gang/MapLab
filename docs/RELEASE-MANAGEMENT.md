# Release management

`0.1.0` is unreleased. ML-001 creates no tag, release, package publication or
deployment. Ordinary task delivery is not release authorization. First source
release is reserved for ML-044 after security/performance/conformance acceptance.

A separately authorized version change must verify package version, exact commit,
canonical credential-free checks and separate online dependency/security gates.
Create an immutable annotated `v*` version tag and immutable release containing a
reproducible source archive, SHA256SUMS and provenance. Independently reproduce
archive bytes. Verify exact-head CI and resulting main before release. Never move
or replace published version tags/assets. Source archives and map export bundles
are distinct contracts and artifacts.

Desired tag/release immutability is recorded in settings JSON. ML-002 must apply and
read it back; it is not enforced by that file. Public visibility and final code
license approval are unresolved until a deliberate public-release decision. MIT is
the initial authorized code default; owned numeric fixtures use a separate CC0
dedication. No copied third-party code/assets are included in the foundation.

Static hosting, deployment target, credentials, and operational policies require
their own explicit task. The local authoring architecture requires no gameplay
service or cloud database.
