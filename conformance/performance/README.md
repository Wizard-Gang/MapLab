# Owned performance workloads

Original MapLab CC0-1.0 numeric recipes. `cases.json` and `LICENSE.json` have SHA-256 entries in `index.json`.
`src/benchmarks/fixture.ts` materializes ordinary source maps from the owned `conformance/surface/flat.map.json` template.
The standard recipe has exactly 100,000 occupied cells, 20 layers, 5,000 visuals, 5,000 collision bodies and 10,000 footholds.
Cells span 5,000 columns; objects/supports are distributed over multiple levels. Dense stress deliberately overlaps 10,000 supports and 5,000 bodies.
The consumer process independently validates generated source bytes against the published map schema and counts every record.

The scripted Chromium/WebKit runner is `tests/browser/performance.spec.ts`, using `/benchmarks/` at 1440×900 CSS pixels, DPR 2.
It discards a warm-up, records five ten-second camera sweeps, and retains every frame interval and observed long task.
Other operations retain five warm measurements plus p50/p95 (nearest rank: median and maximum for five samples).
Navigation uses actual module workers; the dense cancel probe times cancel-message processing plus a queued event-loop ping.
The worker is terminated after each probe, including a 20-second timeout. Graph baselines use a declared 4,096-sample budget, not a full-graph claim.

CI prints summaries and uploads `performance-<browser>-<shard>` JSON artifacts, including exact source head, controller digest, CPU/RAM/OS,
browser version, Node version, build mode, raw timing arrays and heap snapshots. These are benchmark data, not delivery ledgers.
Use the full `verify.yml` workflow on the exact branch head; owner rules prohibit agents running the test runner locally.

## Measurement boundaries

CI uses pinned Playwright browser builds on Linux with unverified acceleration and Vite development modules.
It does not establish the Apple M1/16 GiB stable Chromium or Safari hardware baseline.
WebKit is fallback correctness coverage; it is not a Safari performance measurement.
Input timing measures synchronous tool preparation, not end-to-end pointer-to-present latency.
Heap snapshots omit browser/GPU memory. The history byte counter is separately checked against its budget.
The synthetic cost query checks only graph search, excluding witness generation and replay.
The camera workload uses the real CanvasViewport with all overlays, not the full React inspector UI.
Validated 10 MiB plugin saves and cancellable 100 MiB worker exports need their own workload.
Unmet or unmeasured H5/E8 gates must remain explicit scope splits; a passing benchmark test makes no blanket H5 claim.
