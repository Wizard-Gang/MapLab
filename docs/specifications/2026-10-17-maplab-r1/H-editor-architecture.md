# H. Editor technical architecture

React 19 + TypeScript 7 + Vite 8, pinned exactly as in ML-001. No native toolchains, and the
repository contract should reject Rust, Cargo and Tauri as RigLab's does. Canvas 2D handles the
world, React/DOM the controls, workers the heavy jobs, and a loopback Node plugin the library writes.

## H1. Source modules and dependency direction

```text
schemas/                 published closed JSON Schemas (one per format version)
conformance/             fixtures: maps, profiles, input traces, expected traces/outcomes (I2)
placeholder-library/     read-only library used by tests/CI; holds the forest example (F5)
scripts/dev.mjs          npm start launcher (H10); check/contract scripts
src/contracts/           parse (bounded, duplicate-key-rejecting), schema + semantic validation, canonical JSON
src/geometry/            integer su math, exact floorDiv, segments, shapes, spatial grid
src/physics-reference/   maplab.reference-controller v1 (RC4): pure, no editor/React imports
src/navigation/          intervals, candidates, witnesses, search, flight/swim planners
src/domain/              normalized document model, commands, remapping, migrations
src/editor/              per-document session, tools, selection, history, inspectors' view-models
src/render/              Canvas 2D passes, chunk caches, picking, one world↔CSS transform
src/library/             client API + Vite plugin (loopback endpoint, writer, watcher, assets)
src/export/              closure, JCS bytes, manifest, STORE ZIP
src/integration/riglab/  isolated RigLab bundle validation + baked presentation reader
src/test-mode/           snapshot session, input record/replay, debug actor, event injection
src/workers/             job protocol (nav, validation, export hashing)
src/app/                 React shell, panels, menus, diagnostics
tests/consumer/          independent importer; may not import src/editor|app|render|library
```

**Dependency rules.**

- `contracts`, `geometry`, `physics-reference`, `navigation` and `export` import no React, DOM,
  editor, library or app code.
- `physics-reference` imports only `geometry` and contract types.
- Nothing imports RigLab or Hexframe source.

A `check:boundaries` script, part of `npm run check`, fails on violations.

## H2. State ownership

| Store | Owns | Notes |
|---|---|---|
| **Document** (one per open document) | Normalized authored model (records by ID plus ordered ID lists), `revision`, `savedDigest`, `baseDigest` (on disk when opened), command history | The only thing Save serializes |
| **Session** | Mode, tool, selection, hover, snap, camera/view, overlay toggles, active profile, drag preview | Never in history. Panel layout lives in guarded browser storage |
| **Derived** | Validation index, spatial grid, render chunk caches, resolved anchors, nav graphs keyed by `(revision, profileDigest, controller, settings)` | Rebuildable. LRU budgets |
| **Test** | Frozen document snapshot, controller state, input recorder | Starting or stopping Test never touches history. An edit while testing restarts from a new snapshot |
| **Library** | Project index, document list and digests, watcher events, draft journal | Mirrors disk; disk is authority |

React reads the stores through `useSyncExternalStore` selectors. Large models never live in React
component state. Commands are plain data dispatched to a pure reducer, the RigLab pattern (B1).

## H3. Commands and history (*adopted §H2*, Kept, with R1 detail)

- **Commands**: `PaintCells`, `MoveObjects`, `SetProperties`, `AddObjects`, `DeleteObjects`,
  `SplitFoothold`, `JoinFootholds`, `WeldEndpoints`, `RetargetReference`, `ResizeBounds`,
  `PasteRemapped`, `PlacePrefab`, `ImportAsset`.
  - Each stores intent plus a compact inverse.
  - Reference rewrites are inside the same command.
- **Gestures**: one pointer gesture is one command. Escape or pointer-cancel commits nothing
  (RigLab drag pattern). A no-op records nothing.
- **Paint**: per-chunk deltas of changed cell indices with before/after packed values
  (`Uint32Array` in memory). A 10,000-cell stroke stores at most 10,000 pairs, never a map
  snapshot.
- **Budget**: 64 MiB per document. Over budget, the oldest entries drop with a visible notice, and
  authored data is never dropped.
- **Dirty** means `digest(model) ≠ savedDigest`, so undoing back to the saved state is clean.
  Revert restores saved content with a fresh history.

## H4. Library storage and assets (Changed: RigLab pattern)

**Resolution**:

1. `MAPLAB_LIBRARY`
2. `~/Documents/MapLab/`, if it holds `maplab.project.json`
3. `placeholder-library/` (read-only)

**Layout**:

```text
maplab.project.json            index with per-document sha256, written LAST (commit point)
maps/<map-id>.map.json         movement/<id>.movement.json   catalogs/<id>.catalog.json
tilesets/<id>.tileset.json     prefabs/<id>.prefab.json      palettes/<id>.palette.json
assets/<sha12>/<name>.<ext>    sanitized imported copies; originals are never modified
presentations/<id>/…           verbatim validated RigLab bundles
exports/<bundle-sha12>/ (+ .zip)
backups/<UTC-stamp>/…          previous bytes of every replaced/removed file
.maplab/cache/                 derived caches (deletable)
```

**Endpoints** (dev server only, under `/__maplab/…`):

