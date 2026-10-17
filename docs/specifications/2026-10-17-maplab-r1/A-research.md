# A. Research findings

Revision **R1**, research date **16 October 2026** (America/New_York). This revision re-audits the
architecture already adopted in `Wizard-Gang/MapLab` as
[`docs/specifications/2026-10-16-maplab.md`](https://github.com/Wizard-Gang/MapLab/blob/b0b1ff57859371be5aef7071394cb50c405d4794/docs/specifications/2026-10-16-maplab.md)
(called **"adopted spec"** below, cited as *adopted §X*). The repository's own architecture page says
that adoption did not re-audit its sources. R1 does, and it records every place where the evidence
changes the design.

Evidence classes used throughout:

| Tag | Meaning |
|---|---|
| **Doc** | Current official documentation or standard, read live during this pass |
| **Src** | Source code read at a pinned commit |
| **Emu** | Community reverse-engineered MapleStory implementation. Evidence of that implementation only, never of Nexon's client |
| **Paper / Article** | Published research or a practitioner write-up. Shows the technique exists and has the stated tradeoffs |
| **Assumption** | A MapLab design choice that no source proves |

## A1. Live repository baseline

| Repository | Ref inspected (read-only fresh clone) | Notes |
|---|---|---|
| `Wizard-Gang/MapLab` | `main` = `b0b1ff57` (ML-001). PR #1 (ML-002) is a **draft**, head `0c0b1fe7`, checks green, merge state clean | The repo is now **public**. `GET /rulesets` returns **none**, so ML-002 stays blocked on rulesets. The local checkout `~/Documents/GitHub/MapLab` sits at `2110a2b`, 6 commits behind its remote branch |
| `Wizard-Gang/RigLab` | `main` = `b7648cd9` (RL-052) | The adopted spec pinned `87be4e64` (RL-051). Diff since then: art paint order (`src/hexframe/art.ts`), docs and plan only. **Export and format contracts are unchanged** |
| `Wizard-Gang/Hexframe` | `main` = `5b6e4f11` (HF-200, v0.10.0) | Same commit the adopted spec pinned |

## A2. Map editors

| Source | Verified (class) | MapLab consequence |
|---|---|---|
| [Tiled JSON map format](https://doc.mapeditor.org/en/stable/reference/json-map-format/) | Tile/object/image/group layers. Infinite maps are stored as chunks with possibly negative tile offsets. Per-layer parallax factors plus a map parallax origin. Object IDs come from an incrementing `nextobjectid`. Polygon points are relative to the object position. Rotation is clockwise degrees. **(Doc)** | Keep: sparse chunks, per-layer parallax with explicit origin, clockwise visual rotation. Replace: numeric per-map object IDs and the tileset-order-dependent GID scheme, with stable string IDs and explicit tileset references. Tiled has no platform-physics semantics, so it stays an import/export converter, never the runtime format |
| [LDtk unique identifiers](https://ldtk.io/docs/game-dev/json-overview/unique-identifiers/), [JSON 1.5.3](https://ldtk.io/json/), [overview](https://ldtk.io/docs/game-dev/json-overview/) | String UUID-style `iid` on every object is the recommended identity. Integer `uid` definitions are being phased out. The project file can omit layer content when levels are saved separately. Editor-internal values are documented as ignorable. **(Doc)** | Keep: string IDs as the identity, a definition/instance split (catalog vs entities), and separable documents. MapLab IDs are allocated once and never renamed. Derived convenience fields never appear in authored documents (derived data lives in `maplab.navigation`) |

## A3. Engines and physics libraries

| Source | Verified (class) | MapLab consequence |
|---|---|---|
| [Godot CharacterBody2D](https://docs.godotengine.org/en/stable/classes/class_characterbody2d.html) (docs now 4.7) | A floor is any surface within `floor_max_angle` (default 45°) of `up_direction`. `floor_snap_length` keeps the body attached on slopes. `floor_constant_speed` (default off) makes bodies faster downhill. `platform_on_leave` chooses whether leaving a moving platform adds its velocity. **(Doc)** | Walkability is per profile (max slope), not per segment. R1 stores the slope limit as an exact rational. Moving-platform departure policy is a profile/controller field |
| [Godot CollisionShape2D](https://docs.godotengine.org/en/stable/classes/class_collisionshape2d.html) | One-way collision has a direction vector and a pixel margin that helps fast bodies. **(Doc)** | One-way is a property of the support surface plus a crossing rule. MapLab defines the crossing rule exactly instead of using a margin |
| [Godot AStar2D](https://docs.godotengine.org/en/stable/classes/class_astar2d.html) | Directed connections (`bidirectional=false`), disabled points for temporary obstacles, per-point weight scales, overridable cost/estimate hooks. **(Doc)** | Proves the directed-graph-plus-disable pattern exists in a shipping engine. The engine-side runtime can rebuild MapLab graphs into such a structure |
| [Godot Parallax2D](https://docs.godotengine.org/en/stable/classes/class_parallax2d.html) | Scroll scale, repeat size, repeat count, autoscroll, scroll limits, follow-viewport. **(Doc)** | Matches MapLab background fields (factor, repeat period, autoscroll, phase). Limits map to camera bounds |
| [Unity PlatformEffector2D](https://docs.unity3d.com/6000.0/Documentation/Manual/2d-physics/effectors/platform-effector-2d-reference.html) (Unity 6) | One-way within a surface arc. Optional one-way *grouping* so a multi-collider body passes through as a unit. Separate side arc for side friction/bounce. **(Doc)** | MapLab bodies are single upright rects in v1, so grouping is moot. The drop-group concept (suppress a welded platform chain as a unit) covers the same need |
| [Box2D v3 collision](https://box2d.org/documentation/md_collision.html) | Chain segments are **one-sided**: the front face is on the right looking from the first vertex to the second, matching counter-clockwise polygons in Y-up. Ghost vertices prevent internal-edge snags. **(Doc)** | A Y-up engine adapter must **reverse vertex order** when it flips Y, or one-sided chains face the wrong way (see G4). Welded foothold connections are MapLab's ghost-vertex equivalent |

## A4. MapleStory-style map structure (community evidence only)

None of this is an official Nexon specification. Both projects are reverse-engineered, and
JourneyClient is AGPL-3.0, so MapLab may **describe** its behavior but must not copy its code.

| Source | Verified behavior (class) |
|---|---|
| [JourneyClient](https://github.com/SYJourney/JourneyClient) `Gameplay/Physics/Foothold.cpp`, `Footholdtree.cpp`, `Physics.cpp`, `Constants.h` | A foothold is a segment `x1,y1,x2,y2` with `prev`/`next` ids and a layer. A vertical segment is a *wall*, a flat one a *floor*, and slope is `dy/dx`. **The object's position is a point. Grounded, its `y` is the foothold's line height at its `x`.** It transfers to `next`/`prev` past the segment's x-range, or searches for a foothold below. Non-wall footholds are indexed by every integer x they cover. Walls block only when they are the `prev`/`next` (or one further) of the current foothold. A mob flag reverses at platform edges. Down-jump is allowed only when another foothold lies within 600 px below. Fixed timestep 8 ms. **(Emu)** |
| [HaCreator / Harepacker-resurrected](https://github.com/lastbattle/Harepacker-resurrected) `HaCreator/Wz/MapSaver.cs`, `MapEditor/Instance/Shapes/FootholdLine.cs`, `Rope.cs` | Foothold records carry `prev`, `next`, `cantThrough`, `forbidFallDown`, `piece`, `force`. The editor connects footholds by shared anchor points. Ladder/rope records carry `x`, `y1`, `y2`, `l` (ladder vs rope), `uf` (can climb out the top) and `page` (layer). Life records carry `fh`, `cy`, `rx0`/`rx1` (patrol range), `mobTime` (respawn). Portals carry name, type, target map and target portal name, trigger ranges, `delay` and `onlyOnce`. Backgrounds carry `rx`/`ry` (parallax), `cx`/`cy` (tiling period), a type, alpha and a front flag. **(Emu)** |

**Generalization R1 keeps.** Footholds are first-class identities with explicit endpoint connections,
plus a separate climb geometry with an explicit "exit over the top" flag. Spawns are tied to footholds
with patrol intervals. Portals carry explicit name-based targets. Backgrounds expose parallax and
tiling period. Actor depth follows the plane of the actor's support (JourneyClient copies the
foothold's layer into the actor only while grounded).

**R1 deliberately does not carry forward** integer foothold ids, per-x tables, MapleStory constants,
the 600 px rule, or wall detection that only looks at chain neighbours. MapLab tests walls against
the full body.

## A5. Platformer navigation

| Source | Verified (class) | Tradeoff for MapLab |
|---|---|---|
| [Surfacer, *Building platformer AI part 4*](https://devlog.levi.dev/2021/09/building-platformer-ai-part-4-platform.html), [repo](https://github.com/SnoringCatGames/surfacer) (MIT, Godot 3, being rewritten) | Directed graph per character type and per level. Nodes are positions on surfaces. Multiple edges may join one surface pair. Edge kinds include jump, fall, climb-to-adjacent and intra-surface (computed during search). Stored edges keep start/end state, duration, per-frame trajectory and the input sequence. Graphs are precomputed at load or build time and treated as immutable. The author notes that small surface edits can force large recomputation, and that build-time trajectories drift from runtime ones. **(Article)** | Strongest precedent for MapLab's design. Its two documented weaknesses drive R1: drift is removed by replaying the **identical integer controller**, and immutability is reduced by per-edge swept-bounds invalidation (E5) |
| [Branicki, A* for grid platformers](https://code.tutsplus.com/how-to-adapt-a-pathfinding-to-a-2d-grid-based-platformer-theory--cms-24662t) | Grid A* whose node state carries a "jump value" that limits how long a path may keep rising. The series adds one-way platforms and character sizes. **(Article)** | Rejected as the primary model. It is tied to cells, has no continuous slopes, and approximates the arc. Useful only as a cheap reachability pre-filter |
| [Togelius, Karakovskiy & Baumgarten, CEC 2010](https://gpbib.cs.ucl.ac.uk/gp-html/Togelius_2010_cec.html) | The winning 2009 Mario AI agent used A* over game states. **(Paper)** | Forward-simulated search is exact but expensive. MapLab uses it only to *certify* candidate edges and for short local refinement |
| [Physics-Aware A*, SBGames](https://sol.sbc.org.br/index.php/sbgames/article/view/45433) | Physics feasibility filters found 3–13× more valid paths than plain A*, at 21–97× the runtime and 10–35× the memory (median). The authors recommend offline precomputation. **(Paper)** | Independent confirmation that accurate platformer reachability belongs in a precomputed, cached artifact rather than per-query search |
| [HPA*, Botea, Müller & Schaeffer 2004](https://webdocs.cs.ualberta.ca/%7emmueller/ps/hpastar.pdf) | Cluster-level abstraction with precomputed intra-cluster costs. Up to 10× faster than optimized A* within 1% of optimal. **(Paper)** | Hierarchy over surface regions is an optimization, added after the base graph is proven (ML-041) |
| [Goldberg & Harrelson, MSR-TR-2004-24](https://www.microsoft.com/en-us/research/publication/computing-the-shortest-path-a-search-meets-graph-theory/) | Landmark lower bounds via the triangle inequality give admissible A* heuristics on directed graphs. **(Paper)** | Portals and teleports break the Euclidean heuristic, and landmarks restore an admissible one. Until then the heuristic is zero (Dijkstra) |

## A6. Deterministic simulation

| Source | Verified (class) | Consequence |
|---|---|---|
| Hexframe [`src/combat/constants.ts`](https://github.com/Wizard-Gang/Hexframe/blob/5b6e4f11c162d633148e6c1b8450e49e86d757de/src/combat/constants.ts), [`movement/physics.ts`](https://github.com/Wizard-Gang/Hexframe/blob/5b6e4f11c162d633148e6c1b8450e49e86d757de/src/combat/movement/physics.ts) | House rule: every simulation quantity is a 32-bit integer, at a fixed **60 Hz**, with 100 sim units per pixel. The stated reason is that two machines disagreeing in a double's last bit can disagree on outcomes. The simulation is **Y-up** with ground at 0, and it moves position before applying gravity. **(Src)** | R1 aligns MapLab's reference controller with the house engine: integers at 60 Hz. This **reverses** the adopted spec's 120 Hz binary64 choice (K1) |
| RigLab [`docs/ARCHITECTURE.md`](https://github.com/Wizard-Gang/RigLab/blob/b7648cd9b4fd2e70875354aca5124f033642e2c4/docs/ARCHITECTURE.md) | One RigLab frame equals one Hexframe tick at 60 Hz. `riglab.baked` holds one transform set per tick. **(Src)** | A 60 Hz controller samples baked animation frames one-to-one, with no resampling |
| [MDN `Math`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math) | Many `Math` functions have implementation-dependent precision, and results may differ between browsers, operating systems and architectures. **(Doc)** | The owner tests in Safari while CI runs Node. The controller must use no transcendental functions, so slope limits are rationals, not degrees |
| [GCC `-ffp-contract`](https://gcc.gnu.org/onlinedocs/gcc/Optimize-Options.html) | GNU-mode C defaults to contracting expressions into fused multiply-add where the hardware supports it. **(Doc)** | A binary64 controller ported to native engines can diverge silently. An integer controller cannot |
| [Celeste & TowerFall physics, Maddy Thorson](https://www.maddymakesgames.com/articles/celeste_and_towerfall_physics/index.html) | Actors and solids use integer positions with fractional remainders and move one axis at a time. A moving solid carries actors riding it and pushes overlapped actors; pushing beats carrying, and a trapped actor is squished. **(Article)** | Reference semantics for axis-separated moves and for moving-platform carry, push and crush (ML-032) |

## A7. Side-scroller cameras

[Keren, *Scroll Back*](https://www.gamedeveloper.com/design/scroll-back-the-theory-and-practice-of-cameras-in-side-scrollers)
(GDC 2015 talk, article) **(Article)** names these techniques:

- **Camera-window**: the camera moves only when the player pushes its edge.
- **Platform snapping**: vertical camera position updates only on landing, as in Super Mario World.
- **Dual forward focus**, with hysteresis before switching.
- **Lerp and physics smoothing.**
- **Cue attractors.**
- **Region-based anchors.**

For jumps it recommends a window roughly one jump tall combined with platform snapping. It notes
that projected focus works poorly vertically. It gives **no ladder guidance**, so MapLab's
climb-follow policy is an **Assumption** that needs fixture tests.

## A8. Browser storage, local writes and asset safety

| Source | Verified (class) | Consequence |
|---|---|---|
| [caniuse: File System Access API](https://caniuse.com/native-filesystem-api) | Chrome/Edge 105+. **Not supported in Safari** (desktop through 27.x TP, and iOS) **or Firefox**. **(Doc)** | The owner's browser is Safari, so picker/handle saving cannot be his primary path |
| [WebKit storage policy (Safari 17)](https://webkit.org/blog/14403/updates-to-storage-policy/) | Origins are evicted least-recently-used, as a whole, under pressure or after disuse. `persist()` is granted by heuristics. **(Doc)** | IndexedDB is not a durable store for authored maps on the owner's browser |
| [WebKit ITP, March 2020](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/) | Script-writable storage (IndexedDB, LocalStorage, etc.) is deleted after 7 days of Safari use without user interaction on the site. Home Screen apps are exempt. **(Doc)** | Same conclusion. Browser storage holds only recovery drafts |
| RigLab [`src/library/endpoint.ts`, `write.ts`](https://github.com/Wizard-Gang/RigLab/blob/b7648cd9b4fd2e70875354aca5124f033642e2c4/src/library/endpoint.ts) | The loopback dev-server save checks Host, Origin and `Sec-Fetch-Site`, caps bodies at 2 MiB, re-reads and validates the folder, writes temp-then-rename with the index last, and keeps backups. **(Src)** | The proven house pattern for **local-only write authority**. R1 adopts it as MapLab's primary storage (H4) |
| [Vite GHSA-vg6x-rcgg-rjx6](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6) | Permissive CORS, unchecked WebSocket origins and DNS rebinding let websites read a dev server's responses. Fixed in later versions, with `server.allowedHosts`. **(Doc)** | A local write endpoint must validate Host and Origin itself, as RigLab does, and must never trust framework defaults |
| [MDN, SVG as an image](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image) | In image contexts, scripts are disabled and external resources do not load. These limits do not apply to inline or iframe SVG. **(Doc)** | Render imported SVG only through image decoding, never as DOM, after an allowlist parse |
| [RFC 8785 (JCS)](https://www.rfc-editor.org/rfc/rfc8785.html), [JSON Schema 2020-12](https://json-schema.org/draft/2020-12) | Canonical property order and number serialization. Closed-object vocabulary. **(Doc)** | Kept from the adopted spec. Array order and archive determinism remain MapLab's job |

## A9. What the evidence does not establish (assumptions to test)

- That the full-footprint rect stance plus a presentation-only ground offset reads well on slopes
  for every art style. MapleStory's point-on-line stance (A4) stays a declared alternative for a
  later controller version.
- That 60 Hz integer sub-units of 1/256 WU are fine enough for advanced abilities (dash,
  grapple). The fixtures in I2 must prove it, and a successor controller can raise precision
  without changing map geometry.
- That trajectory sampling plus witness replay finds enough legal routes on author-sized maps.
  Finite sampling never proves impossibility (E1).
- Any camera behavior on ladders, tall shafts and stacked floors. That is design intent, to be
  tested in ML-026.
