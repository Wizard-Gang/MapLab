# Visual authoring and inert images (ML-015)

Objects mode exposes Visual authoring below the viewport. Create sprite,
background, group and actors layers; edit parent group, sibling order, name,
visibility and opacity. Tile-layer settings and paint retain the terrain tools.
Foreground is the depth-first paint position after an actors layer, with an
optional advisory occlusion fade. It is never a new kind. Layer groups multiply
visibility and opacity and have no transform. Hiding art never changes collision.

Add rectangles, circles, polygons, asset sprites or ordered frame sequences.
The numeric inspector edits local position/rotation/scale, shape geometry,
asset-local pivot, WU per asset unit, order and frame ticks. A visual parent
must share its child's layer and rigid-body frame. Parent pivots are converted
to WU before composing root-to-leaf transforms. Reparenting keeps local values
and changes world pose explicitly; it does not approximate or decompose an
affine matrix. Changing a root visual's layer/body frame carries its descendants
in one transaction. Physical body definitions remain unchanged.

Art preview tick scrubs frame animation, background phase and scroll; it is an
editor session value, never saved. World backgrounds use
`origin + parallax * (camera - origin)` independently per axis. Camera-space
backgrounds use camera zero in their own frame and are selected in the hierarchy.
Repeating axes reduce `phase + scrollWUPerTick * tick` by mathematical modulo,
including negative positions. World-space repeat copies pick their source ID
using the same parallax, phase and period math. Repeat work over4,096 visible
copies refuses to draw or pick with a notice. Unsafe repeat indices from extreme
composed parent transforms also refuse. Zoom in or reduce those transforms.

Imports accept PNG, WebP and a closed SVG subset. Limits are checked before
image decoding: raster16 MiB/4096 per dimension/16 MP; SVG2 MiB/20,000 XML nodes/
200,000 path segments, depth64 and bounded acyclic reference expansion. SVG
supports shapes, groups, internal gradients and clip paths with literal numeric
geometry and hex paint. Text, CSS/style, scripts, events, images, use, filters,
animation, DTD/entities, external URLs and unsupported attributes refuse.
The parser structurally validates the tree and reference graph, then serializes
only approved nodes/attributes. Compressed PNG metadata and unsupported WebP
metadata/animation refuse. PNG chunk CRC and WebP chunk sizes/dimensions are
checked; the browser's decoder must also complete successfully before a source
asset record is authored. Asset decoding uses Blob image sources and Canvas2D,
never imported SVG DOM or a remote URL.

The guarded `/__maplab/asset-import` endpoint writes an immutable approved copy
at `assets/<sha12>/<sha256>.<ext>`; originals are untouched. A repeated import is
idempotent. Existing different bytes, symlink paths, excessive bodies and
placeholder writes refuse. `/__maplab/asset-read` only reads content-addressed
paths, verifies the full digest and structural validation again, and returns
approved bytes. These JSON POST endpoints share the library Host/Origin guards
and serial request queue. Assets copied before an unsaved map is saved may remain
unreferenced in the library; they are never evidence of a saved map.

Images decode one at a time into an LRU of at most256 MiB of RGBA surfaces.
SVG zoom buckets are0.5×/1×/2×/4×, additionally bounded to4096 per rasterized
axis and16 MP. Only visible art requests images. A bounded visible working set
prevents cache thrashing; a notice explains a full image budget. Closing a
viewport aborts pending reads/decodes and releases cached surfaces. Tile asset
visuals share the same inert cache; terrain cells, intent and transform
permissions retain their ML-013/014 source contracts.

Unit tests exercise parser limits, adversarial XML, image headers/CRC, immutable
paths, symlinks, endpoint guards, LRU lifecycle, full valid parent frames,
undo/redo, shared affine transforms and negative background math. Actual
Chromium/WebKit tests check authored save/reopen bytes, pixels, hierarchy,
malicious import refusal, no remote fetch/DOM injection, frames, culling and
cancellation. A separately archived Python consumer independently reads final
saved map/asset bytes without importing editor/runtime code. This is an asset
and scene proof, not ML-016's future dependency-closed export/STORE ZIP feature.
