# B. RigLab, Hexframe and MapLab-repo review

All paths are relative to the live commits in A1: RigLab `b7648cd9`, Hexframe `5b6e4f11`,
MapLab `main` `b0b1ff57` and the ML-002 PR head `0c0b1fe7`. The adopted spec's review (*adopted §B*)
was made against RigLab `87be4e64`. Its RigLab findings still hold, because RL-052 changed only art
paint order. R1 corrects one adopted decision (storage) and adds the items marked **R1**.

## B1. RigLab: reuse, adapt, replace

| RigLab source | Verified pattern | MapLab decision |
|---|---|---|
| `package.json` | Node `26.x` / npm `12.x` engines, `packageManager npm@12.1.0`. Exact React 19.3.0, TypeScript 7.0.2, Vite 8.3.1, Vitest 5.0.2. `check` chains repo contracts, typecheck, tests, a placeholder-mode build and the change check | **Already reused.** MapLab ML-001 pins the same versions with stricter exact engines (`26.10.0`/`12.1.0`) and denies lifecycle scripts |
| `scripts/dev.mjs`, `scripts/dev-lifecycle.mjs` | `npm start` tears down any RigLab Vite on the port, then resets, installs, builds, starts and opens. `RIGLAB_PORT` and `RIGLAB_NO_OPEN` let agent worktrees avoid the owner's server | **R1 adapt.** Same launcher as `MAPLAB_PORT` (default **5182**), `MAPLAB_NO_OPEN` and `MAPLAB_LIBRARY`. The owner expects port conflicts never to happen |
| `src/editor/state.ts`, `types.ts`, `core.ts` | A pure reducer. Model edits go through history; view, selection, mode and playback stay outside it. `revertState` restores the last saved model with a fresh history. Dirty means the present differs from the saved snapshot | **Adapt.** Use a normalized map model per open document and keep the same separation. Revert keeps the same semantics, comparing the saved **content digest** rather than object identity |
| `src/editor/history.ts` | Whole-model snapshots, limit 100. An unchanged value records nothing | **Replace the storage strategy** with command and inverse-delta history and chunk paint deltas (*adopted §H2*). Keep its API shape and the "no-op records nothing" rule |
| `src/editor/view.ts` | Zoom 0.25–16. `zoomAt` keeps the point under the cursor fixed. `panBy` moves the view. `snapToGrid` uses `Math.round` | **Adapt** into one world→CSS affine (D1). Replace `Math.round` (half rounds toward +∞) with the declared half-away-from-zero quantizer. Keep the zoom-at-cursor invariant as a test |
| `src/app/useCanvasDrags.ts` | Drag previews live in React state outside the model. Drop commits once. A non-finite point means cancel | **Reuse the pattern.** One gesture is one command, and Escape or pointer-cancel commits nothing |
| `src/viewer/RigCanvas.tsx`, `GridLines.tsx` | SVG DOM viewport. Minor grid lines are dropped when they would crowd the screen | **Replace** SVG with Canvas 2D for world content, since thousands of tiles cannot each be DOM nodes. Reuse the grid-crowding rule |
| `src/editor/shortcuts.ts`, `src/app/useShortcuts.ts` | Mod+S/Z/Shift+Z/Y, Delete, Escape. Keys typed into a field stay with the field | **Reuse** and extend with mode and tool keys (C5) |
| `src/editor/panels.ts` | Panel collapse state lives in guarded browser storage, never in the model | **Reuse** for per-viewer conveniences only |
| `src/format/validate.ts` | `Issues` collects path-named errors. `closedObject` enforces required and optional keys. Name regex | **Reuse the style** for semantic validators. **Add** published JSON Schema 2020-12 files, which RigLab does not ship (*adopted §F1*) |
| `src/library/folder.ts`, `config.ts`, `load.ts`, `plugin.ts`, `scripts/library-plugin.mjs` | Folder resolution: env var, else `~/Documents/RigLab` when it has `config.txt`, else `placeholder-library/`. Reads only mapped files, refuses symlink escapes and files over 2 MiB, and serves a validated virtual module. The dev server restarts itself when plugin code changes | **R1 adopt** as MapLab's library (H4): `MAPLAB_LIBRARY`, then `~/Documents/MapLab/` with `maplab.project.json`, then `placeholder-library/`. *Adopted §H4 rejected this middleware.* R1 reverses that, with evidence in A8 and K1 |
| `src/library/endpoint.ts`, `save.ts`, `write.ts` | `POST /__riglab/library` accepts only loopback Host, `Origin == http://<Host>`, same-origin `Sec-Fetch-Site`, JSON, and at most 2 MiB. It re-reads the folder, plans, validates, then writes temp-then-rename with `config.txt` last, copies replaced files to `backups/<UTC stamp>/`, and remembers its own writes so the watcher ignores them | **R1 adopt**, adding: a per-file base digest for stale-overwrite refusal, a JSON byte cap raised for maps (H4), and `maplab.project.json` written last as the commit point |
| `src/export/bundle.ts`, `zip.ts` | The manifest pins each file by SHA-256 (WebCrypto) and lists the rig, animations, held weapons and optional baked files. JSON is pretty-printed with a trailing newline. The ZIP is STORE with a fixed 1980 DOS date and UTF-8 names | **Adapt.** MapLab exports JCS bytes with a dependency-closed inventory (*adopted §F5*). Reuse the deterministic STORE writer approach, re-implemented under MapLab's MIT license |
| `tests/export/written.ts`, `tests/acceptance/*`, `placeholder-library/` | Export tests re-read what was written: every file is listed and every hash matches. Acceptance runs drive the real reducer. Tests always use the placeholder library | **Reuse all three patterns.** MapLab's `placeholder-library/` holds the forest fixtures (F6) |
| `src/hexframe/parts.ts` | A strict part-SVG parser accepts only a root plus `<path class d/>`, treats art as data, never injects markup, and refuses `url()` | **Adapt the principle** for map art. MapLab needs a wider allowlist (H4) but the same parse-as-data rule, rendered only through image decoding (A8) |
| `AGENTS.md`, `docs/CHANGE-MANAGEMENT.md`, `config/github-repository-settings.json`, verify/apply scripts, CI `verify`/`change-id`/`security` | Controlled IDs, a one-commit PR whose body equals the commit, squash-only, strict required checks, no-bypass rulesets, immutable tags and releases | **Already adopted** independently by MapLab ML-001/ML-002 under `ML-###` |
| `src/solve/*`, `vendor/hexframe/*`, `src/editor/{rigEdits,poseEdits,weaponEdits}.ts`, `src/hexframe/*` | IK, posing, weapons and the vendored rig engine | **Exclude.** MapLab never imports or vendors them. Presentation reads only validated *baked* exports (G3) |

