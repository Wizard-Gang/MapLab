# D. World data and physics specification

Part 1: coordinates, geometry, traversal, layers and gameplay data. The movement controller and
profiles are in [D-reference-controller.md](D-reference-controller.md).

## D1. Coordinates and precision (Changed)

| Space | Definition |
|---|---|
| **World** | World units (**WU**), X right, Y down, visual rotation in clockwise degrees. The origin is arbitrary and negatives are allowed. Default tile is 32 WU. Default art density is 1 px/WU, set per asset. **Kept** |
| **Authored quantum** | Every authored position, length, size, snap spacing and region coordinate is a multiple of **q = 1/16 WU** (`0.0625`) and serializes with at most 4 fractional digits. *Adopted §D1 used 1/256.* **Changed** |
| **Map range** | Every authored coordinate, including `bounds`, satisfies **\|v\| ≤ 131,072 WU (2¹⁷)**. *Adopted: 2²⁰.* **Changed** |
| **Controller units** | Sub-unit **su = 1/256 WU**. Tick = 1/60 s. Controller state is integer su, su/tick and su/tick² (D-reference-controller) |
| **Screen** | CSS px: `screen = viewportOrigin + zoom · pxPerWU · (world − cameraOrigin)`, with the exact inverse. Device pixel ratio scales only the canvas backing store. **Kept** |
| **Tile / chunk** | Cell `(col,row) = floorDiv(world − layerOrigin, cellSize)`. Chunk = `floorDiv(cell, 32)`. Negative cells and chunks are valid. Cell size is a multiple of q. **Kept** |
| **Snap** | Per-axis spacing and origin (multiples of q), or free. Endpoint weld, surface and art-pixel snaps are separate, and the status bar shows which one won. Snap first, then quantize once at commit. Previews are never quantized repeatedly. **Kept** |
| **Asset local** | Raster pixels or sanitized SVG viewBox units. Explicit pivot and `wuPerAssetUnit`. Visual transform = translate · rotate(cw) · mirror · scale · translate(−pivot). **Kept** |
| **Physical** | Static geometry is in world WU. Body-owned geometry is in body-local WU, translated by the body position. Physics never sees rotated or scaled colliders in v1. **Kept** |
| **Actor anchor** | The actor origin is the **foot reference**: bottom-center of its upright rect, `[x−w/2, x+w/2] × [y−h, y]`. Physics stance is `fullFootprint`: the rect rests on the highest support under its footprint, with no penetration (D-reference-controller §RC2). The visual ground offset that removes slope "hover" is presentation-only (G3). **Kept + Added** |
| **Camera / parallax** | `render = (world − origin − factor·(camera − origin)) · scale` per layer. Factor 1 is world-fixed, 0 is camera-fixed. Repetition uses mathematical modulo, so negatives work. **Kept** |
| **RigLab** | Rig space is also X-right/Y-down. `P + R · diag(f·s, s) · (p − a)` with an explicit rig ground anchor `a`, scale `s` and facing `f` (G3). **Kept** |

**Why change the quantum and the range?**

1. **Float32 exactness.** With q = 2⁻⁴ and |v| ≤ 2¹⁷, every authored coordinate is `n·2⁻⁴` with
   |n| ≤ 2²¹ < 2²⁴, so it is **exact in IEEE binary32**. Godot's default build and Unity store 2D
   positions as float32 and import every authored coordinate exactly. With the adopted 1/256 quantum
   and ±2²⁰ range, coordinates beyond ±65,536 WU silently round on import.
2. **Exact integer controller.** In su, coordinates are at most 2²⁵. Differences are at most 2²⁶
   and products of two differences at most 2⁵². Every orientation and intersection predicate the
   controller and validators need is therefore an **exact JavaScript integer** (≤ 2⁵³), with no
   BigInt in hot loops.
3. **Enough room.** 262,144 WU is 8,192 tiles of 32 WU, about 400 screens of 640 WU. Bigger worlds
   are multiple maps joined by portals. A future `maplab.world` layout document can place maps at
   offsets for streaming, with each map keeping local coordinates (deferred; reserved in F1).

Rounding everywhere is **half away from zero**, and −0 normalizes to 0 (*adopted §D1*, **Kept**).
Visual rotation uses a 1/256° quantum and positive scale a 1/65536 quantum (**Kept**). **Durations
in authored data are integer ticks at the map's declared 60 Hz** (waypoint waits, respawn delays,
camera blends, frame timings). This replaces the adopted decimal seconds. **Changed**

## D2. Physical authority (Kept, with Changed details)

Four physical source kinds, never inferred from artwork:

