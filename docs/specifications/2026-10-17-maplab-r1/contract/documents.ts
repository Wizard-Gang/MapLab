// MapLab R1 contract sketch: the versioned document family (F1). Design material, not application code.
import type {
  Asset, BodyShape, Call, Condition, ContractRef, Dependency, Id, ObjectKind, Ratio, Rect, Slope, Su, Ticks, Vec2, WU,
} from "./common";
import type { CollisionBody, Foothold, Layer, Material, TerrainLayer, Traversal, Visual } from "./map";
import type {
  CameraConfig, Encounter, Entity, Environment, NavigationIntent, Region, RigPresentationBinding,
  Route, Trigger, Waypoint,
} from "./gameplay";

export interface MapDocument {
  readonly format: "maplab.map";
  readonly version: 1;
  readonly id: Id;
  readonly metadata: Readonly<{ name: string; description: string; authors: readonly string[]; license: string; tags: readonly string[] }>;
  readonly requiredFeatures: readonly ContractRef[];
  readonly coordinates: Readonly<{ units: "WU"; x: "right"; y: "down"; rotation: "clockwiseDegrees"; quantum: 0.0625; ticksPerSecond: 60 }>;
  readonly bounds: Rect;
  readonly collisionContract: ContractRef;
  readonly dependencies: readonly Dependency[];
  readonly assets: readonly Asset[];
  readonly presentations: readonly RigPresentationBinding[];
  readonly layers: readonly Layer[];
  readonly terrain: readonly TerrainLayer[];
  readonly visuals: readonly Visual[];
  readonly materials: readonly Material[];
  readonly bodies: readonly CollisionBody[];
  readonly footholds: readonly Foothold[];
  readonly traversals: readonly Traversal[];
  readonly regions: readonly Region[];
  readonly entities: readonly Entity[];
  readonly waypoints: readonly Waypoint[];
  readonly routes: readonly Route[];
  readonly triggers: readonly Trigger[];
  readonly encounters: readonly Encounter[];
  readonly camera: CameraConfig;
  readonly environment: Environment;
  readonly navigation: NavigationIntent;
  readonly flags: readonly Readonly<{ id: Id; initial: boolean }>[];
  /** R1: provenance of expanded prefab placements. Engines may ignore it; content is already expanded. */
  readonly prefabPlacements: readonly Readonly<{
    id: Id; prefabId: Id; position: Vec2; mirrorX: boolean;
    layerBindings: readonly Readonly<{ slot: string; layerId: Id }>[]; expandedIds: readonly Id[];
  }>[];
}

// ---- maplab.movement v1 (RC5): kinematics are integer su / ticks at 60 Hz ---------------------------
export type Ability =
  | Readonly<{ kind: "jump"; version: 1; impulse: Su; holdTicks: Ticks; holdGravity: Su; release: Ratio; airJumps: number; airborneImpulse: Su }>
  | Readonly<{ kind: "climb"; version: 1; speed: Su; ladder: boolean; rope: boolean; jumpOff: readonly [Su, Su] }>
  | Readonly<{ kind: "dash"; version: 1; mode: "ground" | "air"; speed: Su; durationTicks: Ticks; cooldownTicks: Ticks; charges: number; reset: "ground" | "timer"; gravity: Ratio; collision: "stop" }>
  | Readonly<{ kind: "wall"; version: 1; permissions: readonly ("slide" | "jump" | "climb")[]; slideMaxSpeed: Su; jumpImpulse: readonly [Su, Su]; climbSpeed: Su; staminaTicks: Ticks }>
  | Readonly<{ kind: "ledge"; version: 1; grabReach: WU; climbTicks: Ticks; action: ContractRef }>
  | Readonly<{ kind: "swim"; version: 1; speed: Su; acceleration: Su; buoyancy: Su; breachImpulse: Su }>
  | Readonly<{ kind: "fly"; version: 1; speed: Su; acceleration: Su; turnAcceleration: Su; hover: boolean }>
  | Readonly<{ kind: "grapple"; version: 1; range: WU; reelSpeed: Su; lengthRange: Vec2; swingGravity: Ratio; solver: ContractRef }>
  | Readonly<{ kind: "teleport"; version: 1; range: WU; cooldownTicks: Ticks; target: "anchor" | "lineOfSight"; clearance: "fullBody" }>
  | Readonly<{ kind: "launch"; version: 1; maxImpulse: Su; airControl: Ratio; canRecover: boolean }>
  | Readonly<{ kind: "modifier"; version: 1; allowed: readonly ContractRef[]; stacking: "replace" | "multiplyThenClamp" }>
  | Readonly<{ kind: "registered"; version: 1; definition: Call; solver: ContractRef }>;

