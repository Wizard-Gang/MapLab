// Shared inputs for the ML-008 document-model and history tests: the unchanged R1 forest source maps.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Cell, JsonValue } from '../src/contracts';
import { normalize, type MapModel } from '../src/domain/model';

export const root = resolve(import.meta.dirname, '..');
export const R1_MAPS = 'docs/specifications/2026-10-17-maplab-r1/examples/forest/maps';

export const readDocument = (path: string): JsonValue => JSON.parse(readFileSync(join(root, path), 'utf8')) as JsonValue;
export const forestDocument = (): JsonValue => readDocument(`${R1_MAPS}/forest.map.json`);

export function modelOf(document: JsonValue): MapModel {
  const result = normalize(document);
  if (!result.ok) throw new Error(`Fixture does not normalize: ${JSON.stringify(result.problems)}`);
  return result.model;
}
export const forestModel = (): MapModel => modelOf(forestDocument());

export const cell = (tileId: string, quarterTurns: Cell['quarterTurns'] = 0, mirrorX = false, mirrorY = false): Cell => ({ tileId, quarterTurns, mirrorX, mirrorY });

/** Small deterministic PRNG for replay properties (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