1. **Bodies.** Solid shapes `rect | segment | polygon`, each with a stable **`shape.id`**
   (**Changed** from shape index). Category, mask, `enabled`, material and optional motion.
   - Polygons are simple, with no holes in v1, and are **clockwise on screen**, which is positive
     signed area in Y-down. Edge *i* runs vᵢ→vᵢ₊₁ and its outward normal is `(dy, −dx)`.
   - Rect edges are top, right, bottom, left in that order (also clockwise). Concave polygons are
     valid source; consumers may decompose them, keeping a source mapping.
   - Segment bodies are **two-sided** barriers. They are MapLab's MapleStory-style walls.
2. **Footholds.** First-class support surfaces (D3).
3. **Traversals.** Climb paths, wall/ledge/grapple permissions and scripted links (D4).
4. **Volumes.** Regions with physical roles: `swim`, `flight`, `launch`, `hazard`,
   `movementModifier` (D7).

**Interaction rules**

- Tiles and sprites never collide. "Trace from tiles" produces an ordinary, reviewable body/foothold
  draft in one transaction, with no live link.
- A face is either a **support face** or a **blocking face**, and which one depends on the profile
  (D3, controller §RC3).
  - A support face is upward-facing and walkable. It stops the rect's bottom edge from above, for
    landing and standing.
  - A blocking face is a wall, a ceiling, a face too steep for the profile, or a two-sided segment.
    It stops the rect against its outward normal.
- Object colliders (doors, crates, destructibles, moving platforms) are bodies owned by entities.
  They join the same physical index. Engine runtime state can disable or move them through overlays
  keyed by source ID (G2). Authored JSON never changes.
- An invisible art layer cannot remove collision. `enabled: false` on a body or foothold is the
  only authored switch.

## D3. Footholds (Kept model, Changed details)

| Field | Rule |
|---|---|
| `id` | Persistent, unique across all object collections in the map |
| `a`, `b` | Endpoints in the owner frame. **x-monotone**: `a.x < b.x`. Vertical surfaces are body segments, never footholds |
| `normal` | Always `"up"`, meaning `(dy, −dx)` normalized. Footholds are upward-facing by construction |
| `mode` | `"oneWay"`: a standalone directed surface, passable from below and the sides. `"solid"`: names its body edge `solidEdge: {bodyId, shapeId, edgeIndex}`, and `a,b` must equal that edge exactly (possibly reversed). The body still owns side and bottom collision |
| `dropAllowed`, `dropGroupId` | Deliberate drop-through, one-way only. A drop suppresses the whole group (a welded chain) until the foot is clear |
| `materialId` | Top-face material: traction, conveyor and effect. It overrides the body material for support |
| `direction` | `both`, `aToB` or `bToA`. **Navigation-only** restriction. A physically one-way surface uses `mode`, not an arrow |
| `connections` | `{a: EndpointLink[], b: EndpointLink[]}`. **Welded** endpoints need exact equality in the same frame, and links are **reciprocal**. A walking body transfers only across welds (JourneyClient `prev`/`next`, generalized to more than one link) |
| `planeId` | **Added.** Actor plane while supported by this foothold (D6). `null` means the map's default actors layer |
| `category`, `mask`, `enabled` | As for bodies. A solid foothold must agree with its body |

**Walkability is per profile.** A foothold with run `dx` and rise `dy` is *walkable* for a profile
with `maxSlope = {rise, run}` iff `|dy| · run ≤ dx · rise`. This is exact integer math with no
trigonometry. A non-walkable foothold is *steep* for that profile: it is a blocking face, not
support. For example, a 26.6° slope (`dy/dx = 0.5`) is walkable for both `{1,1}` (45°) and
`{7,10}` (≈35°).

**MapleStory mapping**:

| MapleStory | MapLab |
|---|---|
| Plain platform | One-way foothold, `dropAllowed: true` |
| Lowest ground or `forbidFallDown` | One-way foothold, `dropAllowed: false` |
| `cantThrough` | Solid foothold on a thin rect or segment body |
| Wall foothold (x1 = x2) | Segment body |
| `prev`/`next` | `connections` |
| `page` / layer | `planeId` |

**Editing invariants** (*adopted §D2*, **Kept**):

- Split keeps one ID and allocates one.
- Join keeps a chosen ID, only for collinear segments with identical properties.
- Every split, join and delete re-resolves surface anchors, connections, access points and routes
  in the same transaction.
- Deleting referenced geometry needs an explicit retarget or cascade.

## D4. Traversal and anchors (Kept, with stance Changed)

**Anchors** are one of:

- `world {point}`
- `surface {footholdId, u, normalOffset}`
- `body {bodyId, point}` (body-local)
- `entity {entityId, point}`

`u` is the normalized position along the foothold in 1/65536 steps. Editors re-resolve it from
world x after a split.

