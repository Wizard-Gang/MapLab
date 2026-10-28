# Preliminary production editor measurements

These are profiling samples from native Chrome on the owner-approved Apple M4 / 24 GB Mac.
They are **not passing ML-048 acceptance evidence**. The producer reports a dirty checkout;
the hierarchy repair, saturated-history probe and native-input collector were added afterward.
Safari and final native-input samples remain absent. Raw frame intervals and operation samples
are retained for comparison, along with macOS physical-footprint snapshots including Chrome's
renderer, browser and GPU/service processes. Browser baseline and loaded/pressure snapshots
are distinct files. The pressure probe in this batch used drawn Canvas2D surfaces; the current
probe uses the production inspected SVG decoder and must be rerun.

The original complete-editor batch measured five ten-second camera sweeps at 1440×900 CSS
pixels and DPR 2. Inspector/search/history timings in that batch include both an operation and
its reset; the current producer records resets outside each sample and separates undo/redo.
Do not compare those combined timings directly with the per-operation acceptance thresholds.
The full hierarchy retained every row even inside collapsed groups; the current hierarchy
mounts only open groups and offers bounded pages without dropping source IDs.

The measurement entry is a production build at `benchmarks/editor.html`. Its separate loopback
server is `scripts/benchmark-server.mjs`; it exposes owned read-only fixture documents and a
local measurement sink, never library save operations. Local test runners remain prohibited.
Before final measurements, rebuild, close earlier diagnostic windows, and start a fresh server
so its browser baseline excludes any loaded editor. Keep the measured browser in the foreground.
