// Contract support is distinct from implementation availability and numerical conformance.
import registry from '../../contracts/maplab.reference-controller.v1.capabilities.json' with { type: 'json' };
import { error, type Diagnostic } from './diagnostics';
import type { ContractRef } from './common-types';
import type { Ability, MovementDocument } from './movement-types';

export interface ControllerCapabilities {
  readonly format: 'maplab.controller-capabilities'; readonly version: 1;
  readonly controller: ContractRef; readonly collision: ContractRef;
  readonly units: MovementDocument['units']; readonly arithmetic: 'safeInteger';
  readonly colliders: readonly MovementDocument['collider']['kind'][];
  readonly support: readonly MovementDocument['support'][];
  readonly collisionCategoryPolicy: 'explicitKeysWithSymmetricMasks';
  readonly runtimeImplemented: false; readonly canCertify: false;
  readonly maximumAdditionalAirJumps: number;
  readonly abilities: readonly Readonly<{ kind: Ability['kind']; mode: 'ground' | 'air' | null;
    contractSupported: boolean; implementationTask: string }>[];
  readonly resourceRules: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly unsupportedSolvers: Readonly<{ policy: string; externalSolverLoading: false }>;
}

function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
export const REFERENCE_CAPABILITIES: ControllerCapabilities = immutable(registry) as unknown as ControllerCapabilities;
export interface MovementCompatibility {
  readonly contractSupported: boolean;
  readonly runtimeImplemented: false;
  readonly canCertify: false;
  readonly diagnostics: readonly Diagnostic[];
}

/** Applies only the published reference contract; no extension code is loaded or executed. */
export function assessMovementCapabilities(profile: MovementDocument): MovementCompatibility {
  const r = REFERENCE_CAPABILITIES, diagnostics: Diagnostic[] = [];
  const unsupported = (code: string, path: (string | number)[], message: string): void => {
    diagnostics.push(error(`movement.unsupported-${code}`, path, message, profile.id));
  };
  if (profile.controller.key !== r.controller.key || profile.controller.version !== r.controller.version) {
    unsupported('controller', ['controller'], `No capability registry for ${profile.controller.key} v${profile.controller.version}`);
  } else {
    if (!r.colliders.includes(profile.collider.kind)) unsupported('collider', ['collider'], `${profile.collider.kind} is declared but unsupported by controller v1`);
    if (!r.support.includes(profile.support)) unsupported('support', ['support'], `${profile.support} is declared but unsupported by controller v1`);
    profile.abilities.forEach((a, i) => {
      const entry = r.abilities.find((e) => e.kind === a.kind && e.mode === (a.kind === 'dash' ? a.mode : null));
      if (!entry?.contractSupported) {
        const solver = 'solver' in a ? `; solver ${a.solver.key} v${a.solver.version} is not registered` : '';
        unsupported('ability', ['abilities', i], `${a.kind}${a.kind === 'dash' ? ` (${a.mode})` : ''} is configured, not simulated${solver}; implementation: ${entry?.implementationTask ?? 'unregistered'}`);
      }
      if (a.kind === 'jump' && a.airJumps > r.maximumAdditionalAirJumps) unsupported('air-jumps', ['abilities', i, 'airJumps'], 'Additional airborne jumps require ML-033; they never certify under the v1 base contract');
    });
  }
  return immutable({ contractSupported: diagnostics.length === 0, runtimeImplemented: false, canCertify: false, diagnostics });
}
