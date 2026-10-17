// Authored R1 geometry, terrain and visual contracts (ML-004).
import type { Anchor, BodyShape, Call, Color, Condition, Id, RegionShape, Su, Ticks, Transform, Vec2, WU } from "./common-types";

// ---- Layers (D5) -------------------------------------------------------------------------------
interface LayerBase {
  readonly id: Id;
  readonly name: string;
  readonly parentId: Id | null;
  readonly order: number;
  readonly visible: boolean;
  readonly opacity: number; // 0..1, 1/256 quantum
}
export type Layer = LayerBase & (
  | Readonly<{ kind: "group" | "actors" }>
  | Readonly<{ kind: "tile" | "sprite"; occlusionFade: number | null }>
  | Readonly<{
      kind: "background"; space: "world" | "camera"; parallax: Vec2; origin: Vec2;
      repeat: "none" | "x" | "y" | "xy"; repeatSize: Vec2; scrollWUPerTick: Vec2; phase: Vec2;
      occlusionFade: number | null;
    }>
);

// ---- Terrain (D6, adopted F4 rules) --------------------------------------------------------------
export interface Cell {
  readonly tileId: Id;
  readonly quarterTurns: 0 | 1 | 2 | 3;
  readonly mirrorX: boolean;
  readonly mirrorY: boolean;
}
export interface TerrainChunk {
  readonly column: number; // chunk index (floorDiv of cell / 32)
  readonly row: number;
  readonly cells: readonly (Cell | null)[]; // exactly 1024, row-major
}
export interface TerrainLayer {
  readonly layerId: Id;
  readonly tilesetId: Id;
  readonly origin: Vec2;
  readonly cellSize: Vec2;
  readonly chunkSize: 32;
  readonly chunks: readonly TerrainChunk[];
  readonly terrainIntent: readonly Readonly<{ column: number; row: number; terrainId: Id }>[];
  readonly rulesVersion: number;
  readonly variationSeed: number;
}

// ---- Visuals -------------------------------------------------------------------------------------
export type VisualSource =
  | Readonly<{ kind: "asset"; assetId: Id; pivot: Vec2 }>
  | Readonly<{ kind: "shape"; shape: RegionShape; fill: Color }>
  | Readonly<{ kind: "frames"; assetIds: readonly Id[]; pivot: Vec2; frameTicks: readonly Ticks[]; loop: boolean }>;
export interface Visual {
  readonly id: Id;
  readonly name: string;
  readonly layerId: Id;
  readonly parentId: Id | null; // parent-local transforms compose root→leaf
  readonly order: number;
  readonly transform: Transform;
  readonly source: VisualSource;
  readonly bodyId: Id | null; // rigid attachment: transform becomes body-local
}

// ---- Physics source (D2, D3) ---------------------------------------------------------------------
export interface Material {
  readonly id: Id;
  readonly name: string;
  readonly traction: number; // integer, 256 = 1.0 (ice ≈ 32)
  readonly conveyorSu: Su; // su/tick along a→b of the supporting foothold
  readonly effect: Call | null; // e.g. hazard damage, resolved by the engine
  readonly tags: readonly string[];
}
export interface Motion {
  readonly points: readonly Vec2[]; // ≥ 2; loops repeat the first point at the end
  readonly legTicks: readonly Ticks[]; // points.length − 1 positive entries
  readonly mode: "once" | "loop" | "pingPong";
  readonly initialPhaseTicks: Ticks;
  readonly easing: "linear";
  readonly carry: "delta";
  readonly departure: "none" | "addPlatformVelocity";
  readonly crushAction: Call | null;
}
export interface CollisionBody {
  readonly id: Id;
  readonly name: string;
  readonly position: Vec2;
  readonly enabled: boolean;
  readonly mobility: "static" | "kinematic";
  readonly category: string;
  readonly mask: readonly string[];
  readonly materialId: Id;
  readonly shapes: readonly BodyShape[];
  readonly motion: Motion | null;
}
export interface EdgeRef {
  readonly bodyId: Id;
  readonly shapeId: Id; // R1: stable shape ID, not array index
  readonly edgeIndex: number;
}
export interface EndpointLink {
  readonly footholdId: Id;
  readonly endpoint: "a" | "b";
}
export interface Foothold {
  readonly id: Id;
  readonly name: string;
  readonly ownerBodyId: Id | null;
  readonly a: Vec2; // a.x < b.x (x-monotone, upward normal)
  readonly b: Vec2;
  readonly normal: "up";
  readonly mode: "solid" | "oneWay";
  readonly solidEdge: EdgeRef | null; // required iff mode === "solid"
  readonly dropAllowed: boolean;
  readonly dropGroupId: Id | null;
  readonly materialId: Id;
  readonly direction: "both" | "aToB" | "bToA"; // navigation-only restriction
  readonly category: string;
  readonly mask: readonly string[];
  readonly enabled: boolean;
  readonly connections: Readonly<{ a: readonly EndpointLink[]; b: readonly EndpointLink[] }>;
  readonly planeId: Id | null; // R1: actors layer while supported; null = default plane
}

// ---- Traversal (D4) ------------------------------------------------------------------------------
export interface AccessPoint {
  readonly id: Id;
  readonly pathU: number;
  readonly anchor: Anchor;
  readonly entry: "grounded" | "airborne" | "either" | "none";
  readonly exit: "grounded" | "airborne" | "either" | "none";
  readonly conditions: readonly Condition[];
}
export type Traversal =
  | Readonly<{
      id: Id; kind: "ladder" | "rope"; points: readonly Vec2[]; grabRadius: WU;
      direction: "both" | "up" | "down"; access: readonly AccessPoint[];
      requiredAbilities: readonly string[]; visualId: Id | null; planeId: Id | null;
    }>
  | Readonly<{
      id: Id; kind: "wall" | "ledge" | "grapple"; edge: EdgeRef; points: readonly Vec2[];
      approachRegionId: Id; requiredAbilities: readonly string[];
    }>
  | Readonly<{
      id: Id; kind: "scripted"; from: Anchor; to: Anchor; action: Call;
      conditions: readonly Condition[]; bidirectional: boolean;
    }>;
