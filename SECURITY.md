# Security

Report suspected vulnerabilities privately through the repository owner's GitHub
profile or GitHub private vulnerability reporting when enabled. Do not put secrets
or exploitable private data in public issues. No service, credential storage, or
map/asset import surface exists in ML-001.

Dependency versions and registry integrity are locked. `.npmrc` denies dependency
lifecycle scripts; `config/lifecycle-scripts.json` records the empty allowlist.
Canonical checks are credential-free and offline after installation. CI uses
SHA-pinned Actions, read-only contents permission, and no deployment credentials.
ML-002 adds dedicated online vulnerability and registry signature/provenance
checks through `npm run security`. Any low-or-higher vulnerability or failed
verification blocks delivery. See [delivery gates](docs/DELIVERY-GATES.md).
Required-check enforcement additionally needs successful live policy read-back.

Future imports must be bounded, data-only, and closed. Validate duplicate keys,
versions, references, path aliases/traversal, archive inventories, hashes, image
budgets, and inert structural SVG allowlists before replacing active documents.
Never evaluate imported strings, execute scripts, fetch arbitrary asset URLs, or
let archives/helpers escape granted roots. Follow specification H4 and I3; these
requirements are planning authority, not existing importer functionality.

Desired repository settings do not establish live protections. ML-002 must read
provider state back and preserve exact-head evidence. Ordinary changes never
publish packages, release tags, or deployments.
