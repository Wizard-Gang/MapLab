// ML-005: full movement syntax and resources, without a physics or ability solver.
import movementSchema from '../../schemas/maplab.movement.v1.schema.json' with { type: 'json' };
import { error, type Diagnostic } from './diagnostics';
import { isId } from './grammar';
import { parseJson, type JsonLimits, type JsonValue } from './json';
import { canonical, compileSchema, evaluate } from './schema';
import { assessMovementCapabilities, type MovementCompatibility } from './capabilities';
import type { MovementDocument } from './movement-types';

export const MOVEMENT_SCHEMA = compileSchema(movementSchema as JsonValue, 'movement');
export type MovementResult =
  | { readonly ok: true; readonly document: MovementDocument; readonly compatibility: MovementCompatibility; readonly deferred: readonly string[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}

export function loadMovement(input: Uint8Array | string, limits?: JsonLimits): MovementResult {
  const parsed = parseJson(input, limits);
  return parsed.ok ? validateMovement(parsed.value) : { ok: false, diagnostics: [parsed.diagnostic] };
}

/** Unsupported capabilities remain explicit even when all authored fields are structurally valid. */
export function validateMovement(value: JsonValue): MovementResult {
  const id = value !== null && typeof value === 'object' && !Array.isArray(value) && isId(value.id) ? value.id : null;
  const diagnostics = evaluate(MOVEMENT_SCHEMA, value).map((d) => ({ ...d, documentId: id }));
  if (diagnostics.length) return { ok: false, diagnostics };
  const profile = value as unknown as MovementDocument;
  const report = (rule: string, path: (string | number)[], message: string): void => {
    diagnostics.push(error(`movement.${rule}`, path, message, profile.id));
  };
  if (profile.collider.kind === 'capsule' && profile.collider.height < profile.collider.radius * 2) report('capsule-height', ['collider', 'height'], 'Capsule height must include both end caps');
  if (profile.drop.canDrop && profile.drop.timeoutTicks === 0) report('drop-timeout', ['drop', 'timeoutTicks'], 'Enabled drop suppression needs a positive timeout');
  const seen = new Set<string>();
  profile.abilities.forEach((a, i) => {
    const key = a.kind === 'dash' ? `${a.kind}:${a.mode}` : a.kind;
    if (seen.has(key)) report('duplicate-ability', ['abilities', i], `Ability ${key} is enabled twice`);
    seen.add(key);
    if (a.kind === 'jump' && a.release.num > a.release.den) report('jump-release', ['abilities', i, 'release'], 'Release must not increase upward velocity');
    if (a.kind === 'climb' && !a.ladder && !a.rope) report('climb-permissions', ['abilities', i], 'A climb entry needs a ladder or rope permission; omit it to disable climbing');
    if (a.kind === 'dash' && a.reset === 'timer' && a.cooldownTicks === 0) report('dash-reset', ['abilities', i, 'cooldownTicks'], 'Timer charge recovery requires a positive cooldown');
    if (a.kind === 'grapple' && (a.lengthRange[0] > a.lengthRange[1] || a.lengthRange[1] > a.range)) report('grapple-length', ['abilities', i, 'lengthRange'], 'Rope lengths must be ordered and within grapple range');
    if (a.kind === 'modifier') {
      const refs = new Set<string>();
      a.allowed.forEach((r, j) => {
        const k = `${r.key}:${r.version}`;
        if (refs.has(k)) report('duplicate-modifier', ['abilities', i, 'allowed', j], 'Modifier references must be unique');
        refs.add(k);
      });
    }
  });
  if (diagnostics.length) return { ok: false, diagnostics };
  const document = immutable(structuredClone(profile));
  return { ok: true, document, compatibility: assessMovementCapabilities(document),
    deferred: Object.freeze(profile.abilities.some((a) => ['registered', 'ledge', 'modifier'].includes(a.kind))
      ? ['catalog definitions, parameter field closure and typed reference resolution'] : []) };
}

export class MovementValidationError extends Error {
  readonly diagnostics: readonly Diagnostic[];
  constructor(diagnostics: readonly Diagnostic[]) { super('Invalid movement profile'); this.diagnostics = diagnostics; }
}

/** Domain normalization precedes RFC 8785 property/number serialization; sequences stay ordered. */
export function movementProfileJcs(profile: MovementDocument): string {
  const checked = validateMovement(profile as unknown as JsonValue);
  if (!checked.ok) throw new MovementValidationError(checked.diagnostics);
  const p = checked.document;
  const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
  const normalized = { ...p, mask: [...p.mask].sort(), abilityTags: [...p.abilityTags].sort(), forbiddenMaterialTags: [...p.forbiddenMaterialTags].sort(),
    abilities: p.abilities.map((a) => a.kind === 'wall' ? { ...a, permissions: [...a.permissions].sort() }
      : a.kind === 'modifier' ? { ...a, allowed: [...a.allowed].sort((x, y) => compare(x.key, y.key) || x.version - y.version) } : a)
      .sort((a, b) => compare(a.kind, b.kind) || compare('mode' in a ? a.mode : '', 'mode' in b ? b.mode : '')) };
  const text = canonical(normalized as unknown as JsonValue);
  const parsed = parseJson(text);
  if (!parsed.ok) throw new MovementValidationError([parsed.diagnostic]);
  return text;
}

/** SHA-256 of the complete canonical UTF-8 profile, without a trailing newline. */
export async function movementProfileDigest(profile: MovementDocument): Promise<string> {
  const bytes = new TextEncoder().encode(movementProfileJcs(profile));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
