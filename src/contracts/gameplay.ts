// Final R1 source contracts. Pure validation of data and intent; never runs handlers.
import catalogSchema from '../../schemas/maplab.catalog.v1.schema.json' with { type: 'json' };
import projectSchema from '../../schemas/maplab.project.v1.schema.json' with { type: 'json' };
import exportSchema from '../../schemas/maplab.export.v1.schema.json' with { type: 'json' };
import navigationSchema from '../../schemas/maplab.navigation.v1.schema.json' with { type: 'json' };
import { error, type Diagnostic, type PathSegment } from './diagnostics';
import { parseJson, type JsonLimits, type JsonValue } from './json';
import { compileSchema, evaluate, type CompiledSchema } from './schema';
import { pathAliasKey } from './grammar';
import { MAP_SCHEMA, type Dependency } from './map-header';
import { PREFAB_SCHEMA, TILESET_SCHEMA, validateMapGeometry, validatePrefab, validateTileset, type GeometryContext } from './geometry';
import { MOVEMENT_SCHEMA, validateMovement } from './movement';
import type { MovementCompatibility } from './capabilities';
import type { Anchor, Call, Condition, ContractRef, ObjectKind, ParamValue, RegionShape, Vec2 } from './common-types';
import type { CatalogDocument, Field, MapDocument, MovementDocument, PrefabDocument, TilesetDocument } from './document-types';

export const CATALOG_SCHEMA = compileSchema(catalogSchema as JsonValue, 'catalog');
export const PROJECT_SCHEMA = compileSchema(projectSchema as JsonValue, 'project');
export const EXPORT_SCHEMA = compileSchema(exportSchema as JsonValue, 'export');
export const NAVIGATION_SCHEMA = compileSchema(navigationSchema as JsonValue, 'navigation');
export const DOCUMENT_SCHEMAS: ReadonlyMap<string, CompiledSchema> = new Map([
  ['maplab.map', MAP_SCHEMA], ['maplab.tileset', TILESET_SCHEMA], ['maplab.prefab', PREFAB_SCHEMA],
  ['maplab.movement', MOVEMENT_SCHEMA], ['maplab.catalog', CATALOG_SCHEMA], ['maplab.project', PROJECT_SCHEMA],
  ['maplab.export', EXPORT_SCHEMA], ['maplab.navigation', NAVIGATION_SCHEMA],
]);
export type SourceDocument = MapDocument | PrefabDocument | TilesetDocument | MovementDocument | CatalogDocument;
export type SourceGraphResult = { readonly ok: true; readonly documents: readonly SourceDocument[]; readonly diagnostics: readonly Diagnostic[]; readonly deferred: readonly string[]; readonly movement: readonly Readonly<{ profileId: string; compatibility: MovementCompatibility }>[]; readonly contractSupported: boolean; readonly runtimeImplemented: false; readonly canCertify: false }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };
const record = (v: unknown): v is Record<string, JsonValue> => v !== null && typeof v === 'object' && !Array.isArray(v);
const asJson = (v: unknown): JsonValue => v as JsonValue;
function frozen<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(frozen); Object.freeze(v); } return v; }

/** Structural validation only, including reserved later-phase document syntax. Never implies
 * source closure, export hash verification, library save integrity or a navigation certificate. */
export function validateDocumentSchema(value: JsonValue): readonly Diagnostic[] {
  const docId = record(value) && typeof value.id === 'string' ? value.id : null;
  if (!record(value)) return [error('format.not-object', [], 'Document must be an object')];
  const schema = typeof value.format === 'string' ? DOCUMENT_SCHEMAS.get(value.format) : undefined;
  if (!schema) return [error('format.unsupported', ['format'], 'Unknown or reserved document format', docId)];
  if (value.version !== 1) return [error('format.unsupported-version', ['version'], 'Reader accepts exactly version 1', docId)];
  return evaluate(schema, value).map((d) => ({ ...d, documentId: docId }));
}

export function loadSourceGraph(inputs: readonly (Uint8Array | string)[], limits?: JsonLimits): SourceGraphResult {
  const values: JsonValue[] = [];
  for (const input of inputs) { const p = parseJson(input, limits); if (!p.ok) return { ok: false, diagnostics: [p.diagnostic] }; values.push(p.value); }
  return validateSourceGraph(values);
}

/** Validates a closed, explicitly supplied source graph. Map cycles are legal; nothing is fetched.
 * Optional unused prefab provenance may be absent. Required and actually used targets must exist. */
