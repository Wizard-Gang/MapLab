// One open map document and the library-facing operations on it (adopted C1, R1 C2/H2): open into a staging
// model, rename, Save As/Duplicate under a new identity, New map from a valid template, and the digest of the
// library form that dirty state and saves compare. Pure apart from Web Crypto digests: no DOM, storage or network.
import { parseJson, type JsonValue } from '../contracts';
import { fieldOp, transaction } from '../domain/commands';
import { denormalize, isObject, normalize, setOwn, type JsonObject, type MapModel, type ModelProblem } from '../domain/model';
import { sha256Hex } from '../library/digest';
import { documentPath } from '../library/layout';
import { libraryForm } from '../library/library-form';
import { commit, noteDigest, openDocument, type CommitResult, type DocumentState } from './history';

/** The exact bytes Save writes for `model`. */
export const modelText = (model: MapModel): string => libraryForm(denormalize(model) as JsonValue);
export const modelDigest = (model: MapModel): Promise<string> => sha256Hex(modelText(model));

export type Staged = { readonly ok: true; readonly model: MapModel } | { readonly ok: false; readonly problems: readonly ModelProblem[] };

/** Parses and normalizes file bytes into a staging model; the active document is replaced only on success. */
export function stageMap(text: string): Staged {
  const parsed = parseJson(text);
  if (!parsed.ok) return { ok: false, problems: [{ code: parsed.diagnostic.code, path: parsed.diagnostic.jsonPath, message: parsed.diagnostic.message }] };
  return normalize(parsed.value);
}

/** Opens a staged model read from a file with `fileDigest`: clean, with its library-form digest as the saved digest. */
export async function openFromFile(model: MapModel, fileDigest: string): Promise<DocumentState> {
  return openDocument(model, { savedDigest: await modelDigest(model), baseDigest: fileDigest });
}

/** Records the digest of the current content, so dirty state is decided by digest (R1 H3). */
export async function refreshDigest(s: DocumentState): Promise<DocumentState> {
  return noteDigest(s, s.contentId, await modelDigest(s.model));
}

export const mapName = (model: MapModel): string => {
  const metadata = model.fields.get('metadata');
  return isObject(metadata) && typeof metadata.name === 'string' ? metadata.name : model.id;
};

/** Renames the map (`metadata.name`) as one undoable entry; the same name records nothing. */
export function renameMap(s: DocumentState, name: string): CommitResult {
  const metadata = s.model.fields.get('metadata');
  if (!isObject(metadata)) return { outcome: 'noop', state: s };
  const next: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(metadata)) setOwn(next, k, v);
  setOwn(next, 'name', name);
  return commit(s, transaction('Rename map', [fieldOp(s.model, 'metadata', next)]));
}

function retargetMap(v: JsonValue, from: string, to: string): JsonValue {
  if (Array.isArray(v)) return v.map((x) => retargetMap(x, from, to));
  if (!isObject(v)) return v;
  const out: Record<string, JsonValue> = {};
  for (const [k, x] of Object.entries(v)) setOwn(out, k, k === 'mapId' && x === from ? to : retargetMap(x, from, to));
  return out;
}

export type DuplicateResult = { readonly ok: true; readonly model: MapModel; readonly path: string } | { readonly ok: false; readonly message: string };

/**
 * Save As / Duplicate (R1 C2, adopted C1): a new map ID, and so a new document identity. Persistent object IDs are
 * scoped to their map, so every local identity carries over unchanged into the new map's namespace and every local
 * reference still resolves. Self-portals and other references naming the old map ID are retargeted to the new
 * one; references and dependencies naming other maps are preserved.
 */
export function duplicateMap(model: MapModel, id: string, name: string, taken: (id: string) => boolean): DuplicateResult {
  const path = documentPath('map', id);
  if (path === null) return { ok: false, message: `${id} cannot be a map ID and file name (lowercase letters, digits, ".", "_" and "-")` };
  if (id === model.id || taken(id)) return { ok: false, message: `${id} is already used in this library` };
  const source = denormalize(model);
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(source)) {
    if (k === 'id') setOwn(out, k, id);
    else if (k === 'dependencies' && Array.isArray(v)) setOwn(out, k, v.filter((d) => !(isObject(d) && d.id === model.id)));
    else setOwn(out, k, retargetMap(v, model.id, id));
  }
  const metadata = out.metadata;
  if (isObject(metadata)) { const m: Record<string, JsonValue> = { ...metadata }; setOwn(m, 'name', name); setOwn(out, 'metadata', m); }
  const n = normalize(out);
  return n.ok ? { ok: true, model: n.model, path } : { ok: false, message: n.problems.map((p) => p.message).join('; ') };
}

export interface NewMapOptions {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly movement: Readonly<{ id: string; path: string }>;
  /** A tile layer with this cell size, drawn from this tileset; omitted when the library has no tileset. */
  readonly tiles?: Readonly<{ tilesetId: string; path: string; size: number }>;
}

