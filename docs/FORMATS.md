# Planned format authority

No MapLab schema, parser, importer, exporter, or migration is implemented in ML-001.
[Specification D, F, and G](specifications/2026-10-16-maplab.md) are adopted design
material. Their TypeScript/JSON examples remain documentation, not a consumer API.
ML-003–006 implement contracts; ML-007 adds the independent byte reader.

Future formats use closed versioned headers, stable IDs, bounded X-right/Y-down
world coordinates, explicit asset/dependency references, and independent authored
documents. Geometry, visual layers, prefabs, every movement ability family,
gameplay catalogs, camera/environment intent and navigation intent have explicit
source boundaries. Generated graphs are optional caches; mutable simulation state
is never canonical authored content. Unknown required versions/features fail.

Parsing must bound bytes and depth, reject duplicate keys and unsafe/aliased paths,
validate cross-document references and exact geometry, and stage before opening.
Schemas are local, closed JSON Schema 2020-12 plus independent semantic validators;
network schema fetching and executable extension strings are forbidden.

Exports require complete transitive closure, SHA-256 byte inventories, JCS property
and number serialization, specified semantic array ordering, deterministic STORE
ZIP metadata, and independent final-byte verification. Do not infer ZIP determinism
from canonical JSON or publisher authenticity from an unsigned manifest. Current
and previous schema migrations need deterministic proof fixtures. Asset/archive
limits and path rules remain specification H4 authority until implemented.

Optional RigLab manifests/baked data must be independently validated and bound to
explicit art, scale, ground anchors and actions. They never supply collider, root
motion, or gameplay authority. Unbaked/missing-art input uses a placeholder.
