# Contributing

Read `AGENTS.md`, the active queue, and relevant authorities. Use Node 26.10.0 and
npm 12.1.0. Install with `npm ci`; run `npm run check`. Do not edit generated lock
entries by hand, introduce floating pins, enable dependency lifecycle scripts, or
upgrade dependencies opportunistically. An allowlist change requires a scoped
security rationale and compatibility evidence.

After the empty-repository ML-001 root commit, use a branch for one controlled
task, a scoped draft PR while work is incomplete, and one reviewed squash commit.
Title syntax and required evidence are in
[change management](docs/CHANGE-MANAGEMENT.md). Update the active queue, roadmap,
and change record with the delivery. Split oversized work through a separately
reviewed roadmap adjustment before implementation; do not reuse task IDs.

Canonical checks run without credentials or external asset directories. Add tests
for meaningful invariants and failure cases. Future format/physics changes need
consumer-impact and numerical fixture evidence. Browser interaction claims need
browser interaction tests. Do not describe proposed schemas, conformance or
performance targets as implemented or measured.

Run the separate online `npm run security` gate and authenticated
`npm run policy:check`/`npm run delivery:verify` before merging. See
[delivery gates](docs/DELIVERY-GATES.md). Record
exact PR-head check evidence and recheck after any edit or rebase; verify main
after squash before treating delivery as complete. Do not release or deploy as a
side effect. Public visibility and final license approval precede public release.
