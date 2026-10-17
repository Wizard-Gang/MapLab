# C. MapLab product specification

Status tags: **Kept** means the adopted spec's text stands (cited). **Changed** and **Added** are R1.

## C1. What MapLab is

MapLab is a local, browser-based authoring tool for **side-view platformer worlds**, run with
`npm start` like RigLab. It authors artwork layers, physical support and collision, traversal,
gameplay placements, camera intent and navigation intent. It previews movement and navigation with
a **named reference controller**. It then exports a verified, engine-independent bundle.

It is not:

- a game engine,
- an AI runtime,
- a combat or inventory simulator,
- a script host,
- an RTS-style unit-command editor.

The engine owns live gameplay. MapLab owns authored world data (*adopted §C*, **Kept**).

## C2. Library and document workflow (Changed)

The editor's single source of truth is a **library folder**, exactly as in RigLab.

- Resolution order:
  1. `MAPLAB_LIBRARY`,
  2. else `~/Documents/MapLab/` when it holds `maplab.project.json`,
  3. else the read-only `placeholder-library/` in the repo, used by tests and CI.
- The toolbar names the library home-relative, or says it is the placeholder.

| Command | Behavior |
|---|---|
| **New map** | Asks for map ID (stable, slug-safe), name, bounds, tile size and default movement profile. Creates an unsaved document; Save writes it |
| **Open** | Lists the library's maps, tilesets, prefabs, movement profiles and catalogs, with validation badges. Opening validates into a **staging** model first. An invalid document opens read-only with diagnostics and is never rewritten destructively |
| **Save** (⌘S) | Sends the changed documents, each with the **base digest** it was opened from, to the loopback library endpoint. The server re-reads the folder, refuses stale bases (an external edit since open), validates the merged result, backs up replaced files, writes temp-then-rename, and writes the project index last. The status line names the folder and the files changed |
| **Save As / Duplicate** | Creates a *new* document identity: a new map ID, remapped local IDs, and self-portals retargeted. Links to other maps are preserved |
| **Revert** | Only when dirty. Asks first, then restores the last saved content with a fresh history (RigLab RL-049 semantics) |
| **Recovery** | Unsaved edits are journaled to IndexedDB as **drafts**, labeled "Unsaved draft from <time>", never "saved". On reopen MapLab offers restore or discard. Safari may evict drafts (A8), and the UI says so |
| **External edits** | The watcher reloads a clean document. A dirty document gets a conflict banner: reload, or keep editing and resolve at Save |

Multiple maps can be open as tabs. Each has its own history, selection and view. Tilesets,
prefabs, movement profiles and catalogs open in the same shell with their own inspectors. The
**static build** (no dev server) is a read-only viewer with file import and export download. It
exists for review and is never the authoring path.

## C3. Layout (RigLab structure, adapted)

- **Toolbar**: mode switcher, file commands, undo/redo, snap/grid control, zoom, overlay menu, and
  the active movement profile.
- **Left panel**: layer tree, object hierarchy (per kind, searchable), asset browser.
- **Center**: viewport.
- **Right panel**: inspector for the selection, or the mode's next-step hint when nothing is
  selected.
- **Bottom drawer**: Diagnostics, Navigation, Test telemetry.
- **Status bar**: cursor world and tile coordinates, snap source, dirty state, library and
  messages.

Panels collapse to rails. Collapse state is per-viewer browser storage, never document data.

## C4. Modes

| Mode | Authoring | Inspection and outputs |
|---|---|---|
| **Terrain** | Tile brush, rectangle, line, flood fill and erase. Palettes. Deterministic autotile from terrain intent. Quarter-turn and mirror only where the tileset allows | Art-only badge: no tile edit ever changes collision. Preview of affected cells. One gesture is one undo |
| **Platforms** | Draw footholds point to point. Snap to grid, existing endpoints (weld) or onto a surface. Split and join. Toggle one-way or solid, drop permission and drop group. Assign material, conveyor and plane. Attach to a moving body | Arrows show IDs and normals. Weld dots at connected endpoints; open endpoints are marked as edges. Slope readout in degrees, plus walkable/steep per active profile |
| **Collision** | Rects, segments and simple polygons as bodies (walls, ceilings, solids, object colliders). Category and mask. Enabled state. **"Trace from tiles"** creates a reviewable draft transaction once; there is no live link | Solid faces, ownership, overlaps, the clearance heatmap for the active profile's body, and which body edges carry solid footholds |
| **Traversal** | Ladders and ropes (drag a vertical line; access points auto-placed at footholds and editable). Wall-climb and ledge permissions on faces. Grapple anchors. Portals and doors. Scripted links (catalog action). Swim and flight volumes | Entry and exit markers per access point. A "reachable by <profile>" badge. Dangling or blocked exits flagged |
| **Objects** | SVG and raster sprites, frame animations, groups, buildings, foreground props, prefab placement (expanded with provenance) | Pivot, art scale, owning body (if rigid), layer, and the paint-order position relative to the actor plane |
| **Gameplay** | Player starts, checkpoints, NPCs, enemy spawns (snap to a foothold surface), patrol routes and waypoints, home/leash/aggro/pursuit regions, encounters and waves, triggers (event, condition and action from the catalog), audio, camera and environment zones, quest markers, cutscene markers | Typed inspectors from catalog definitions. Unimplemented engine behavior shows **"configured, not simulated"**. Reference pickers only, never free-text IDs |
| **Navigation** | Pick profile(s). Generate, cancel and rebuild. Pick source and goal, or a patrol route. Author explicit links and overrides (forbid or penalize) | Graph overlay by edge kind, with route, witness trajectory and inputs. Status is always one of *verified, no route within budget, proven blocked (restricted case), unsupported, stale, cancelled* (*adopted §E1*) |
| **Test** | Spawn the debug actor (placeholder, or a baked RigLab presentation) from a start. Keyboard play. Pause, step one tick, reset, record and replay. Switch profile. Inject declared events (e.g. "boss cleared"), clearly labeled | Foot reference, current support ID, mode, velocity (su/tick and WU/s), contacts, resources, planned route and failure explanations. The controller identity badge reads `maplab.reference-controller v1 · engine parity: unverified` |
| **Export** | Pick entry maps and options (include derived navigation: off by default). Run preflight. Export as a folder and/or STORE ZIP | Dependency closure, required contracts, diagnostics (errors block), and a reproducibility report (same inputs, same digest) stored outside the bundle |

