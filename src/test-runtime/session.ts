// ML-020: ephemeral Test state. This module has no authoring, storage, rendering or engine dependency.
import { createWorld, step, resolveStance, replayBytes, type ContactMap, type Input, type State, type Step, type World, type RunInput } from '../physics-reference';
import type { MovementDocument } from '../contracts/movement-types';
import { floorDiv, integer } from '../physics-reference/integer';
import type { Entity } from '../contracts/gameplay-types';

export const NEUTRAL: Input = Object.freeze({ moveX: 0, moveY: 0, run: false, jump: false, drop: false });
export const MAX_TICKS = 3_600;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const owned = <T>(value: T): T => freeze(structuredClone(value));
export interface Recording { readonly initial: State; readonly input: readonly RunInput[]; readonly ticks: number }
export interface TestView {
  readonly paused: boolean; readonly state: State; readonly frame: Step;
  readonly frames: readonly Step[]; readonly input: readonly RunInput[];
}

/** Spawn from an authored playerStart. Surface spawns use the same full-body stance as navigation/controller. */
export function spawn(world: World): State {
  const starts = (world.source.entities as unknown as Entity[]).filter(e => e.enabled && e.kind === 'playerStart');
  const start = starts.find(e => e.kind === 'playerStart' && e.default) ?? starts[0];
  if (!start) throw new Error('No enabled playerStart; author one before starting Test');
  const a = start.anchor;
  let x: number, y: number;
  if (a.kind === 'world') [x, y] = a.point.map(n => n * 256) as [number, number];
  else if (a.kind === 'body') {
    const body = world.source.bodies.find(b => b.id === a.bodyId && b.enabled);
    if (!body || body.mobility !== 'static') throw new Error('Unsupported playerStart body');
    x = (body.position[0] + a.point[0]) * 256; y = (body.position[1] + a.point[1]) * 256;
  } else if (a.kind === 'surface') {
    const face = world.faces.find(f => f.supportId === a.footholdId);
    if (!face || a.normalOffset !== 0) throw new Error('Unsupported playerStart surface');
    // Anchor u is authored on the D1 quantum. The runtime foot is always an integer su.
    x = integer(face.a[0] + floorDiv((face.b[0] - face.a[0]) * integer(a.u * 65536), 65536));
    const stance = resolveStance(world, x, a.footholdId)[0];
    if (!stance) throw new Error('PlayerStart has no full-footprint support');
    y = stance.y;
  } else throw new Error('Unsupported playerStart entity anchor');
  const stance = resolveStance(world, x, a.kind === 'surface' ? a.footholdId : undefined).find(v => v.y === y);
  return { x, y, vx: 0, vy: 0, mode: stance ? 'ground' : 'air', supportId: stance?.face.supportId ?? null,
    planeId: stance?.face.planeId ?? world.defaultPlane, facing: start.facing === 'left' ? -1 : 1, tick: 0,
    jumpHeldPrev: false, jumpReleased: false, ticksSinceJump: 0, dropSuppression: null,
    resources: { airJumps: 0, dashCharges: 0, cooldowns: {} }, traversalId: null, climbReady: true };
}

/** Strict bounded schedule; failed imports leave the existing run untouched. */
export function parseRecording(value: unknown): Recording {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected recording object');
  const r = value as Recording;
  if (Object.keys(r).sort().join(',') !== 'initial,input,ticks' || !r.initial || typeof r.initial !== 'object' ||
    !Number.isSafeInteger(r.initial.tick) || r.initial.tick < 0 || !Number.isSafeInteger(r.ticks) || r.ticks < 1 || r.ticks > MAX_TICKS || !Number.isSafeInteger(r.initial.tick + r.ticks) ||
    !Array.isArray(r.input) || !r.input.length || r.input.length > r.ticks) throw new Error('Invalid recording or tick budget');
  for (let i = 0; i < r.input.length; i++) {
    const v = r.input[i]!;
    if (!v || typeof v !== 'object' || Object.keys(v).sort().join(',') !== 'drop,fromTick,jump,moveX,moveY,run' ||
      !Number.isSafeInteger(v.fromTick) || (i === 0 ? v.fromTick !== r.initial.tick : v.fromTick <= r.input[i - 1]!.fromTick) ||
      v.fromTick >= r.initial.tick + r.ticks || ![-1,0,1].includes(v.moveX) || ![-1,0,1].includes(v.moveY!) ||
      typeof v.run !== 'boolean' || typeof v.jump !== 'boolean' || typeof v.drop !== 'boolean') throw new Error('Invalid input schedule');
  }
  return owned(r);
}

