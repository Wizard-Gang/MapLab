// Public surface of src/contracts. Pure TypeScript: no React, DOM, storage or network access.
export { error, jsonPath, type Diagnostic, type PathSegment, type Severity } from './diagnostics';
export * from './grammar';
export { defaultJsonLimits, parseJson, utf8Length, type JsonLimits, type JsonResult, type JsonValue } from './json';
export {
  DEFERRED_MEMBERS, MAP_SCHEMA, SUPPORTED_CONTRACTS, loadMapHeader, validateMapHeader,
  type Asset, type AssetMediaType, type ContractRef, type Dependency, type DependencyKind, type MapHeader, type MapHeaderResult,
} from './map-header';
export { SCHEMA_DIALECT, SchemaError, canonical, compileSchema, evaluate, type CompiledSchema } from './schema';
export * from './geometry';
export * from './movement';
export * from './capabilities';
export type { Ability, MovementDocument } from './movement-types';
export type { Anchor, BodyShape, RegionShape, Vec2, Transform } from './common-types';
export type { Layer, VisualSource, Visual, Material, Motion, CollisionBody, EdgeRef, EndpointLink, Foothold, AccessPoint, Traversal, Cell, TerrainChunk, TerrainLayer } from './geometry-types';