const rect = (x: number, y: number, w: number, h: number): JsonValue => [x, y, w, h];
const layer = (id: string, name: string, order: number, kind: string, extra: JsonObject = {}): JsonObject =>
  ({ id, name, parentId: null, order, visible: true, opacity: 1, kind, ...extra });

/**
 * A new map that validates on its own: bounds, one actors layer, a ground body across the bottom with its solid
 * foothold, and the default player start on it, using the chosen movement profile (R1 C2 New map).
 */
export function newMapDocument(o: NewMapOptions): JsonObject {
  const ground = Math.min(64, o.height / 4), top = o.height - ground;
  const dependencies: JsonValue[] = [{ id: o.movement.id, kind: 'movement', path: o.movement.path, required: true }];
  const layers: JsonValue[] = [layer('layer.world', 'Ground art', 0, 'sprite', { occlusionFade: null }), layer('layer.actors', 'Actors', 2, 'actors')];
  const terrain: JsonValue[] = [];
  if (o.tiles) {
    dependencies.push({ id: o.tiles.tilesetId, kind: 'tileset', path: o.tiles.path, required: true });
    layers.splice(1, 0, layer('layer.tiles', 'Tiles', 1, 'tile', { occlusionFade: null }));
    terrain.push({ layerId: 'layer.tiles', tilesetId: o.tiles.tilesetId, origin: [0, 0], cellSize: [o.tiles.size, o.tiles.size], chunkSize: 32, chunks: [],
      terrainIntent: [], rulesVersion: 1, variationSeed: 0 });
  }
  return {
    format: 'maplab.map', version: 1, id: o.id,
    metadata: { name: o.name, description: '', authors: [], license: 'CC0-1.0', tags: [] },
    requiredFeatures: [{ key: 'maplab.collision', version: 1 }, { key: 'maplab.camera', version: 1 }],
    coordinates: { units: 'WU', x: 'right', y: 'down', rotation: 'clockwiseDegrees', quantum: 0.0625, ticksPerSecond: 60 },
    bounds: rect(0, 0, o.width, o.height),
    collisionContract: { key: 'maplab.collision', version: 1 },
    dependencies, assets: [], presentations: [], layers, terrain,
    visuals: [{ id: 'visual.ground', name: 'Ground art', layerId: 'layer.world', parentId: null, order: 0,
      transform: { position: [0, top], rotation: 0, scale: [1, 1], mirrorX: false, mirrorY: false },
      source: { kind: 'shape', shape: { kind: 'rect', rect: rect(0, 0, o.width, ground) }, fill: '#5b7a3c' }, bodyId: null }],
    materials: [{ id: 'material.ground', name: 'Ground', traction: 256, conveyorSu: 0, effect: null, tags: ['ground'] }],
    bodies: [{ id: 'body.ground', name: 'Ground', position: [0, 0], enabled: true, mobility: 'static', category: 'world', mask: ['actor'],
      materialId: 'material.ground', shapes: [{ id: 'shape.ground', kind: 'rect', rect: rect(0, top, o.width, ground) }], motion: null }],
    footholds: [{ id: 'fh.ground', name: 'Ground', ownerBodyId: 'body.ground', a: [0, top], b: [o.width, top], normal: 'up', mode: 'solid',
      solidEdge: { bodyId: 'body.ground', shapeId: 'shape.ground', edgeIndex: 0 }, dropAllowed: false, dropGroupId: null, materialId: 'material.ground',
      direction: 'both', category: 'world', mask: ['actor'], enabled: true, connections: { a: [], b: [] }, planeId: null }],
    traversals: [], regions: [],
    entities: [{ id: 'start.default', name: 'Player start', anchor: { kind: 'surface', footholdId: 'fh.ground', u: 0.5, normalOffset: 0 }, enabled: true,
      facing: 'right', visualId: null, presentationId: null, kind: 'playerStart', movementId: o.movement.id, default: true }],
    waypoints: [], routes: [], triggers: [], encounters: [],
    camera: { model: { key: 'maplab.camera', version: 1 }, defaults: { viewWU: [Math.min(640, o.width), Math.min(360, o.height)], zoom: 1, bounds: rect(0, 0, o.width, o.height),
      followX: true, followY: true, deadZone: [0.375, 0.25, 0.25, 0.5], dampingTicks: [8, 12], lookaheadWU: [80, 64], verticalPolicy: 'platformSnap',
      climbFollow: true, transitionTicks: 15, transition: 'smoothstep' }, zones: [], shakeEffects: [] },
    environment: { ambientColor: '#ffffff', effects: [], zones: [] },
    navigation: { modeVolumes: [], links: [], overrides: [] },
    flags: [], prefabPlacements: [],
  };
}

/** Persistent IDs of each collection, in order, for showing that IDs survive a save and reopen. */
export function objectIds(model: MapModel): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const [name, c] of model.collections) if (name !== 'dependencies') out.set(name, c.order);
  return out;
}
