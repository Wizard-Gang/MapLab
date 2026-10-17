# MapLab repository instructions

Read this file, `implementation_plan.md`, `docs/CHANGE-MANAGEMENT.md`, and the
relevant architecture authorities before changing code. User instructions govern
task scope. This repository is independent of RigLab and Hexframe.

- Execute only the controlled task in the active queue. Reserve future work in
  `docs/IMPLEMENTATION-ROADMAP.md`; do not implement ahead of that queue. Research
  and review may run concurrently; product implementation follows the roadmap.
- Keep one `ML-###` task per branch, scoped PR, and squash commit after bootstrap.
  Use `[ML-###] [TYPE] Imperative summary` and the PR template. IDs are permanent.
- Use Node 26.10.0, npm 12.1.0, exact dependencies, and the committed lockfile.
  Dependency lifecycle scripts are denied; the explicit allowlist is empty.
- Run clean `npm ci` and `npm run check` before delivery. Record failures honestly.
  Canonical checks require no credentials, external libraries, or user assets.
- Preserve source/derived/runtime boundaries, closed data contracts, and qualified
  navigation claims. Follow the adopted specification for future implementation.
- Do not copy third-party code or assets. Record provenance and license terms.
- Ordinary tasks do not release, deploy, change visibility, or apply live settings.
  Those actions need their own authorized scope. ML-002 owns protection read-back.
- The ML-001 root exception is closed. Historical evidence remains in its change
  record and delivery chain. Every current change requires a scoped PR and squash.
- Run `npm run check:change` for controlled metadata and `npm run security` for the
  separate online audit/signature gates. Before merging run `npm run policy:check`
  and `npm run delivery:verify -- --pr NUMBER --head SHA`; never bypass a failure.

Product scope remains the active queue; no world feature exists before ML-003.