A surface anchor names a point on the line. The **stance resolver** places the profile's rect on
the highest support under its footprint (*adopted §D2*, **Kept**). The adopted example still holds:
a 24-wide body on a 0.5 slope rests 6 WU above the line at its center x.

That lift is physically correct but reads as hovering. G3 adds a **presentation-only ground-contact
offset**, so the art's feet are drawn on the line while the collider stays put. The MapleStory-style
`centerFoot` stance stays a declared profile value. Controller v1 reports it as *unsupported*: it
needs extra rules where solid bodies are involved (K1).

**Climb paths** (ladders and ropes) are a polyline (vertical in v1), plus `grabRadius`,
`direction`, `requiredAbilities` and **access points**: `{pathU, anchor, entry, exit, conditions}`.

- An access point with grounded exit at the top is MapleStory's `uf`.
- A rope bottom may be deliberately airborne.
- **Validation**:
  - Grounded entries and exits need a foothold anchor under the path with full-body clearance.
  - An intermediate exit must be explicit.
  - A decorative ladder sprite with no climb path never creates a route.

**Walls, ledges and grapple anchors** reference body faces by `{bodyId, shapeId, edgeIndex}`, with
an approach region and required abilities.

**Portals and doors** name `{mapId, entityId}` destinations: a start or arrival entity, never a
filename or index. Intra-map teleports use the same map ID. Activation is `touch` or `interact`,
and a destination may carry conditions.

**Scripted links** use a catalog action with typed parameters and endpoints. With no supported
solver they are shown as unresolved, and they never exempt a route from clearance.

## D5. Visual layers and actor planes (Changed)

Layers are flat records with `parentId`, sibling `order`, `visible`, `opacity` and a `kind`:

| Kind | Content |
|---|---|
| `group` | Container only. Multiplies opacity and visibility, with no transform |
| `background` | Parallax/repeat/autoscroll/phase, `space: world \| camera` (*adopted §C3*) |
| `tile` | Binds a `TerrainLayer` (chunked cells and terrain intent) |
| `sprite` | Visuals (assets, shapes, frame animations, groups, prefab output) |
| `actors` | **Added.** Marks where actors paint. At least one is required in a playable map, and the first by paint order is the default plane |

Paint order is the depth-first order of `(parent, order, id)`. Everything after an actors layer
paints over the actors in it, so **foreground means order, not kind**. *Adopted* `foreground` kind
is subsumed: the layer becomes a `sprite`/`tile`/`background` above the actors plane, optionally
with `occlusionFade` (an advisory alpha the engine may apply while an actor is behind it).

**Plane rule** (A4 evidence): a grounded actor paints in its support's `planeId`. While airborne or
climbing it keeps its last plane, or uses the climb path's `planeId` if set.

## D6. Terrain (Kept)

`TerrainLayer` has: tileset, origin, cell size, sparse 32×32 row-major chunks of
`{tileId, quarterTurns, mirrorX, mirrorY} | null`, optional terrain intent per cell, `rulesVersion`
and a variation seed.

- **Resolved tiles are always stored**, so engines need no autotiler.
- Autotiling uses the adopted rule system (*adopted §F4*): an 8-neighbor mask in N, NE, E, SE, S,
  SW, W, NW order, highest priority wins with ties by rule ID, and an integer-hash weighted variant.
- Transform permissions come from the tileset.
- Biomes and palettes are editor-library aids. Exports expand them to literal tiles and colors.

## D7. Gameplay metadata (Kept, with Changed time units)

The adopted entity, region, route, trigger and encounter vocabulary (*adopted §E5, §F2*) stands:

- **Entities**: `playerStart`, `checkpoint`, `enemySpawn`, `npc`, `portal`, `door`, `building`,
  `chest`, `destructible`, `pickup`, `interactive`, `hazard`, `questMarker`, `objective`,
  `cutsceneMarker`.
- **Regions**: `rect | polygon | circle` with a primary role.
- **Routes and waypoints**, with surface anchors.
- **AI config**: behavior call, route, guard/home/pursuit/leash/aggro, invalid-route policy.
- **Triggers**: event, actor categories, once, conditions, actions.
- **Encounters**: region, group, spawns, waves, completion event.
- **Camera** defaults and zones. **Environment** audio, transition, modifier and launch zones.
- **Navigation intent**: mode volumes, explicit links, overrides. **Flags.**

R1 changes:

- Every `…Seconds` field becomes integer **`…Ticks` at 60 Hz** (D1).
- `Respawn.delayTicks` replaces `delaySeconds`. `Waypoint.waitTicks` replaces `waitSeconds`.
- Camera `damping` and `transition` use ticks.
- Catalog-bound `params` stay closed by their definition. Conditions remain data-only trees with
  depth ≤ 8 and ≤ 256 leaves.
