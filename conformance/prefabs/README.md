# Owned prefab snapshots

CC0-1.0, MapLab authors. The marker SVG is a new primitive drawing. The base map
and gameplay vocabulary derive from MapLab's owned placeholder library.

`prefabs/tree-marker.prefab.json` includes a visual hierarchy, immutable image,
material, collider with stable shape ID, solid foothold, ladder with stable access
IDs, regions, entities, AI/route anchors, flag conditions, typed actions and an
encounter group. `placements.json` places the same local IDs twice, once mirrored.
`two-placements.expected.map.json` pins their complete authored expansion.

`tests/prefabs.test.ts` checks creation closure, exact undo/redo, independence,
presentation/asset remapping, mirror geometry, typed local/external references,
slot/ID/dependency conflicts and recursion refusal. Presentation binding data is
covered separately because the exporter still refuses unvalidated foreign bundles.

`tests/prefab-export.test.ts` exports from an isolated saved library twice, compares
the pinned export identity, and copies only the exported files, published schemas,
separate reader and `tests/consumer/prefab-consumer.mjs` into a temporary directory.
The consumer reconstructs both physical floors and ladder coordinates and checks
placement ownership, slot bindings, local flags/assets and dependency closure.
It rejects coherently rehashed cross-instance references and changed geometry.
No editor/runtime module is available to that consumer. The proof covers this
corpus, not external engine parity or a foreign presentation importer.