## B2. RigLab export contract as consumed by MapLab

Verified in `src/export/bundle.ts`, `src/export/bake.ts` and `src/format/*` at `b7648cd9`:

- **Bundle root** `riglab-export/`. `manifest.json` is `{format:"riglab.export", version:1, generator,
  rig:{name,file,sha256}, animations:[{name,file,sha256}], weapons?:[...], baked?:[{animation,file,sha256}]}`.
- **Files**: `<rig>.rig.json`, `animations/<name>.anim.json`, `weapons/<name>.weapon.json` and
  `baked/<name>.baked.json`. Every name comes from a validated RigLab name.
- **`riglab.baked` v1**: `{rig, animation, fps:60, loop, bones[], frames[][[x,y,rotationDeg]], weapons?}`,
  one frame per Hexframe tick (`length` frames when looping, `length+1` otherwise), in rig space,
  rounded to 1e-6.
- **Rig space**: SVG units, x right, y down, rotation clockwise. The chibi's feet at y=0 are a
  fixture convention, not a format invariant.
- **Animation grid**: `riglab.anim` v3 is named `<class>-<kind>`. Kinds are `idle` (60 frames,
  loops), `walk` (48, loops), `jump` (36), `attack` (24) and `hit` (24). Classes are `unarmed`
  plus library weapons.
- **What is not exported**: skins, palettes, part SVGs and holds. A map that wants RigLab art must
  import those separately and bind them (G3).
- **Mirroring**: the rig's depth profiles carry separate `facingRight`/`facingLeft` side maps.
  A left-facing actor uses the left map for paint order, not just a mirrored transform.

## B3. Hexframe boundary

Hexframe is a fixed 60 Hz, integer, **Y-up** two-fighter arena (`GROUND_Y = 0`, `SCALE = 100`
sim units per pixel, fixed stage width). It has no map, foothold or navigation concepts. Its
`src/rig/*` clip sampler reaches MapLab only indirectly, through RigLab's baked output.

What MapLab takes from it is principle, not code:

- integer fixed-step simulation (A6),
- a combat authority that presentation never feeds back into,
- one engine clock shared with animation.

A future Hexframe-derived game engine consuming MapLab maps needs a **Y-flip adapter** at the
import boundary, covering positions, velocities, normals and one-sided winding (G4). MapLab never
depends on Hexframe at runtime.

## B4. MapLab repository state that affects this revision

- **ML-001** (root commit `b0b1ff57`) committed the adopted spec, a 44-ID roadmap (ML-001…ML-044),
  pinned toolchain and a static shell.
- **ML-002** (draft PR #1) adds `scripts/check-queue.mjs`, which:
  - reads the J2 table of `docs/specifications/2026-10-16-maplab.md`,
  - requires **exactly 44** rows,
  - requires every live queue entry's scope, non-goals and acceptance to equal its J2 row
    **verbatim**,
  - allows only `ML-(completed+1)` as the active task.

  The PR's plan text also forbids renumbering, skipping or silently deleting future IDs.
- **Consequence:** any change to J2 row text (R1 changes ML-009 and ML-042) or to the reserved ID
  count requires a governed spec revision. As designed, the checker has no path for one: a new ID
  cannot run before ML-003. J5 proposes two lawful adoption paths and recommends one. This is the
  only R1 item that touches ML-002.
- **ML-002 is blocked only on rulesets.** The repo is now public, so rulesets are available on the
  free plan. Per [`docs/DELIVERY-GATES.md` on the PR branch](https://github.com/Wizard-Gang/MapLab/blob/0c0b1fe7012528541a9e619456b3857d4370c8df/docs/DELIVERY-GATES.md),
  `npm run policy:apply` needs authenticated admin `gh`. The owner's local `gh`
  (`SouthernGentlemen`, repo admin) is the proven admin path in the sibling repos.