export interface MovementDocument {
  readonly format: "maplab.movement";
  readonly version: 1;
  readonly id: Id;
  readonly name: string;
  readonly controller: ContractRef; // { key: "maplab.reference-controller", version: 1 }
  readonly units: Readonly<{ subunitsPerWU: 256; ticksPerSecond: 60 }>;
  readonly collider: Readonly<{ kind: "rect"; width: WU; height: WU }> | Readonly<{ kind: "capsule"; radius: WU; height: WU }>;
  readonly support: "fullFootprint" | "centerFoot"; // v1 controller supports fullFootprint only
  readonly grabHeight: WU;
  readonly category: string;
  readonly mask: readonly string[];
  readonly ground: Readonly<{ walkSpeed: Su; runSpeed: Su; acceleration: Su; braking: Su; maxSlope: Slope; uphill: Ratio; downhill: Ratio; snapDistance: Su }>;
  readonly air: Readonly<{ gravity: Su; maxFall: Su; acceleration: Su; maxSpeed: Su }>;
  readonly drop: Readonly<{ canDrop: boolean; timeoutTicks: Ticks }>;
  readonly abilities: readonly Ability[];
  readonly abilityTags: readonly string[];
  readonly forbiddenMaterialTags: readonly string[];
}

// ---- maplab.tileset v1 ---------------------------------------------------------------------------
export interface TilesetDocument {
  readonly format: "maplab.tileset";
  readonly version: 1;
  readonly id: Id;
  readonly name: string;
  readonly cellSize: Vec2;
  readonly assets: readonly Asset[];
  readonly tiles: readonly Readonly<{
    id: Id; visual: Visual["source"]; allowedQuarterTurns: readonly (0 | 1 | 2 | 3)[];
    allowMirrorX: boolean; allowMirrorY: boolean; terrainId: Id | null;
    suggestedMaterialId: Id | null;
    /** R1: tile-local shapes used only by the editor's "Trace from tiles" draft. Never physics. */
    traceShapes: readonly BodyShape[];
  }>[];
  readonly terrains: readonly Readonly<{ id: Id; name: string; biome: string; fallbackTileId: Id }>[];
  readonly rulesVersion: number;
  readonly rules: readonly Readonly<{ id: Id; terrainId: Id; neighborMask: number; priority: number; outputTileIds: readonly Id[]; weights: readonly number[] }>[];
}

// ---- maplab.prefab v1 (expanded on placement/export; no runtime prefab evaluator) -----------------
export type PrefabContent = Pick<MapDocument,
  "assets" | "presentations" | "flags" | "visuals" | "materials" | "bodies" | "footholds" | "traversals"
  | "regions" | "entities" | "waypoints" | "routes" | "triggers" | "encounters">;
export interface PrefabDocument {
  readonly format: "maplab.prefab";
  readonly version: 1;
  readonly id: Id;
  readonly name: string;
  readonly pivot: Vec2;
  readonly dependencies: readonly Dependency[];
  readonly layerSlots: readonly string[];
  readonly content: PrefabContent;
}

