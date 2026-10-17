// Diagnostic shape from specification F3 (R1): a stable code plus where the problem is.
// ML-003 emits errors only; world bounds and repairs arrive with geometry (ML-004+).

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  readonly code: string;
  readonly severity: Severity;
  readonly documentId: string | null;
  readonly objectId: string | null;
  /** Normalized JSONPath of the offending value, e.g. `$.dependencies[0].path`. */
  readonly jsonPath: string;
  readonly worldBounds: null;
  readonly message: string;
}

export type PathSegment = string | number;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function jsonPath(segments: readonly PathSegment[]): string {
  let out = '$';
  for (const segment of segments) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else if (IDENTIFIER.test(segment)) out += `.${segment}`;
    else out += `[${JSON.stringify(segment)}]`;
  }
  return out;
}

export function error(
  code: string,
  path: readonly PathSegment[],
  message: string,
  documentId: string | null = null,
  objectId: string | null = null,
): Diagnostic {
  return { code, severity: 'error', documentId, objectId, jsonPath: jsonPath(path), worldBounds: null, message };
}
