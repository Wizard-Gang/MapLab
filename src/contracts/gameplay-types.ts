// MapLab R1 contract sketch: gameplay, camera, environment, navigation intent, presentation.
// Durations are integer ticks at 60 Hz (D1). Data only: validation does not execute engine behavior.
import type { Anchor, Call, Color, Condition, ContractRef, Id, Ratio, Rect, RegionShape, Ticks, Vec2 } from "./common-types";

export interface Region {
  readonly id: Id;
  readonly name: string;
  readonly shape: RegionShape;
  readonly role:
    | "trigger" | "encounter" | "audio" | "camera" | "patrol" | "pursuit" | "leash" | "aggro"
    | "swim" | "flight" | "launch" | "hazard" | "environment" | "checkpoint";
}
export interface Waypoint {
  readonly id: Id;
  readonly anchor: Anchor;
  readonly waitTicks: Ticks;
}
export interface Route {
  readonly id: Id;
  readonly waypointIds: readonly Id[];
  readonly mode: "once" | "loop" | "pingPong";
  readonly requiredAbilities: readonly string[];
  readonly conditions: readonly Condition[];
}
export interface Respawn {
  readonly mode: "never" | "timer" | "checkpoint" | "event";
  readonly delayTicks: Ticks;
  readonly maxAlive: number;
  readonly event: ContractRef | null;
}
export interface AIConfig {
  readonly behavior: Call; // catalog kind "behavior"
  readonly routeId: Id | null;
  readonly guard: Anchor | null;
  readonly patrolRegionId: Id | null;
  readonly pursuitRegionId: Id | null;
  readonly home: Anchor;
  readonly leashRegionId: Id | null;
  readonly aggroRegionId: Id | null;
  readonly invalidRoute: "wait" | "safeStop" | "returnHome" | "registeredFallback";
  readonly fallback: Call | null;
}
interface EntityBase {
  readonly id: Id;
  readonly name: string;
  readonly anchor: Anchor;
  readonly enabled: boolean;
  readonly facing: "left" | "right";
  readonly visualId: Id | null;
  readonly presentationId: Id | null; // optional RigLab binding (G3)
}
export type Destination = Readonly<{ mapId: Id; entityId: Id }>;
export type Entity = EntityBase & (
  | Readonly<{ kind: "playerStart"; movementId: Id; default: boolean }>
  | Readonly<{ kind: "checkpoint"; regionId: Id; activate: Call }>
  | Readonly<{ kind: "enemySpawn" | "npc"; archetype: Call; movementId: Id; ai: AIConfig; respawn: Respawn; groupId: Id | null }>
  | Readonly<{ kind: "portal"; regionId: Id; activation: "touch" | "interact"; destination: Destination; delayTicks: Ticks; conditions: readonly Condition[] }>
  | Readonly<{ kind: "door"; bodyIds: readonly Id[]; interaction: Call; destination: Destination | null }>
  | Readonly<{ kind: "building" | "chest" | "destructible" | "pickup" | "interactive"; archetype: Call; bodyIds: readonly Id[]; interaction: Call | null }>
  | Readonly<{ kind: "hazard"; regionId: Id; effect: Call }>
  | Readonly<{ kind: "questMarker" | "objective" | "cutsceneMarker"; definition: Call }>
);
export interface Trigger {
  readonly id: Id;
  readonly regionId: Id;
  readonly event: "enter" | "exit" | "interact";
  readonly actorCategories: readonly ("player" | "enemy" | "npc")[];
  readonly once: boolean;
  readonly conditions: readonly Condition[];
  readonly actions: readonly Call[]; // applied in order at the end-of-tick boundary
}
export interface Encounter {
  readonly id: Id;
  readonly regionId: Id;
  readonly groupId: Id;
  readonly spawnIds: readonly Id[];
  readonly waves: readonly ContractRef[];
  readonly completionEvent: ContractRef;
  readonly onComplete: readonly Call[];
}

// ---- Camera (C6, adopted C4) --------------------------------------------------------------------
export interface CameraSettings {
  readonly viewWU: Vec2;
  readonly zoom: number;
  readonly bounds: Rect; // constrains the visible rectangle, not the target point
  readonly followX: boolean;
  readonly followY: boolean;
  readonly deadZone: Rect; // normalized view fractions, 1/256 quantum
  readonly dampingTicks: Vec2;
  readonly lookaheadWU: Vec2;
  /** "platformSnap" = Keren's platform snapping + window; "climbFollow" overrides on climb paths. */
  readonly verticalPolicy: "continuous" | "platformSnap" | "locked";
  readonly climbFollow: boolean;
  readonly transitionTicks: Ticks;
  readonly transition: "linear" | "smoothstep";
}
export interface CameraConfig {
  readonly model: ContractRef; // e.g. maplab.camera v1 (reference preview, not engine parity)
  readonly defaults: CameraSettings;
  readonly zones: readonly Readonly<{ id: Id; regionId: Id; priority: number; settings: CameraSettings }>[];
  readonly shakeEffects: readonly ContractRef[];
}

// ---- Environment ---------------------------------------------------------------------------------
export type EnvironmentZone =
  | Readonly<{ id: Id; kind: "audio"; regionId: Id; priority: number; trackAssetId: Id; loop: boolean; fadeTicks: Ticks }>
  | Readonly<{ id: Id; kind: "transition"; regionId: Id; priority: number; effect: Call }>
  | Readonly<{ id: Id; kind: "movementModifier"; regionId: Id; modifier: Call }>
  | Readonly<{ id: Id; kind: "launch"; regionId: Id; impulse: readonly [number, number]; actorCategories: readonly ("player" | "enemy" | "npc")[]; cooldownTicks: Ticks }>;
export interface Environment {
  readonly ambientColor: Color;
  readonly effects: readonly Call[];
  readonly zones: readonly EnvironmentZone[];
}

// ---- Navigation intent (E) -----------------------------------------------------------------------
export interface NavigationIntent {
  readonly modeVolumes: readonly Readonly<{ id: Id; regionId: Id; mode: "fly" | "swim"; profileIds: readonly Id[] }>[];
  readonly links: readonly Readonly<{
    id: Id; from: Anchor; to: Anchor; action: Call; requiredAbilities: readonly string[];
    conditions: readonly Condition[]; bidirectional: boolean; extraCostTicks: Ticks;
  }>[];
  readonly overrides: readonly Readonly<{
    id: Id; regionId: Id; profileIds: readonly Id[]; actions: readonly string[];
    policy: "forbid" | "penalize"; penaltyTicks: Ticks;
  }>[];
}

// ---- RigLab presentation binding (G3) ------------------------------------------------------------
export interface RigPresentationBinding {
  readonly id: Id;
  readonly kind: "riglab";
  readonly bundleDependencyId: Id;
  readonly expectedExportVersion: 1;
  readonly rigGroundAnchor: Vec2; // rig-space point placed at the actor's foot reference
  readonly worldUnitsPerRigUnit: Ratio;
  readonly nativeFacing: "left" | "right";
  readonly rootMotion: "visualOnly";
  /** R1: draw art feet on the support line under the foot x while grounded (no physics effect). */
  readonly groundContact: "supportLine" | "footReference";
  readonly artSlots: readonly Readonly<{ slot: string; assetId: Id; pivot: Vec2 }>[];
  readonly actions: readonly Readonly<{ semantic: string; animation: string | null; fallbackSemantic: string | null }>[];
}
