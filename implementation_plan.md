# Permanent implementation plan

This file remains the active controlled queue. IDs are permanent and reserved in
[the roadmap](docs/IMPLEMENTATION-ROADMAP.md). Completed records stay in Git history
and `docs/changes/`. Only one task may be active.

<!-- active-queue:start -->
- **ML-001** — Governed repository, pinned toolchain, static planning shell.
<!-- active-queue:end -->

ML-001 implementation and local validation are recorded in
[its change record](docs/changes/ML-001.md). The initial root commit and push CI
must be identified by their exact SHA in the delivery report; a commit cannot
contain its own final hash. ML-001 remains the sole queue entry for this bootstrap
delivery. The owner may activate **ML-002** in the next controlled change, after
verifying the bootstrap evidence. It is reserved and has not started.

ML-001 acceptance: confirmed repository identity and genuinely empty state;
private bootstrap; governing documents and full reserved roadmap; exact package
and toolchain pins; static React/Vite shell; genuine rejecting foundation checks;
clean install/typecheck/tests/build/smoke; exact-head push CI evidence. No map
features, schema implementation, live settings application, release, or deployment.
