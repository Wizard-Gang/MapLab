# Contributing

Read `AGENTS.md`, the active queue, and relevant authorities. Use Node 26.10.0 and
npm 12.1.0. Install with `npm ci`; run `npm run check`. Do not edit generated lock
entries by hand, introduce floating pins, enable dependency lifecycle scripts, or
upgrade dependencies opportunistically. An allowlist change requires a scoped
security rationale and compatibility evidence.

After the empty-repository ML-001 root commit, use a branch for one controlled
task, a scoped draft PR while work is incomplete, and one reviewed squash commit.
Title syntax and required evidence are in
[change management](docs/CHANGE-MANAGEMENT.md). The permanent
[implementation plan](implementation_plan.md) contains the active task and every
queued task; the [full specification](docs/specifications/2026-10-16-maplab.md)
is design authority. At the next controlled activation after a confirmed protected
squash into the open release branch, retire only the delivered ID to historical records and
activate the chosen queued task. Any PR may add, edit, reorder or remove queued tasks;
a plan-only PR is titled `[PLAN] Imperative summary`. IDs are never reused.

Canonical checks run without credentials or external asset directories. Add tests
for meaningful invariants and failure cases. WebKit and Chromium tests run with
`npm run test:browser` after `npx playwright install chromium webkit`; they use a
scratch copy of `placeholder-library/` and never read `~/Documents/MapLab/`. Future format/physics changes need
consumer-impact and numerical fixture evidence. Browser interaction claims need
browser interaction tests. Do not describe proposed schemas, conformance or
performance targets as implemented or measured.

Run the separate online `npm run security` gate and authenticated
`npm run policy:check`/`npm run delivery:verify` before merging. See
[delivery gates](docs/DELIVERY-GATES.md). Recheck exact PR-head checks
after any edit or rebase; verify main
after squash before treating delivery as complete. Do not release or deploy as a
side effect. Public visibility and final license approval precede public release.