export function validateSourceGraph(values: readonly JsonValue[]): SourceGraphResult {
  const diagnostics: Diagnostic[] = [];
  if (!values.length || values.length > 20000) return { ok: false, diagnostics: [error('graph.limit', [], 'Supply 1–20000 source documents')] };
  for (const value of values) {
    diagnostics.push(...validateDocumentSchema(value));
    if (record(value) && !['maplab.map', 'maplab.tileset', 'maplab.prefab', 'maplab.movement', 'maplab.catalog'].includes(String(value.format))) diagnostics.push(error('graph.source-format', ['format'], 'Only authored source documents belong in this graph'));
  }
  if (diagnostics.length) return { ok: false, diagnostics: diagnostics.slice(0, 100) };
  const docs = values as unknown as readonly SourceDocument[];
  const report = (doc: SourceDocument, code: string, at: readonly PathSegment[], message: string, id: string | null = null, warning = false): void => {
    if (warning && diagnostics.filter((d) => d.severity === 'warning' && d.code === code).length >= 10) return;
    if (diagnostics.length >= 100) {
      const w = diagnostics.findIndex((d) => d.severity === 'warning');
      if (warning || w < 0) return;
      diagnostics.splice(w, 1);
    }
    diagnostics.push({ ...error(code, at, message, doc.id, id), severity: warning ? 'warning' : 'error' });
  };
  const byId = new Map<string, SourceDocument>();
  for (const doc of docs) { if (byId.has(doc.id)) report(doc, 'graph.document-identity', ['id'], 'Duplicate document ID', doc.id); else byId.set(doc.id, doc); }
  const dependencies = (doc: SourceDocument): readonly Dependency[] => 'dependencies' in doc ? doc.dependencies : [];
  const closure = (doc: SourceDocument): Set<string> => {
    const found = new Set([doc.id]), pending = [doc];
    while (pending.length) for (const dep of dependencies(pending.pop() as SourceDocument)) {
      if (!found.has(dep.id)) { found.add(dep.id); const target = byId.get(dep.id); if (target) pending.push(target); }
    }
    return found;
  };
  const scopes = new Map(docs.map((d) => [d.id, closure(d)]));
  // A non-map document is cyclic exactly when one of its outgoing targets can
  // reach it. Reuse complete closures so previously visited map subcycles cannot
  // hide a larger mixed cycle. Ordinary map-only portal cycles remain legal.
  for (const doc of docs) if (doc.format !== 'maplab.map') dependencies(doc).forEach((dep, i) => {
    if (scopes.get(dep.id)?.has(doc.id)) report(doc, 'dependency.cycle', ['dependencies', i], 'Only map dependency cycles are legal');
  });
  const geometryContext: GeometryContext = {
    tilesets: docs.filter((d): d is TilesetDocument => d.format === 'maplab.tileset'),
    prefabs: docs.filter((d): d is PrefabDocument => d.format === 'maplab.prefab') as unknown as GeometryContext['prefabs'] & {},
  };
  const dependencyPaths = new Map<string, string>(), pathOwners = new Map<string, string>();
  for (const doc of docs) dependencies(doc).forEach((dep, i) => {
    const oldPath = dependencyPaths.get(dep.id), alias = pathAliasKey(dep.path), owner = pathOwners.get(alias);
    if (oldPath !== undefined && oldPath !== dep.path) report(doc, 'dependency.path-identity', ['dependencies', i, 'path'], 'One dependency ID must have one path across the graph');
    if (owner !== undefined && owner !== dep.id) report(doc, 'dependency.path-alias', ['dependencies', i, 'path'], 'Two dependency IDs cannot alias one file');
    dependencyPaths.set(dep.id, dep.path); pathOwners.set(alias, dep.id);
  });
  const movement: { profileId: string; compatibility: MovementCompatibility }[] = [];
  for (const doc of docs) {
    dependencies(doc).forEach((dep, i) => {
      const target = byId.get(dep.id);
      if (!target && dep.required) report(doc, 'dependency.missing', ['dependencies', i], `Missing required ${dep.kind} ${dep.id}`);
      if (target && target.format !== `maplab.${dep.kind}`) report(doc, 'dependency.kind', ['dependencies', i], 'Dependency target has the wrong format');
      // RigLab is a foreign manifest, deliberately outside this source validator.
      if (dep.kind === 'riglab' && dep.required) report(doc, 'dependency.foreign-unsupported', ['dependencies', i], 'Required foreign bundles need their independent manifest validator');
    });
    const checked = doc.format === 'maplab.map' ? validateMapGeometry(asJson(doc), geometryContext)
      : doc.format === 'maplab.prefab' ? validatePrefab(asJson(doc)) : doc.format === 'maplab.tileset' ? validateTileset(asJson(doc))
      : doc.format === 'maplab.movement' ? validateMovement(asJson(doc)) : null;
    if (checked && !checked.ok) diagnostics.push(...checked.diagnostics);
    if (doc.format === 'maplab.movement' && checked?.ok && 'compatibility' in checked) movement.push({ profileId: doc.id, compatibility: checked.compatibility });
  }
  if (diagnostics.some((d) => d.severity === 'error')) return { ok: false, diagnostics: diagnostics.slice(0, 100) };
  type Entry = CatalogDocument['entries'][number];
  const entries = new Map<string, { entry: Entry; catalog: string }>();
  const identity = (r: ContractRef): string => `${r.key}@${r.version}`;
  for (const doc of docs) if (doc.format === 'maplab.catalog') doc.entries.forEach((entry, i) => {
    const at = ['entries', i], k = identity(entry);
    if (entries.has(k)) report(doc, 'catalog.identity', at, `Duplicate catalog identity ${k}`);
    else entries.set(k, { entry, catalog: doc.id });
    const names = new Set<string>();
    entry.fields.forEach((f, j) => {
      const p = [...at, 'fields', j];
      if (names.has(f.name)) report(doc, 'catalog.field-identity', [...p, 'name'], 'Duplicate parameter field'); names.add(f.name);
      if ((f.type === 'number' || f.type === 'integer') && f.min > f.max) report(doc, 'catalog.range', p, 'Field minimum must not exceed maximum');
      
    });
  });
  const maps = new Map(docs.filter((d): d is MapDocument => d.format === 'maplab.map').map((d) => [d.id, d]));
  const indexes = new Map<string, Map<string, string>>();
  const indexContent = (doc: MapDocument | PrefabDocument): Map<string, string> => {
    const out = new Map<string, string>();
    const add = (id: string, kind: string, at: readonly PathSegment[], shared = false): void => {
      if (out.has(id) && !(shared && out.get(id) === kind)) report(doc, 'object.identity', at, 'Duplicate object ID', id);
      else out.set(id, kind);
    };
    const content = doc.format === 'maplab.map' ? doc : doc.content;
    // Existing geometry validation owns duplicates in these collections.
    const collections = { assets: 'asset', presentations: 'presentation', visuals: 'visual', materials: 'material', bodies: 'body', footholds: 'foothold', traversals: 'traversal', regions: 'region', entities: 'entity', waypoints: 'waypoint', routes: 'route', triggers: 'trigger', encounters: 'encounter', flags: 'flag' };
    for (const [collection, kind] of Object.entries(collections)) for (const item of content[collection as keyof typeof content]) {
      const v = item as { readonly id: string }; out.set(v.id, kind);
    }
    for (const body of content.bodies) body.shapes.forEach((s) => out.set(s.id, 'shape'));
    for (const t of content.traversals) if ('access' in t) t.access.forEach((a) => out.set(a.id, 'access'));
    if (doc.format === 'maplab.map') {
      doc.layers.forEach((l) => out.set(l.id, l.kind === 'group' ? 'group' : 'layer'));
      doc.prefabPlacements.forEach((p) => out.set(p.id, 'placement'));
      for (const [collection, items] of [['camera', doc.camera.zones], ['environment', doc.environment.zones], ['modeVolumes', doc.navigation.modeVolumes], ['links', doc.navigation.links], ['overrides', doc.navigation.overrides]] as const) items.forEach((v, i) => add(v.id, 'zone', [collection, i, 'id']));
    }
    content.entities.forEach((e, i) => { if ('groupId' in e && e.groupId !== null) add(e.groupId, 'group', ['entities', i, 'groupId'], true); });
    content.encounters.forEach((e, i) => add(e.groupId, 'group', ['encounters', i, 'groupId'], true));
    return out;
  };
  for (const doc of docs) if (doc.format === 'maplab.map' || doc.format === 'maplab.prefab') indexes.set(doc.id, indexContent(doc));

  const ownedProfiles = new Set<string>();
  for (const doc of docs) if (doc.format === 'maplab.map' || doc.format === 'maplab.prefab') {
    const content = doc.format === 'maplab.map' ? doc : doc.content;
    const prefix: PathSegment[] = doc.format === 'maplab.map' ? [] : ['content'];
    const scope = scopes.get(doc.id) as Set<string>;
    const ids = indexes.get(doc.id) as Map<string, string>;
    const ref = (id: string | null, kind: ObjectKind, at: readonly PathSegment[], mapId?: string): boolean => {
      if (id === null) return true;
      const targetId = mapId ?? doc.id;
      const target = mapId === undefined || mapId === doc.id ? ids : scope.has(mapId) && maps.has(mapId) ? indexes.get(mapId) : undefined;
      const targetScope = mapId === undefined || mapId === doc.id ? scope : target ? scopes.get(mapId) : undefined;
      const slot = kind === 'layer' && doc.format === 'maplab.prefab' && (mapId === undefined || mapId === doc.id) && doc.layerSlots.includes(id);
      const found = slot || (kind === 'movement' ? targetScope?.has(id) && byId.get(id)?.format === 'maplab.movement' : target?.get(id) === kind || kind === 'layer' && target?.get(id) === 'group');
      if (!found) report(doc, 'reference.kind', at, `Expected ${kind} ${id} in ${targetId}`, id);
      return !!found;
    };
    const binding = (r: ContractRef, kind: Entry['kind'], at: readonly PathSegment[], params?: Call['params']): Entry | undefined => {
      const bound = entries.get(identity(r));
      if (!bound || !scope.has(bound.catalog)) { report(doc, 'catalog.missing', at, `Undeclared catalog entry ${identity(r)}`); return; }
      const entry = bound.entry;
      if (entry.kind !== kind) { report(doc, 'catalog.kind', at, `Expected ${kind}, found ${entry.kind}`); return; }
      if (entry.stage === 'planned') report(doc, 'catalog.planned', at, `${identity(r)} is configured, not simulated`, null, true);
      if (params !== undefined) {
        for (const field of entry.fields) if (field.required && !Object.hasOwn(params, field.name)) report(doc, 'param.required', [...at, 'params', field.name], 'Missing required parameter');
        for (const [name, value] of Object.entries(params)) {
          const field = entry.fields.find((f) => f.name === name), p = [...at, 'params', name];
          if (!field) { report(doc, 'param.unknown', p, 'Parameter is not declared by this catalog entry'); continue; }
          const valid = checkField(field, value);
          if (!valid) report(doc, 'param.type', p, `Invalid ${field.type} parameter`);
          else if (field.type === 'ref' && typeof value === 'object') {
            const r = value.ref;
            if (r.kind !== field.target) report(doc, 'param.reference-kind', [...p, 'ref', 'kind'], `Expected typed ${field.target} reference`);
            else ref(r.id, field.target, [...p, 'ref'], r.mapId);
          }
        }
      }
      return entry;
    };
    const call = (r: Call | null, kind: Entry['kind'], at: readonly PathSegment[]): void => { if (r !== null) binding(r, kind, at, r.params); };
    const conditions = (terms: readonly Condition[], at: readonly PathSegment[]): void => {
      let leaves = 0;
      const visit = (term: Condition, p: readonly PathSegment[], depth: number): void => {
        if (depth > 8) { report(doc, 'condition.depth', p, 'Condition depth exceeds 8'); return; }
        if (term.kind === 'all' || term.kind === 'any') term.terms.forEach((t, i) => visit(t, [...p, 'terms', i], depth + 1));
        else if (term.kind === 'not') visit(term.term, [...p, 'term'], depth + 1);
        else {
          leaves++;
          if (term.kind === 'flag') ref(term.id, 'flag', [...p, 'id']);
          if (term.kind === 'entityState' && ref(term.entityId, 'entity', [...p, 'entityId'])) {
            const e = content.entities.find((e) => e.id === term.entityId);
            const r = e && ('archetype' in e ? e.archetype : 'definition' in e ? e.definition : null);
            const states = r && entries.get(identity(r))?.entry.stateNames;
            if (!states?.includes(term.state)) report(doc, 'condition.state', [...p, 'state'], 'State is not declared by the entity definition');
          }
        }
      };
      terms.forEach((t, i) => visit(t, [...at, i], 1));
      if (leaves > 256) report(doc, 'condition.leaves', at, 'Condition tree exceeds 256 leaves');
    };
    const anchor = (a: Anchor, at: readonly PathSegment[]): void => {
      let current = a, offset: Vec2 = [0, 0]; const seen = new Set<string>();
      while (current.kind === 'entity') {
        if (!ref(current.entityId, 'entity', [...at, 'entityId'])) return;
        if (seen.has(current.entityId)) { report(doc, 'anchor.reference-cycle', at, 'Entity anchor cycle'); return; }
        seen.add(current.entityId);
        const entity = content.entities.find((e) => e.id === (current as Anchor & { entityId: string }).entityId);
        if (!entity) return;
        offset = [offset[0] + current.point[0], offset[1] + current.point[1]]; current = entity.anchor;
      }
      let point: Vec2;
      if (current.kind === 'world') point = current.point;
      else if (current.kind === 'body') {
        if (!ref(current.bodyId, 'body', [...at, 'bodyId'])) return;
        const b = content.bodies.find((b) => b.id === (current as Anchor & { bodyId: string }).bodyId)!;
        point = [b.position[0] + current.point[0], b.position[1] + current.point[1]];
      } else {
        if (!ref(current.footholdId, 'foothold', [...at, 'footholdId'])) return;
        const f = content.footholds.find((f) => f.id === (current as Anchor & { footholdId: string }).footholdId)!;
        const pos = content.bodies.find((b) => b.id === f.ownerBodyId)?.position ?? [0, 0];
        const dx = f.b[0] - f.a[0], dy = f.b[1] - f.a[1], length = Math.hypot(dx, dy);
        point = [pos[0]! + f.a[0] + current.u * dx + current.normalOffset * dy / length,
          pos[1]! + f.a[1] + current.u * dy - current.normalOffset * dx / length];
      }
      if (point.some((v, i) => !Number.isFinite(v + offset[i]!) || Math.abs(v + offset[i]!) > 131072)) report(doc, 'anchor.range', at, 'Resolved anchor exceeds coordinate range');
    };
    const destination = (d: { mapId: string; entityId: string } | null, at: readonly PathSegment[]): void => {
      if (d !== null) {
        if (d.mapId !== doc.id && (!maps.has(d.mapId) || !scope.has(d.mapId))) report(doc, 'portal.map', [...at, 'mapId'], 'Portal map must exist in the declared dependency closure');
        else ref(d.entityId, 'entity', [...at, 'entityId'], d.mapId);
      }
    };
    content.materials.forEach((m, i) => call(m.effect, 'effect', [...prefix, 'materials', i, 'effect']));
    content.bodies.forEach((b, i) => { if (b.motion) call(b.motion.crushAction, 'action', [...prefix, 'bodies', i, 'motion', 'crushAction']); });
    content.traversals.forEach((t, i) => {
      const at = [...prefix, 'traversals', i];
      if ('access' in t) t.access.forEach((a, j) => conditions(a.conditions, [...at, 'access', j, 'conditions']));
      if (t.kind === 'scripted') { call(t.action, 'traversal', [...at, 'action']); conditions(t.conditions, [...at, 'conditions']); }
    });
    content.waypoints.forEach((w, i) => anchor(w.anchor, [...prefix, 'waypoints', i, 'anchor']));
    content.routes.forEach((r, i) => {
      r.waypointIds.forEach((id, j) => ref(id, 'waypoint', [...prefix, 'routes', i, 'waypointIds', j]));
      conditions(r.conditions, [...prefix, 'routes', i, 'conditions']);
    });
    const ownedVisuals = new Set<string>();
    content.entities.forEach((e, i) => {
      const at = [...prefix, 'entities', i];
      anchor(e.anchor, [...at, 'anchor']); ref(e.visualId, 'visual', [...at, 'visualId']); ref(e.presentationId, 'presentation', [...at, 'presentationId']);
      if (e.visualId !== null) {
        const v = content.visuals.find((v) => v.id === e.visualId);
        if (ownedVisuals.has(e.visualId) || v?.bodyId !== null || v?.parentId !== null) report(doc, 'entity.visual-owner', [...at, 'visualId'], 'Actor visual must be an exclusively owned visual root', e.id);
        ownedVisuals.add(e.visualId);
      }
      if ('bodyIds' in e) e.bodyIds.forEach((id, j) => ref(id, 'body', [...at, 'bodyIds', j]));
      if ('regionId' in e) ref(e.regionId, 'region', [...at, 'regionId']);
      if ('movementId' in e) ref(e.movementId, 'movement', [...at, 'movementId']);
      if ('archetype' in e) call(e.archetype, 'archetype', [...at, 'archetype']);
      if ('interaction' in e) call(e.interaction, 'action', [...at, 'interaction']);
      if ('destination' in e) destination(e.destination, [...at, 'destination']);
      if (e.kind === 'portal') conditions(e.conditions, [...at, 'conditions']);
      if (e.kind === 'hazard') call(e.effect, 'effect', [...at, 'effect']);
      if (e.kind === 'checkpoint') call(e.activate, 'action', [...at, 'activate']);
      if ('definition' in e) call(e.definition, e.kind === 'cutsceneMarker' ? 'effect' : 'archetype', [...at, 'definition']);
      if ('ai' in e) {
        const ai = e.ai;
        call(ai.behavior, 'behavior', [...at, 'ai', 'behavior']); call(ai.fallback, 'behavior', [...at, 'ai', 'fallback']);
        if ((ai.invalidRoute === 'registeredFallback') !== (ai.fallback !== null)) report(doc, 'ai.fallback', [...at, 'ai', 'fallback'], 'Fallback is required exactly for registeredFallback');
        ref(ai.routeId, 'route', [...at, 'ai', 'routeId']); anchor(ai.home, [...at, 'ai', 'home']); if (ai.guard) anchor(ai.guard, [...at, 'ai', 'guard']);
        for (const field of ['patrolRegionId', 'pursuitRegionId', 'leashRegionId', 'aggroRegionId'] as const) ref(ai[field], 'region', [...at, 'ai', field]);
        if ((e.respawn.mode === 'event') !== (e.respawn.event !== null)) report(doc, 'respawn.event', [...at, 'respawn', 'event'], 'Event reference is required exactly for event respawn');
        if (e.respawn.event) binding(e.respawn.event, 'event', [...at, 'respawn', 'event']);
        const route = content.routes.find((r) => r.id === ai.routeId), profile = byId.get(e.movementId);
        if (route && profile?.format === 'maplab.movement' && route.requiredAbilities.some((a) => !profile.abilityTags.includes(a))) report(doc, 'route.capability', [...at, 'ai', 'routeId'], 'Route requires abilities absent from this actor profile');
      }
    });
    content.triggers.forEach((t, i) => {
      const at = [...prefix, 'triggers', i]; ref(t.regionId, 'region', [...at, 'regionId']); conditions(t.conditions, [...at, 'conditions']);
      t.actions.forEach((a, j) => call(a, 'action', [...at, 'actions', j]));
    });
    const groups = new Set<string>();
    content.encounters.forEach((e, i) => {
      const at = [...prefix, 'encounters', i]; ref(e.regionId, 'region', [...at, 'regionId']);
      if (groups.has(e.groupId)) report(doc, 'encounter.group', [...at, 'groupId'], 'Two encounters cannot share a group'); groups.add(e.groupId);
      e.spawnIds.forEach((id, j) => { const target = content.entities.find((s) => s.id === id); if (!target || target.kind !== 'enemySpawn' || target.groupId !== e.groupId) report(doc, 'encounter.spawn', [...at, 'spawnIds', j], 'Encounter spawn must be an enemy in its group'); });
      e.waves.forEach((w, j) => binding(w, 'event', [...at, 'waves', j])); binding(e.completionEvent, 'event', [...at, 'completionEvent']);
      e.onComplete.forEach((a, j) => call(a, 'action', [...at, 'onComplete', j]));
    });
    content.regions.forEach((r, i) => {
      const problem = regionProblem(r.shape); if (problem) report(doc, 'region.geometry', [...prefix, 'regions', i, 'shape'], problem, r.id);
    });
    content.presentations.forEach((p, i) => {
      const at = [...prefix, 'presentations', i];
      if (!dependencies(doc).some((d) => d.id === p.bundleDependencyId && d.kind === 'riglab')) report(doc, 'presentation.dependency', [...at, 'bundleDependencyId'], 'Presentation must declare a RigLab dependency');
      const slots = new Set<string>(), semantics = new Map(p.actions.map((a) => [a.semantic, a]));
      p.artSlots.forEach((a, j) => { if (slots.has(a.slot)) report(doc, 'presentation.slot', [...at, 'artSlots', j], 'Duplicate art slot'); slots.add(a.slot); ref(a.assetId, 'asset', [...at, 'artSlots', j, 'assetId']); });
      if (semantics.size !== p.actions.length) report(doc, 'presentation.semantic', [...at, 'actions'], 'Duplicate semantic action');
      p.actions.forEach((a, j) => {
        const seen = new Set<string>(); let current: typeof a | undefined = a;
        while (current) {
          if (seen.has(current.semantic)) { report(doc, 'presentation.fallback-cycle', [...at, 'actions', j], 'Action fallback cycle'); break; }
          seen.add(current.semantic);
          if (current.fallbackSemantic === null) break;
          const next = semantics.get(current.fallbackSemantic);
          if (!next) report(doc, 'presentation.fallback', [...at, 'actions', j], 'Missing fallback semantic');
          current = next;
        }
      });
    });
    // Movement documents have no dependency list; resolve catalog extensions in each owning map.
    const profiles = new Set([...scope].filter((id) => byId.get(id)?.format === 'maplab.movement'));
    profiles.forEach((id) => ownedProfiles.add(id));
    for (const id of profiles) {
      const p = byId.get(id); if (p?.format !== 'maplab.movement') continue;
      p.abilities.forEach((a, i) => {
        const at = ['movement', id, 'abilities', i];
        if (a.kind === 'registered') call(a.definition, 'traversal', [...at, 'definition']);
        if (a.kind === 'ledge') binding(a.action, 'traversal', [...at, 'action']);
        if (a.kind === 'modifier') a.allowed.forEach((r, j) => binding(r, 'modifier', [...at, 'allowed', j]));
      });
    }
    if (doc.format !== 'maplab.map') continue;
    if (doc.entities.filter((e) => e.kind === 'playerStart' && e.default).length !== 1) report(doc, 'map.default-start', ['entities'], 'Map requires exactly one default player start');
    if (doc.camera.model.key !== 'maplab.camera' || doc.camera.model.version !== 1) report(doc, 'camera.model', ['camera', 'model'], 'Unsupported camera contract');
    const settings = (s: MapDocument['camera']['defaults'], at: readonly PathSegment[]): void => {
      if (s.deadZone[0] + s.deadZone[2] > 1 || s.deadZone[1] + s.deadZone[3] > 1) report(doc, 'camera.dead-zone', [...at, 'deadZone'], 'Dead zone must lie inside the normalized view');
      if (s.bounds[0] + s.bounds[2] > 131072 || s.bounds[1] + s.bounds[3] > 131072) report(doc, 'camera.bounds', [...at, 'bounds'], 'Camera bounds far edge exceeds range');
      if (s.bounds[2] < s.viewWU[0] / s.zoom || s.bounds[3] < s.viewWU[1] / s.zoom) report(doc, 'camera.letterbox', [...at, 'bounds'], 'Bounds smaller than effective view: center and letterbox', null, true);
    };
    settings(doc.camera.defaults, ['camera', 'defaults']);
    doc.camera.zones.forEach((z, i) => { ref(z.regionId, 'region', ['camera', 'zones', i, 'regionId']); settings(z.settings, ['camera', 'zones', i, 'settings']); });
    doc.camera.shakeEffects.forEach((r, i) => binding(r, 'effect', ['camera', 'shakeEffects', i]));
    doc.environment.effects.forEach((r, i) => call(r, 'effect', ['environment', 'effects', i]));
    doc.environment.zones.forEach((z, i) => {
      const at = ['environment', 'zones', i]; ref(z.regionId, 'region', [...at, 'regionId']);
      if (z.kind === 'audio') { ref(z.trackAssetId, 'asset', [...at, 'trackAssetId']); if (!doc.assets.find((a) => a.id === z.trackAssetId)?.mediaType.startsWith('audio/')) report(doc, 'audio.asset', [...at, 'trackAssetId'], 'Audio zone requires an audio asset'); }
      if (z.kind === 'transition') call(z.effect, 'effect', [...at, 'effect']);
      if (z.kind === 'movementModifier') call(z.modifier, 'modifier', [...at, 'modifier']);
    });
    const nav = doc.navigation;
    nav.modeVolumes.forEach((v, i) => {
      const at = ['navigation', 'modeVolumes', i]; ref(v.regionId, 'region', [...at, 'regionId']);
      v.profileIds.forEach((id, j) => { if (ref(id, 'movement', [...at, 'profileIds', j])) { const p = byId.get(id) as MovementDocument; if (!p.abilities.some((a) => a.kind === v.mode)) report(doc, 'navigation.mode-capability', [...at, 'profileIds', j], 'Profile lacks declared volume mode'); } });
    });
    nav.links.forEach((l, i) => { const at = ['navigation', 'links', i]; anchor(l.from, [...at, 'from']); anchor(l.to, [...at, 'to']); call(l.action, 'traversal', [...at, 'action']); conditions(l.conditions, [...at, 'conditions']); });
    nav.overrides.forEach((o, i) => { ref(o.regionId, 'region', ['navigation', 'overrides', i, 'regionId']); o.profileIds.forEach((id, j) => ref(id, 'movement', ['navigation', 'overrides', i, 'profileIds', j])); });
    const zoneBounds = (id: string): readonly [number, number, number, number] | null => {
      const s = doc.regions.find((r) => r.id === id)?.shape; if (!s) return null;
      if (s.kind === 'rect') return s.rect;
      if (s.kind === 'circle') return [s.center[0] - s.radius, s.center[1] - s.radius, s.radius * 2, s.radius * 2];
      const xs = s.points.map((p) => p[0]), ys = s.points.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    };
    for (const zones of [doc.camera.zones, doc.environment.zones.filter((z) => 'priority' in z)]) zones.forEach((z, i) => zones.slice(i + 1).forEach((other) => {
      if (!('priority' in z) || !('priority' in other) || z.priority !== other.priority) return;
      const a = zoneBounds(z.regionId), b = zoneBounds(other.regionId);
      if (a && b && a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]) report(doc, 'zone.priority-overlap', [], `Equal-priority zone bounds overlap: ${z.id}, ${other.id}; stable ID breaks ties`, z.id, true);
    }));
  }
  // A profile can be supplied without a map. Its extension fields still bind to the
  // supplied catalog; map-local refs require an owning source scope.
  for (const doc of docs) if (doc.format === 'maplab.movement' && !ownedProfiles.has(doc.id)) {
    const bind = (r: ContractRef, kind: Entry['kind'], at: readonly PathSegment[], params?: Call['params']): void => {
      const entry = entries.get(identity(r))?.entry;
      if (!entry) { report(doc, 'catalog.missing', at, `Unknown catalog entry ${identity(r)}`); return; }
      if (entry.kind !== kind) { report(doc, 'catalog.kind', at, `Expected ${kind}, found ${entry.kind}`); return; }
      if (entry.stage === 'planned') report(doc, 'catalog.planned', at, 'Configured, not simulated', null, true);
      if (params === undefined) return;
      for (const f of entry.fields) if (f.required && !Object.hasOwn(params, f.name)) report(doc, 'param.required', [...at, 'params', f.name], 'Missing required parameter');
      for (const [name, value] of Object.entries(params)) {
        const f = entry.fields.find((f) => f.name === name), p = [...at, 'params', name];
        if (!f) report(doc, 'param.unknown', p, 'Unknown parameter');
        else if (!checkField(f, value)) report(doc, 'param.type', p, 'Invalid parameter type/range');
        else if (f.type === 'ref' && typeof value === 'object') {
          if (value.ref.kind !== f.target) report(doc, 'param.reference-kind', p, 'Wrong typed reference kind');
          else if (f.target !== 'movement' || value.ref.mapId !== undefined || byId.get(value.ref.id)?.format !== 'maplab.movement') report(doc, 'reference.scope', p, 'Reference requires a resolving owner map or movement document');
        }
      }
    };
    doc.abilities.forEach((a, i) => {
      const at = ['abilities', i];
      if (a.kind === 'registered') bind(a.definition, 'traversal', [...at, 'definition'], a.definition.params);
      if (a.kind === 'ledge') bind(a.action, 'traversal', [...at, 'action']);
      if (a.kind === 'modifier') a.allowed.forEach((r, j) => bind(r, 'modifier', [...at, 'allowed', j]));
    });
  }
  if (diagnostics.some((d) => d.severity === 'error')) return { ok: false, diagnostics: diagnostics.slice(0, 100) };
  return { ok: true, documents: frozen(structuredClone(docs)), diagnostics: frozen(diagnostics), movement: frozen(movement), contractSupported: movement.every((m) => m.compatibility.contractSupported), runtimeImplemented: false, canCertify: false, deferred: Object.freeze([
    'controller replay, profile-specific resting stance and full-body clearance',
    'foreign presentation manifest/animation validation', 'runtime AI, actions, camera and environment execution',
  ]) };
}

