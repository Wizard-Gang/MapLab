// ML-005: adopted R1 movement types; ranges and resources are validated separately.
import type { Call, ContractRef, Id, Ratio, Slope, Su, Ticks, Vec2, WU } from './common-types';

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

