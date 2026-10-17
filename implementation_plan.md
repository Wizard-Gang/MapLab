# Permanent implementation plan

This file is the active controlled queue. IDs are permanent and reserved in
[the roadmap](docs/IMPLEMENTATION-ROADMAP.md). Only one task may be active.

<!-- active-queue:start -->
- **ML-002** — CI/change/security gates and live repository/tag/release protections.
<!-- active-queue:end -->

ML-001 was delivered at `b0b1ff57859371be5aef7071394cb50c405d4794` and its
[main push CI](https://github.com/Wizard-Gang/MapLab/actions/runs/38990031757)
passed. The historical root exception is closed: no subsequent task can use it.
[Completed delivery evidence](docs/deliveries.json) is append-only during the next
controlled activation, after the preceding squash and resulting main CI pass.
The delivery ledger outside Git records the current delivery's final hash.

ML-002 scope and acceptance: [change record](docs/changes/ML-002.md) and
[gate operation](docs/DELIVERY-GATES.md). Activate ML-003 only after protected
ML-002 squash delivery and successful resulting main CI. ML-003–044 stay reserved.