- Each accepts only a loopback `Host`, `Origin == http://<Host>`, same-origin `Sec-Fetch-Site`
  when sent, and a JSON content type. Bodies are bounded at 64 MiB per document and 128 MiB per
  save.
- The host check lives in the plugin itself, because the framework's host check runs too late
  (B1, A8).
- The placeholder library refuses writes.

**Save algorithm**:

1. Re-read the project index and the affected files.
2. Refuse any file whose current digest is not the client's `baseDigest` (stale overwrite), and
   return the conflict.
3. Validate the merged library result, including references across documents.
4. Copy the files about to be replaced into `backups/<stamp>/`.
5. For each file, write a temp file, `fsync`, then rename.
6. Write `maplab.project.json` the same way, **last**.
7. Delete removed files.
8. Emit `maplab:library-saved {saveId, paths}`. The watcher ignores the writer's own paths for a
   short window, using RigLab's `RecentWrites`.

**Recovery.** On load, a document whose digest does not match the index means the previous save
was torn. MapLab offers "keep file" or "restore from the newest backup" and never guesses.
Unsaved edits are journaled to IndexedDB as drafts only (C2).

**Assets**:

- **Raster**: PNG and WebP, decoded with limits. **SVG**: a strict allowlist parse, then
  re-serialization of only the allowed elements and attributes.
  - Kept: shapes, `g`, `path`, gradients with internal `#` references, `clipPath`.
  - Removed: DOCTYPE and entities, `script`, `style` with imports or URLs, `foreignObject`,
    `image`, external `href`, event attributes, `url()` except `#fragment`.
- Accepted copies go to `assets/` with a SHA-256 name. SVG renders only through image decoding,
  never as DOM (A8).
- The limits table is *adopted §H4*, **Kept**: raster 16 MiB / 4096 px / 16 MP; SVG 2 MiB /
  20,000 nodes / 200,000 path commands; containers 512 MiB / 20,000 files; path rules.

## H5. Rendering

- **Two stacked canvases**:
  - Art: backgrounds, tile chunk bitmaps, sprites in paint order, actor-plane slots (filled in
    Test).
  - Overlay: footholds with normals and IDs, bodies, traversal, navigation, regions, camera,
    handles.
  - Each canvas redraws only when its dirty flags are set (one `requestAnimationFrame` per change).
- **Tile chunks** are pre-rendered per (layer, chunk, zoom bucket) to `ImageBitmap` and
  invalidated by paint deltas. Only visible chunks are drawn.
- **SVG assets** are rasterized at zoom buckets (0.5×, 1×, 2×, 4×), with an LRU decoded-image
  budget of 256 MiB.
- **One transform module** serves render, picking, snapping and handle sizing. Picking runs in
  reverse paint order over the spatial grid, with mode filters.
- **WebGL** is deferred until the ML-041 benchmarks fail. Render commands stay backend-neutral.

## H6. Workers and validation

- Navigation generation, full validation and export hashing/zipping run in workers.
- **Job messages**: `{jobId, docRevision, profileDigest, settings, snapshot}`, with transferable
  typed arrays. Workers send progress at least every 250 ms and honor cancel within 100 ms. Results
  for a superseded revision are dropped.
- Commands validate the affected objects synchronously, under 16 ms. The full pass runs in the
  worker after an idle debounce.
- Diagnostics (F3) feed the Diagnostics panel, the inspector badges and the export gate.

## H7. Performance targets (*adopted §H5*, Kept, plus R1)

| Operation | Target |
|---|---|
| Warm zoom/pan, standard fixture (100k cells, 20 layers, 5k objects, 10k footholds) | p95 frame ≤ 16.7 ms on Chromium. **Safari must stay usable, p95 ≤ 33 ms, measured** |
| Brush/drag input → preview | p95 ≤ 50 ms. No whole-document clone per event |
| 10,000-cell paint undo/redo | p95 ≤ 100 ms within budget |
| Select / search 5,000 objects | ≤ 50 ms / ≤ 100 ms |
| Save 10 MiB of changed documents through the plugin | ≤ 2 s, UI responsive |
| Export 100 MiB bundle in a worker | ≤ 10 s, cancellable |
| Navigation | E8 table |
| Memory, standard fixture | ≤ 512 MiB editor working set with LRU budgets |

The baseline machine (owner ruling, 2026-10-27) is Apple M4, 24 GB, Chromium stable, DPR 2, 1440×900, reporting p50
and p95 over 5 warm runs. Safari is measured on the same machine.

## H8. Dev launcher and local operations (Added)

- **`npm start`** runs `node scripts/dev.mjs`: tear down any MapLab dev server on the port, then
  reset, install (`npm ci`), build, start and open the browser (RigLab RL-029 pattern).
  - `MAPLAB_PORT` defaults to **5182** (RigLab uses 5180).
  - `MAPLAB_NO_OPEN=1` suppresses opening the browser.
  - `MAPLAB_LIBRARY` selects the folder.
- **Agents working in worktrees** must use another port and a scratch copy of the library, so they
  never stop the owner's server or write his folder (the RigLab lesson).
- **`npm run check`** is credential-free and always uses `placeholder-library/`.
  **`npm run check:library [dir]`** validates a real folder.
- The plugin restarts the dev server when its own code changes, so merges never need an owner
  restart (RigLab RL-035).
