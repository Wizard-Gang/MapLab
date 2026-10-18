# Architecture authority

ML-001 adopts the supplied [16 October 2026 specification](specifications/2026-10-16-maplab.md)
as the planning baseline. Its original research status and pinned external source
claims remain historical; this adoption does not claim to re-audit those sources.
Future controlled changes must record deviations explicitly. Only the static
React/TypeScript/Vite shell exists today.

MapLab owns authored world data. Engines own live physics, AI, combat, progression,
and mutable state. RigLab is an optional validated presentation source; Hexframe
is not a runtime dependency. No third-party editor/engine code is copied here.

The planned world is orthogonal side-view, X-right/Y-down in world units. Artwork,
explicit foothold support geometry, and solid collision bodies are separate
authorities. Profile-dependent body stance must avoid slope penetration. Stable
source IDs and explicit anchors survive transformations and dependency export.
Advanced ability families belong in the initial versioned movement contracts;
unsupported solvers remain visible rather than silently approximated.

Planned dependency direction is UI → application/domain → pure contracts/math.
Contracts and independent consumers must never import the editor; `tests/consumer/reader/`
(ML-007) imports neither the editor nor `src/contracts`. Authored state,
ephemeral view state, derived navigation, and engine runtime state stay separate.
Edits use reversible deltas/checkpoints and one gesture per transaction; since ML-008
`src/domain/` holds the normalized model, pure transactions with exact inverses, stable
ID remapping and packed chunk paint deltas, and `src/editor/history.ts` and `gesture.ts`
hold per-document history, revision/dirty/saved state and gestures. Canvas 2D
handles bulk art/overlays; DOM handles controls; workers handle expensive validation
and navigation. Viewport math uses one world-to-CSS transform with DPR separated.

Navigation is capability-specific and rebuildable. Ground actions carry finite-body
witnesses and are replayed with the same named controller used by Test. Flight and
swim use free-space representations. Finite sampling may miss legal routes; budget,
unsupported, stale, conditional, and no-result states must remain honest. A future
engine rebuilds under its solver or reports fixture-qualified compatibility.

Since R1 (adopted at ML-003), storage is a library folder written through a
loopback-only dev-server plugin, the RigLab pattern; IndexedDB keeps unsaved drafts
only, and picker/OPFS adapters are optional later work. ML-009 implements it in
`src/library/`: the Node-only `plugin.ts`, `folder.ts` and `writer.ts` run on the dev
server, and the browser imports only `client.ts`, `drafts.ts` and pure helpers.
`src/editor/document.ts` and `src/app/store.ts` connect it to ML-008's history. Save writes authored data; export
creates dependency-closed deterministic consumer bytes. Closed data-only catalogs,
bounded inert assets, canonical domain ordering and hashes are required. No hosted
write authority or implicit gameplay server is part of the architecture.

Specification C–I and K, as amended in place by the
[R1 revision](specifications/2026-10-17-maplab-r1/README.md), remain the detailed
product/data/controller/validation authority. The [permanent implementation plan](../implementation_plan.md) exclusively controls current/future delivery order; the former roadmap file is only a pointer.
No performance target or conformance fixture is claimed to pass before its task.