function checkField(field: Field, value: ParamValue): boolean {
  if (field.type === 'boolean') return typeof value === 'boolean';
  if (field.type === 'string') return typeof value === 'string' && [...value].length <= field.maxLength;
  if (field.type === 'enum') return typeof value === 'string' && field.values.includes(value);
  if (field.type === 'ref') return typeof value === 'object' && value !== null && 'ref' in value;
  return typeof value === 'number' && Number.isFinite(value) && value >= field.min && value <= field.max
    && (field.type === 'integer' ? Number.isSafeInteger(value) : decimalMultiple(value, field.quantum));
}
function regionProblem(s: RegionShape): string | null {
  if (s.kind === 'rect') return s.rect[0] + s.rect[2] > 131072 || s.rect[1] + s.rect[3] > 131072 ? 'Rectangle far edge exceeds range' : null;
  if (s.kind === 'circle') return s.center.some((v) => Math.abs(v) + s.radius > 131072) ? 'Circle extent exceeds range' : null;
  const p = s.points, cross = (a: Vec2, b: Vec2, c: Vec2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const on = (a: Vec2, b: Vec2, c: Vec2): boolean => cross(a, b, c) === 0 && c[0] >= Math.min(a[0], b[0]) && c[0] <= Math.max(a[0], b[0]) && c[1] >= Math.min(a[1], b[1]) && c[1] <= Math.max(a[1], b[1]);
  let area = 0n;
  for (let i = 0; i < p.length; i++) {
    const a = p[i] as Vec2, b = p[(i + 1) % p.length] as Vec2;
    if (a[0] === b[0] && a[1] === b[1]) return 'Repeated polygon vertex';
    area += BigInt(a[0] * 16) * BigInt(b[1] * 16) - BigInt(b[0] * 16) * BigInt(a[1] * 16);
    for (let j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue;
      const c = p[j] as Vec2, d = p[(j + 1) % p.length] as Vec2;
      if (on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b) || Math.sign(cross(a, b, c)) * Math.sign(cross(a, b, d)) < 0 && Math.sign(cross(c, d, a)) * Math.sign(cross(c, d, b)) < 0) return 'Polygon self-intersects';
    }
  }
  return area > 0n ? null : 'Polygon must be clockwise in Y-down';
}

// Decimal field quanta are catalog data, unlike binary-authored coordinate quanta.
// Compare exact shortest decimal representations, without floating division tolerances.
function decimalMultiple(value: number, quantum: number): boolean {
  const parts = (n: number): readonly [bigint, number] => {
    const [mantissa = '', exponent = '0'] = n.toString().split('e');
    const decimals = mantissa.split('.')[1]?.length ?? 0;
    return [BigInt(mantissa.replace('.', '')), Number(exponent) - decimals];
  };
  const [v, ve] = parts(value), [q, qe] = parts(quantum), power = Math.min(ve, qe);
  return v * 10n ** BigInt(ve - power) % (q * 10n ** BigInt(qe - power)) === 0n;
}
