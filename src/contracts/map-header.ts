// `maplab.map` v1 header and base subset (ML-003): format dispatch, closed schema, then
// semantic rules the schema cannot express. Geometry, layers, gameplay, camera, environment
// and navigation members are only type-checked here and are reported as deferred.
import mapSchema from '../../schemas/maplab.map.v1.schema.json';
import { error, type Diagnostic, type PathSegment } from './diagnostics';
import {
  ASSET_EXTENSIONS, COORDINATE_LIMIT, DEPENDENCY_EXTENSIONS, checkSafePath, pathAliasKey,
} from './grammar';
import { parseJson, type JsonLimits, type JsonValue } from './json';
import { compileSchema, evaluate } from './schema';

export type DependencyKind = keyof typeof DEPENDENCY_EXTENSIONS;
export type AssetMediaType = keyof typeof ASSET_EXTENSIONS;
export interface ContractRef { readonly key: string; readonly version: number }
export interface Dependency { readonly id: string; readonly kind: DependencyKind; readonly path: string; readonly required: boolean }
export interface Asset {
  readonly id: string; readonly path: string; readonly mediaType: AssetMediaType;
  readonly wuPerAssetUnit: number; readonly size: readonly [number, number];
}
export interface MapHeader {
  readonly format: 'maplab.map';
  readonly version: 1;
  readonly id: string;
  readonly metadata: Readonly<{ name: string; description: string; authors: readonly string[]; license: string; tags: readonly string[] }>;
  readonly requiredFeatures: readonly ContractRef[];
  readonly coordinates: Readonly<{ units: 'WU'; x: 'right'; y: 'down'; rotation: 'clockwiseDegrees'; quantum: 0.0625; ticksPerSecond: 60 }>;
  readonly bounds: readonly [number, number, number, number];
  readonly collisionContract: ContractRef;
  readonly dependencies: readonly Dependency[];
  readonly assets: readonly Asset[];
}

const BASE_MEMBERS = ['format', 'version', 'id', 'metadata', 'requiredFeatures', 'coordinates', 'bounds',
  'collisionContract', 'dependencies', 'assets'] as const;
/** Members ML-004…ML-006 validate; ML-003 checks only that they exist with the right JSON type. */
export const DEFERRED_MEMBERS = Object.freeze(['presentations', 'layers', 'terrain', 'visuals', 'materials', 'bodies',
  'footholds', 'traversals', 'regions', 'entities', 'waypoints', 'routes', 'triggers', 'encounters', 'camera',
  'environment', 'navigation', 'flags', 'prefabPlacements'] as const);

/** Named semantic contracts a map may require (R1 F1); anything else fails closed. */
export const SUPPORTED_CONTRACTS: ReadonlyMap<string, readonly number[]> = new Map([
  ['maplab.collision', [1]], ['maplab.climb', [1]], ['maplab.camera', [1]], ['maplab.reference-controller', [1]],
]);

export const MAP_SCHEMA = compileSchema(mapSchema as JsonValue, 'map');

