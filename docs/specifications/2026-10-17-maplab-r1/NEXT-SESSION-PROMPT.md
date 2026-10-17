# Next-session prompt: ML-003 with R1 (owner approved option A on 2026-10-17)

```text
do needful in Wizard-Gang/MapLab (checkout ~/Documents/GitHub/MapLab, on main). Deliver ML-003 only,
through a head-guarded squash merge and green post-merge main CI. End with a ≤25-line prompt for ML-004.

Facts the repo won't tell you:
- The owner approved architecture revision R1, option A: ML-003 adopts it. R1 lives in
  ~/Documents/MapLab-architecture/. Its README delta table, plus J-implementation-queue.md §J2 and
  §J4, define what ML-003 changes.
- The ML-003 PR is one squash commit with three parts:
  1. Activation: append ML-002 to docs/deliveries.json as {id ML-002, commit
     3e2709307c31ad15075d62d3a76e2557b860b943, pr 1, testedHeads
     [f122e730a8c9ce1e719566119549843499130367], mainCi run 39062228164}. Retire ML-002 into the
     plan's completed-history block, promote ML-003 to active, and write config/change.json and
     docs/changes/ML-003.md.
  2. Adoption: copy the R1 folder to docs/specifications/2026-10-17-maplab-r1/. Edit the adopted
     section bodies listed in its delta table and the ML-009 J2 row, keeping every heading, and
     mirror the ML-009 row verbatim in the plan.
  3. Implementation: ML-003 per R1 §J4. R1's examples/ are golden inputs.
- Rulesets are live. Run `npm run delivery:verify -- --pr N --head SHA` before merging. Never
  auto-merge, never bypass.
- Node 26.10.0 + npm 12.1.0 are at /private/tmp/node-v26.10.0-darwin-arm64/bin. macOS may purge
  /tmp: re-fetch the archive and check its SHA-256 against nodejs.org.
- MapLab never imports RigLab or Hexframe, and never touches ~/Documents/RigLab.
Stop on a red required gate or an owner-only question.
```
