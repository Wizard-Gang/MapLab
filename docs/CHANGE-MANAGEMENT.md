# Change management

Use one controlled `ML-###` task, one branch, one scoped PR, and one squash commit
per delivery after bootstrap. Title form:
`[ML-###] [FEATURE|FIX|DOCS|CHORE|REFACTOR|TEST|SECURITY] Imperative summary`.
IDs never get reused. The permanent active queue holds one executable task; the
roadmap reserves future tasks. Adjust oversized scope through reviewed roadmap
changes before implementation. Unrelated cleanup/upgrades are excluded.

PR records contain Change, Reason, Impact, Risk, Controls, Validation, Evidence,
Source, and Release. Evidence scales to risk. Format/physics work needs fixtures
and independent consumer impact; documentation needs relevant contract/link checks.
Record exact tested head SHA. Edits/rebases invalidate prior evidence. Desired live
policy requires strict current-with-main `verify`, `change-id`, and `security` checks
on that SHA, no bypass actors, and protected deletion/non-fast-forward main.
Verify resulting main after squash; completed branches delete after success.

ML-001's only exception: an authenticated organization-admin inventory confirms
`Wizard-Gang/MapLab` genuinely absent, then it is created privately and confirmed
empty with no starting SHA. Run clean checks before an initial root commit on main.
Record its hash and push-triggered CI externally. No base exists for a PR. This
exception never applies to existing contents or any subsequent commit. ML-002
closes bootstrap by applying and reading back live protections. The root exception is historical and closed to all current validation. No setting
in `config/github-repository-settings.json` is enforcement evidence; capture
authenticated [policy read-back](DELIVERY-GATES.md) before merging.

Canonical `npm run check` is credential-free: runtime/package/lock/policy/authority/
queue identity checks, typecheck, tests, production build, then built-asset smoke.
Deliberately malformed fixtures must fail. Initial CI runs this same path. ML-002
adds dedicated online dependency/security and change-ID gates and provider proof.
Ordinary changes do not release, deploy or change repository visibility.