// ---- maplab.catalog v1: engine-owned vocabulary, data only ---------------------------------------
export type Field = Readonly<{ name: string; required: boolean }> & (
  | Readonly<{ type: "integer"; min: number; max: number }>
  | Readonly<{ type: "number"; min: number; max: number; quantum: number }>
  | Readonly<{ type: "string"; maxLength: number }>
  | Readonly<{ type: "boolean" }>
  | Readonly<{ type: "enum"; values: readonly string[] }>
  | Readonly<{ type: "ref"; target: ObjectKind }>
);
export interface CatalogDocument {
  readonly format: "maplab.catalog";
  readonly version: 1;
  readonly id: Id;
  readonly entries: readonly Readonly<{
    key: string; version: number;
    kind: "archetype" | "behavior" | "action" | "effect" | "event" | "traversal" | "modifier" | "animation";
    stage: "planned" | "available"; // "planned" = authorable now, shown as "configured, not simulated"
    fields: readonly Field[]; stateNames: readonly string[];
  }>[];
}

// ---- maplab.project v1: library index, editor-only, never exported (H4) ---------------------------
export interface ProjectDocument {
  readonly format: "maplab.project";
  readonly version: 1;
  readonly id: Id;
  readonly name: string;
  /** Written last on every save; per-document digests make a torn multi-file save detectable. */
  readonly documents: readonly Readonly<{ id: Id; kind: "map" | "tileset" | "prefab" | "movement" | "catalog" | "palette"; path: string; sha256: string }>[];
  readonly defaults: Readonly<{ tileSize: Vec2; snap: Vec2; movementId: Id | null }>;
}

// ---- maplab.export v1 ----------------------------------------------------------------------------
export interface ExportManifest {
  readonly format: "maplab.export";
  readonly version: 1;
  readonly entryMapId: Id;
  readonly generator: Readonly<{ name: "MapLab"; version: string }>;
  readonly requiredContracts: readonly ContractRef[];
  readonly documents: readonly Readonly<{ id: Id; format: string; version: number; path: string }>[];
  readonly files: readonly Readonly<{ path: string; bytes: number; sha256: string; role: "authored" | "asset" | "schema" | "derived" | "foreign" }>[];
  readonly externalMaps: readonly Readonly<{ mapId: Id; bundleSha256: string }>[];
}

// ---- maplab.navigation v1: optional, derived, always discardable ---------------------------------
export interface NavState {
  readonly x: Su; readonly y: Su; readonly vx: Su; readonly vy: Su;
  readonly mode: "ground" | "air" | "climb" | "wall" | "ledge" | "swim" | "fly" | "grapple" | "dash";
  readonly supportId: Id | null; readonly traversalId: Id | null;
  readonly resources: readonly Readonly<{ key: string; value: number }>[];
}
export interface NavigationCache {
  readonly format: "maplab.navigation";
  readonly version: 1;
  readonly mapId: Id;
  readonly profileId: Id;
  readonly identity: Readonly<{ sourceSha256: string; profileSha256: string; controller: ContractRef; settingsSha256: string; solvers: readonly ContractRef[] }>;
  /** Generation settings (E3); their JCS digest is `identity.settingsSha256`. */
  readonly settings: Readonly<{
    cellSizeWU: WU; maxFallTicks: Ticks; maxDurationTicks: Ticks; maxActionDepth: number;
    maxCandidatesPerPair: number; jumpHoldTicks: readonly Ticks[]; airControlDelays: readonly Ticks[];
    flightCellWU: WU; checkpointEveryTicks: Ticks;
  }>;
  readonly nodes: readonly Readonly<{ key: string; intervalKey: string | null; state: NavState }>[];
  readonly edges: readonly Readonly<{
    key: string; from: string; to: string; kind: string; solver: ContractRef;
    requiredAbilities: readonly string[]; conditions: readonly Condition[];
    costTicks: Ticks; penaltyTicks: Ticks; witnessKey: string | null;
    sourceIds: readonly Id[]; sweptBounds: Rect; status: "verified" | "conditional";
  }>[];
  readonly witnesses: readonly Readonly<{
    key: string; initial: NavState; terminal: NavState; durationTicks: Ticks;
    inputs: readonly Readonly<{ fromTick: Ticks; moveX: -1 | 0 | 1; moveY: -1 | 0 | 1; run: boolean; jump: boolean; drop: boolean; dash: boolean }>[];
    checkpoints: readonly Readonly<{ tick: Ticks; state: NavState }>[];
  }>[];
}
