// Scalar grammar of R1 (specification D1, F1, F3 and H4): identities, the coordinate
// quantum and range, integer ticks and safe bundle-relative paths. Pure predicates.

/** Persistent IDs and catalog keys share one grammar (R1 F3). */
export const ID_PATTERN = '^[a-z0-9][a-z0-9._:-]{0,95}$';
const ID = new RegExp(ID_PATTERN);

export const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
export const isCatalogKey = isId;

/** Authored quantum q = 1/16 WU and range |v| ≤ 2^17 WU, so n·q with |n| ≤ 2^21 is binary32-exact. */
export const COORDINATE_QUANTUM = 0.0625;
export const COORDINATE_LIMIT = 131_072;
/** Lengths may span the whole range: 2^18 WU. */
export const LENGTH_LIMIT = 2 * COORDINATE_LIMIT;
/** Controller sub-units (R1 RC1) and the authored clock (D1). */
export const SUBUNITS_PER_WU = 256;
export const TICKS_PER_SECOND = 60;

const onQuantum = (v: number): boolean => Number.isInteger(v / COORDINATE_QUANTUM);

/** An authored coordinate: finite, on the 1/16 WU quantum, within ±131,072 WU, never −0. */
export function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
    && onQuantum(value) && Math.abs(value) <= COORDINATE_LIMIT;
}

/** A positive authored length (width, height, size) on the quantum, at most 2^18 WU. */
export function isLength(value: unknown): value is number {
  return typeof value === 'number' && value > 0 && value <= LENGTH_LIMIT && onQuantum(value);
}

/** Integer controller sub-units for an authored coordinate; exact by construction. */
export function toSubunits(coordinate: number): number {
  if (!isCoordinate(coordinate)) throw new RangeError(`Not an authored coordinate: ${coordinate}`);
  return coordinate * SUBUNITS_PER_WU;
}

/** An authored duration: a non-negative safe integer number of 60 Hz ticks. */
export function isTicks(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

/**
 * Bundle-root-relative POSIX path: POSIX portable filename characters only, no empty, `.`,
 * `..`, hidden, leading-hyphen or trailing-dot components. Written without lookaround so
 * independent JSON Schema validators (including RE2-based ones) evaluate it identically.
 */
export const SAFE_PATH_PATTERN = '^[A-Za-z0-9_](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?(?:/[A-Za-z0-9_](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?)*$';
export const MAX_PATH_BYTES = 240;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

export type PathProblem =
  | 'type' | 'length' | 'absolute' | 'scheme' | 'backslash' | 'charset' | 'empty-component'
  | 'dot-component' | 'hidden-component' | 'leading-hyphen' | 'trailing-dot' | 'reserved-name';

/** Explains why a path is unsafe, or returns null. Agrees with SAFE_PATH_PATTERN plus device names. */
export function checkSafePath(path: unknown): PathProblem | null {
  if (typeof path !== 'string') return 'type';
  if (path.length === 0 || path.length > MAX_PATH_BYTES) return 'length';
  if (path.startsWith('/')) return 'absolute';
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return 'scheme';
  if (path.includes('\\')) return 'backslash';
  if (!/^[A-Za-z0-9._/-]+$/.test(path)) return 'charset';
  for (const component of path.split('/')) {
    if (component === '') return 'empty-component';
    if (component === '.' || component === '..') return 'dot-component';
    if (component.startsWith('.')) return 'hidden-component';
    if (component.startsWith('-')) return 'leading-hyphen';
    if (component.endsWith('.')) return 'trailing-dot';
    if (RESERVED.test((component.split('.')[0] ?? '').toLowerCase())) return 'reserved-name';
  }
  return null;
}

/** Two paths alias when they differ only by ASCII case (case-insensitive file systems). */
export const pathAliasKey = (path: string): string => path.toLowerCase();

/** The approved extension for each asset media type (specification H4). */
export const ASSET_EXTENSIONS = Object.freeze({
  'image/png': '.png',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
} as const);

/** Descriptive extension for each dependency kind (specification F1). */
export const DEPENDENCY_EXTENSIONS = Object.freeze({
  map: '.map.json',
  tileset: '.tileset.json',
  prefab: '.prefab.json',
  movement: '.movement.json',
  catalog: '.catalog.json',
  riglab: '.json',
} as const);