## C5. Shared tools and shortcuts

Select (click, marquee, Shift toggle, Alt-click cycles overlaps), move, duplicate, delete,
copy/paste, rename, hierarchy search, zoom-to-selection, fit bounds, resize map, and snap control
(grid size and origin per axis, endpoint snap, surface snap, art-pixel snap, free).

| Key | Action |
|---|---|
| ⌘N / ⌘O / ⌘S / ⇧⌘S | New, Open, Save, Save As |
| ⌘Z / ⇧⌘Z (⌘Y) | Undo / redo |
| ⌘C / ⌘V / ⌘D | Copy / paste / duplicate |
| Delete, Backspace | Delete, with a reference report |
| Escape | Cancel the gesture or clear the selection |
| Space-drag, wheel | Pan |
| ⌘-wheel, pinch | Zoom at cursor |
| 1–9 | Modes (Terrain … Export) |
| V | Select |
| B / R / L / F / E | Brush / rect / line / fill / erase (Terrain) |
| P | Foothold (Platforms) |
| X | Split at cursor (Platforms) |
| J | Join selection (Platforms) |
| G | Toggle grid |
| O | Overlay menu |
| T | Start or stop Test |
| ⌘. | Cancel a navigation job |

Keys typed into fields stay with the field (RigLab rule). All key bindings live in one table so a
later preference can remap them.

## C6. Viewport and overlays

Every overlay toggles independently: **Art** (per layer), **Footholds**, **Collision**,
**Traversal**, **Navigation**, **Spawns & routes**, **Regions & triggers**, **Camera**,
**Audio/env zones**, **Grid** and **Bounds**.

"Physics focus" dims art to about 30% instead of hiding it, so a platform's collision can be
inspected in context. An invisible art layer never disables collision (*adopted §C3*). Picking
honors mode filters: in Platforms mode clicks select footholds first, without hiding art. Handles
are CSS-sized. Geometry is world-sized.

The **camera preview** draws the effective view rectangle at a chosen focus point and zone
blending. Backgrounds can be scrubbed with a "camera at" handle to check parallax and repetition.

## C7. Core interactions

- **Foothold drawing.** Click to start, click to add vertices, Enter or double-click to finish.
  Each segment becomes a foothold with a new ID, welded to the previous one. Endpoints within the
  weld radius snap and weld to existing endpoints. Holding ⌥ suppresses welding. Drawing
  right-to-left is normalized to left-to-right; footholds must be x-monotone (D2). A vertical
  stroke creates a **wall body segment**, never a foothold.
- **Split / join.** Split keeps the ID on the left part and allocates a new ID on the right.
  References (anchors, connections, access points, routes) are re-resolved by x in the same
  transaction. Join keeps a chosen ID, only for collinear segments with identical properties.
- **Spawn and waypoint placement** snaps to a foothold surface anchor (`footholdId`, `u`). The
  inspector shows the geometric anchor and the resolved body pose for the active profile. Points in
  air are only allowed for flying archetypes.
- **Routes** show a per-leg reachability badge for the spawn's own profile: ✓ verified,
  ⚠ no route within budget, ⛔ unsupported.
- **Delete with references** lists dependents and offers cancel, retarget or explicit cascade.
  Nothing is silently dropped (*adopted §C1*).
- **Resize** changes bounds only. Out-of-bounds content keeps its coordinates and is reported.
  Moving content is a separate, previewed transform.
- **Copy/paste** uses a versioned clipboard document. Pasted IDs are new, internal references are
  remapped, and external references survive only when they resolve in the target.

## C8. Browser and accessibility support (Added)

- **Safari (WebKit) is a first-class target**, because the owner uses it. Chromium is the
  performance baseline. Firefox must open, edit and save.
- Real-browser end-to-end tests run on **WebKit and Chromium** (I3).
- The editor applies RigLab's WebKit lessons:
  - `user-select: none` outside fields,
  - canvas presses blur the focused field so it commits,
  - handles are named with `aria-label`, not SVG `<title>`.
- Keyboard access is required for: hierarchy navigation, numeric inspector editing, mode and tool
  switching, Test controls and every command in C5.
