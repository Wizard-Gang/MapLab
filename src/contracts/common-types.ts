// Shared R1 vocabulary. ML-006 binds calls and conditions in a closed source graph.
// TypeScript cannot express ranges, quanta, closure or reference integrity; the published JSON Schemas
// (closed, 2020-12) and the semantic validators in F-formats.md §F3 enforce those.

/** Persistent authored identity. Grammar `^[a-z0-9][a-z0-9._:-]{0,95}$`. Unique across every object
 * collection of one map; document IDs are unique across a project and an export bundle. */
export type Id = string;

/** World units. Every authored coordinate/length is a multiple of 1/16 WU and |v| ≤ 131072 (D1). */
export type WU = number;
/** Integer controller sub-units: 1/256 WU (RC1). */
export type Su = number;
/** Integer ticks at the declared 60 Hz (D1). */
export type Ticks = number;

export type Vec2 = readonly [WU, WU];
/** x, y, width, height in WU. */
export type Rect = readonly [WU, WU, WU, WU];
/** Exact small positive rational, e.g. a slope limit {rise:1, run:1} or a scale {num:3, den:4}. */
export interface Ratio {
  readonly num: number;
  readonly den: number;
}
export interface Slope {
  readonly rise: number;
  readonly run: number;
}

/** A versioned contract identity: format, controller, camera model, catalog entry, solver… */
export interface ContractRef {
  readonly key: string;
  readonly version: number;
}

export type ObjectKind =
  | "layer" | "visual" | "body" | "shape" | "foothold" | "traversal" | "region" | "entity"
  | "waypoint" | "route" | "trigger" | "encounter" | "asset" | "movement" | "flag" | "group"
  | "presentation" | "material";

/** Typed reference; `mapId` only for cross-map targets. Existence alone is never enough: the target's
 * kind must equal `kind`. */
export interface ObjectRef {
  readonly kind: ObjectKind;
  readonly id: Id;
  readonly mapId?: Id;
}

/** Catalog parameter values are scalars or typed references; `params` objects are closed by the
 * catalog definition they bind to (no free-form property bags). */
export type ParamValue = string | number | boolean | Readonly<{ ref: ObjectRef }>;
export type Params = Readonly<Record<string, ParamValue>>;
export interface Call extends ContractRef {
  readonly params: Params;
}

/** Data-only condition tree: depth ≤ 8, ≤ 256 leaves, no expressions. */
export type Condition =
  | Readonly<{ kind: "flag"; id: Id; equals: boolean }>
  | Readonly<{ kind: "ability"; tag: string }>
  | Readonly<{ kind: "entityState"; entityId: Id; state: string }>
  | Readonly<{ kind: "all" | "any"; terms: readonly Condition[] }>
  | Readonly<{ kind: "not"; term: Condition }>;

/** Source anchors. `surface.u` is a multiple of 1/65536 in [0,1]; editors re-resolve it by x after a
 * split. A surface anchor is a point on the line; stance resolution is profile-dependent (RC2). */
export type Anchor =
  | Readonly<{ kind: "world"; point: Vec2 }>
  | Readonly<{ kind: "surface"; footholdId: Id; u: number; normalOffset: WU }>
  | Readonly<{ kind: "body"; bodyId: Id; point: Vec2 }>
  | Readonly<{ kind: "entity"; entityId: Id; point: Vec2 }>;

/** Body shapes carry stable IDs (R1) so edge references survive reordering. Rect edges are
 * top, right, bottom, left; polygons are simple, clockwise on screen (positive area in Y-down);
 * edge i is vertex i → i+1 with outward normal (dy, −dx). Segments are two-sided barriers. */
export type BodyShape =
  | Readonly<{ id: Id; kind: "rect"; rect: Rect }>
  | Readonly<{ id: Id; kind: "polygon"; points: readonly Vec2[] }>
  | Readonly<{ id: Id; kind: "segment"; a: Vec2; b: Vec2 }>;

export type RegionShape =
  | Readonly<{ kind: "rect"; rect: Rect }>
  | Readonly<{ kind: "polygon"; points: readonly Vec2[] }>
  | Readonly<{ kind: "circle"; center: Vec2; radius: WU }>;

/** Visual transform: translate × rotate(clockwise degrees, 1/256° quantum) × mirror × scale
 * (1/65536 quantum) × translate(−pivot). Physics never reads it. */
export interface Transform {
  readonly position: Vec2;
  readonly rotation: number;
  readonly scale: Vec2;
  readonly mirrorX: boolean;
  readonly mirrorY: boolean;
}

/** Another authored document this one needs. `path` is a normalized bundle-root-relative POSIX path
 * (safe ASCII components, ≤ 240 bytes, no `.`/`..`/empty/backslash/scheme/absolute). */
export interface Dependency {
  readonly id: Id;
  readonly kind: "map" | "tileset" | "prefab" | "movement" | "catalog" | "riglab";
  readonly path: string;
  readonly required: boolean;
}

export interface Asset {
  readonly id: Id;
  readonly path: string;
  readonly mediaType: "image/png" | "image/webp" | "image/svg+xml" | "audio/ogg" | "audio/wav";
  /** WU per asset pixel or SVG viewBox unit. */
  readonly wuPerAssetUnit: number;
  /** Decoded pixel size, SVG viewBox size, or [0,0] for audio. */
  readonly size: Vec2;
}

/** `#RRGGBB` or `#RRGGBBAA` only; never CSS expressions or URLs. */
export type Color = string;