export type MapHeaderResult =
  | { readonly ok: true; readonly header: MapHeader; readonly deferred: readonly string[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** Bounded parse, then validation. Returns either a frozen header or diagnostics, never both. */
export function loadMapHeader(input: Uint8Array | string, limits?: JsonLimits): MapHeaderResult {
  const parsed = parseJson(input, limits);
  return parsed.ok ? validateMapHeader(parsed.value) : { ok: false, diagnostics: [parsed.diagnostic] };
}

/** Validates an already parsed value without mutating it. */
export function validateMapHeader(value: JsonValue): MapHeaderResult {
  const dispatch = checkFormat(value);
  if (dispatch) return { ok: false, diagnostics: [dispatch] };
  const structural = evaluate(MAP_SCHEMA, value);
  if (structural.length > 0) return { ok: false, diagnostics: structural };
  const document = value as unknown as MapHeader;
  const semantic = checkSemantics(document);
  if (semantic.length > 0) return { ok: false, diagnostics: semantic };
  const header = Object.fromEntries(BASE_MEMBERS.map((key) => [key, structuredClone(document[key])]));
  return { ok: true, header: deepFreeze(header) as unknown as MapHeader, deferred: DEFERRED_MEMBERS };
}

function checkFormat(value: JsonValue): Diagnostic | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return error('format.not-object', [], 'A map document must be a JSON object');
  if (!Object.hasOwn(value, 'format')) return error('format.missing', ['format'], 'Missing "format" header');
  if (value.format !== 'maplab.map') return error('format.mismatch', ['format'], `Expected format "maplab.map", found ${JSON.stringify(value.format)}`);
  if (!Object.hasOwn(value, 'version')) return error('format.missing', ['version'], 'Missing "version" header');
  if (value.version !== 1) return error('format.unsupported-version', ['version'], `Unsupported maplab.map version ${JSON.stringify(value.version)}; this reader accepts exactly 1`);
  return null;
}

function checkSemantics(doc: MapHeader): Diagnostic[] {
  const out: Diagnostic[] = [];
  const report = (code: string, path: readonly PathSegment[], message: string, objectId: string | null = null): void => {
    out.push(error(code, path, message, doc.id, objectId));
  };
  const [x, y, width, height] = doc.bounds;
  doc.bounds.forEach((v, i) => { if (Object.is(v, -0)) report('number.negative-zero', ['bounds', i], 'Negative zero must be written as 0'); });
  if (x + width > COORDINATE_LIMIT) report('bounds.range', ['bounds', 2], `Right edge ${x + width} exceeds ${COORDINATE_LIMIT} WU`);
  if (y + height > COORDINATE_LIMIT) report('bounds.range', ['bounds', 3], `Bottom edge ${y + height} exceeds ${COORDINATE_LIMIT} WU`);

  const features = new Set<string>();
  doc.requiredFeatures.forEach((feature, i) => {
    if (features.has(feature.key)) report('feature.duplicate', ['requiredFeatures', i, 'key'], `Contract ${feature.key} is required twice`);
    features.add(feature.key);
    if (!SUPPORTED_CONTRACTS.get(feature.key)?.includes(feature.version)) {
      report('feature.unsupported', ['requiredFeatures', i], `Required contract ${feature.key} v${feature.version} is not supported`);
    }
  });
  const collision = doc.collisionContract;
  if (collision.key !== 'maplab.collision' || !SUPPORTED_CONTRACTS.get(collision.key)?.includes(collision.version)) {
    report('collision.unsupported', ['collisionContract'], `Collision contract ${collision.key} v${collision.version} is not supported`);
  }

  const paths = new Map<string, string>();
  const checkPath = (path: string, at: readonly PathSegment[], objectId: string): void => {
    const problem = checkSafePath(path);
    if (problem) report(`path.${problem}`, at, `Unsafe path ${JSON.stringify(path)} (${problem})`, objectId);
    const prior = paths.get(pathAliasKey(path));
    if (prior !== undefined) report('path.alias', at, `Path ${JSON.stringify(path)} aliases ${JSON.stringify(prior)}`, objectId);
    else paths.set(pathAliasKey(path), path);
  };
  const dependencies = new Set<string>();
  doc.dependencies.forEach((dependency, i) => {
    if (dependency.id === doc.id) report('dependency.self', ['dependencies', i, 'id'], 'A map cannot depend on itself', dependency.id);
    else if (dependencies.has(dependency.id)) report('dependency.duplicate', ['dependencies', i, 'id'], `Dependency ${dependency.id} is listed twice`, dependency.id);
    dependencies.add(dependency.id);
    const extension = DEPENDENCY_EXTENSIONS[dependency.kind];
    if (!dependency.path.endsWith(extension)) report('dependency.extension', ['dependencies', i, 'path'], `A ${dependency.kind} dependency path must end with ${extension}`, dependency.id);
    checkPath(dependency.path, ['dependencies', i, 'path'], dependency.id);
  });
  const assets = new Set<string>();
  doc.assets.forEach((asset, i) => {
    if (assets.has(asset.id)) report('id.duplicate', ['assets', i, 'id'], `ID ${asset.id} is used twice`, asset.id);
    assets.add(asset.id);
    const extension = ASSET_EXTENSIONS[asset.mediaType];
    if (!asset.path.endsWith(extension)) report('asset.extension', ['assets', i, 'path'], `A ${asset.mediaType} asset path must end with ${extension}`, asset.id);
    checkPath(asset.path, ['assets', i, 'path'], asset.id);
    const problem = assetSizeProblem(asset);
    if (problem) report('asset.size', ['assets', i, 'size'], problem, asset.id);
  });
  return out;
}

function assetSizeProblem({ mediaType, size }: Asset): string | null {
  if (size.some((v) => Object.is(v, -0))) return 'Negative zero must be written as 0';
  if (mediaType.startsWith('audio/')) return size[0] === 0 && size[1] === 0 ? null : 'Audio assets declare size [0, 0]';
  if (mediaType === 'image/svg+xml') return size[0] > 0 && size[1] > 0 ? null : 'SVG viewBox size must be positive';
  return size.every((v) => Number.isInteger(v) && v >= 1 && v <= 4096) ? null : 'Raster size must be whole pixels from 1 to 4096';
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