export class TestSession {
  readonly source: ContactMap;
  readonly profile: MovementDocument;
  readonly initial: State;
  private readonly world: World;
  private view: TestView;
  private runInitial: State;
  private readonly listeners = new Set<() => void>();
  constructor(source: ContactMap, profile: MovementDocument, initial?: State) {
    this.source = owned(source); this.profile = owned(profile);
    this.world = freeze(createWorld(this.source, this.profile));
    this.initial = owned(initial ?? spawn(this.world));
    this.runInitial = this.initial;
    this.validateInitial(this.initial);
    this.view = this.empty(this.initial);
  }
  private validateInitial(state: State): void {
    if (state.traversalId === undefined || state.jumpHeldPrev === undefined) throw new Error('Test requires complete climb/locomotion state');
    const probe = step(this.world, state, NEUTRAL);
    if (probe.status !== 'ok') throw new Error(`${probe.status}: ${probe.reason ?? 'initial state'}`);
  }
  private empty(state: State): TestView { return owned({ paused: true, state, frame: { status: 'ok', state, contacts: [] }, frames: [], input: [] }); }
  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  readonly getSnapshot = (): TestView => this.view;
  private set(view: TestView): void { this.view = Object.freeze({ ...view, frames: Object.freeze(view.frames), input: Object.freeze(view.input) }); for (const l of this.listeners) l(); }
  pause(paused = true): void { this.set({ ...this.view, paused: paused || this.view.frame.status !== 'ok' || this.view.frames.length >= MAX_TICKS }); }
  reset(): void { this.runInitial = this.initial; this.set(this.empty(this.initial)); }
  advance(input: Input = NEUTRAL): Step {
    if (this.view.frame.status !== 'ok' || this.view.frames.length >= MAX_TICKS) { this.pause(); return this.view.frame; }
    const controls = owned(input), frame = owned(step(this.world, this.view.state, controls));
    const last = this.view.input.at(-1), { fromTick: _, ...previous } = last ?? { fromTick: 0 };
    const schedule = last && replayBytes(previous) === replayBytes(controls) ? this.view.input : [...this.view.input, Object.freeze({ ...controls, fromTick: this.view.state.tick })];
    this.set({ paused: this.view.paused || frame.status !== 'ok' || this.view.frames.length + 1 >= MAX_TICKS, state: frame.state, frame,
      frames: [...this.view.frames, frame], input: schedule });
    return frame;
  }
  recording(): Recording { return owned({ initial: this.view.frames[0] ? this.runInitial : this.view.state, input: this.view.input, ticks: this.view.frames.length }); }
  replay(value: unknown): void {
    const r = parseRecording(value); this.validateInitial(r.initial);
    // Build atomically so an invalid input never destroys the current recording.
    const run = new TestSession(this.source, this.profile, r.initial);
    let index = 0;
    for (let n = 0; n < r.ticks; n++) {
      while (r.input[index + 1] && r.input[index + 1]!.fromTick <= run.view.state.tick) index++;
      const { fromTick: _, ...input } = r.input[index]!;
      if (run.advance(input).status !== 'ok') break;
    }
    this.runInitial = r.initial; this.set({ ...run.view, paused: true });
  }
}
