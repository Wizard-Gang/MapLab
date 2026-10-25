import {verifyForeign} from '../riglab/foreign';
// Deterministic format/inventory core over explicit bytes and source values. No library or editor I/O.
import { createHash } from 'node:crypto';
import { canonical, movementProfileJcs, parseJson, validateDocumentSchema, validateSourceGraph, type ContractRef, type ExportManifest, type JsonValue, type SourceDocument, type MovementDocument } from '../contracts';
import { libraryValue } from '../contracts/serialization';
import { inspectImage } from '../assets/inspect';
import { checkPaths, compare, refuse, ZIP_LIMITS } from './zip';
export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
export const exportBytes = (v: unknown): Buffer => Buffer.from(canonical(v as JsonValue), 'utf8');
const object = (v: unknown): v is Record<string, JsonValue> => v !== null && typeof v === 'object' && !Array.isArray(v);
const sources = new Set(['maplab.map', 'maplab.tileset', 'maplab.catalog', 'maplab.movement']);
const stringSets = new Set(['mask', 'tags', 'abilityTags', 'forbiddenMaterialTags', 'requiredAbilities', 'actorCategories', 'profileIds', 'bodyIds', 'expandedIds']);
/** Existing library domain ordering plus export-specific sets. Sequences are never sorted. */
export function exportValue(value: JsonValue): JsonValue {
  const go = (v: JsonValue, key = '', navigation = false): JsonValue => {
    if (Array.isArray(v)) {
      if (stringSets.has(key) || navigation && key === 'actions') {
        if (new Set(v).size !== v.length) refuse('export.duplicate-set', `Duplicate set member in ${key}`);
      }
      let a = v.map((x) => go(x, '', navigation));
      if (key === 'requiredFeatures') a = a.sort((x, y) => compare(canonical(x), canonical(y)));
      if (key === 'terrain') a = a.sort((x, y) => compare(String((x as Record<string, JsonValue>).layerId), String((y as Record<string, JsonValue>).layerId)));
      if (key === 'allowedQuarterTurns') a = a.sort((x, y) => Number(x) - Number(y));
      if (key === 'traceShapes') a = a.sort((x, y) => compare(String((x as Record<string, JsonValue>).id), String((y as Record<string, JsonValue>).id)));
      if (key === 'assets') a = a.sort((x, y) => compare(String((x as Record<string, JsonValue>).id), String((y as Record<string, JsonValue>).id)));
      return a;
    }
    if (!object(v)) return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, go(x, k, navigation || k === 'navigation')]));
  };
  if (object(value) && value.format === 'maplab.movement') {
    // Same-kind dash modes, wall permissions and modifier contracts already have an
    // authoritative canonical identity; use it instead of maintaining a second ordering.
    const parsed = parseJson(movementProfileJcs(value as unknown as MovementDocument));
    if (!parsed.ok) refuse('export.movement', parsed.diagnostic.message);
    return parsed.value;
  }
  return go(libraryValue(value));
}
/** Collect actual versioned bindings, including engine catalog handlers, without treating
 * catalog definitions themselves as calls. Exact support remains the consumer's decision. */
export function requiredContracts(values: readonly SourceDocument[], foreignContracts:readonly ContractRef[] = []): readonly ContractRef[] {
  const refs = new Map<string, ContractRef>();
  const add = (c: ContractRef): void => { refs.set(`${c.key}@${c.version}`, c); };
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (object(v)) {
      if (typeof v.key === 'string' && typeof v.version === 'number') add({ key: v.key, version: v.version });
      for (const [k, x] of Object.entries(v)) if (k !== 'entries' && k !== 'params') walk(x);
    }
  };
  foreignContracts.forEach(add);
  for (const value of values) { add({ key: value.format, version: value.version }); walk(value); }
  return [...refs].sort(([a], [b]) => compare(a, b)).map(([, c]) => c);
}
export interface ExportBundle { readonly manifest: ExportManifest; readonly digest: string; readonly files: ReadonlyMap<string, Uint8Array>; readonly zip: Buffer; readonly warnings: readonly string[] }

/** G1 byte boundary, usable on a bounded directory inventory or the STORE reader result. */
export function verifyFiles(files: ReadonlyMap<string, Uint8Array>, schemas: ReadonlyMap<string, Uint8Array>, trustedDigest?: string): ExportManifest {
  checkPaths([...files.keys()]);
  if ([...files.values()].reduce((n, b) => n + b.length, 0) >= ZIP_LIMITS.bytes) refuse('inventory.limit', 'Bundle exceeds v1 limits');
  const raw = files.get('manifest.json'); if (!raw) refuse('inventory.manifest', 'Manifest is missing');
  if (trustedDigest !== undefined && sha256(raw) !== trustedDigest) refuse('inventory.digest', 'Trusted manifest digest differs');
  const p = parseJson(raw); if (!p.ok) refuse('inventory.json', p.diagnostic.message);
  if (validateDocumentSchema(p.value).length || !object(p.value) || p.value.format !== 'maplab.export') refuse('inventory.schema', 'Invalid export manifest');
  if (!exportBytes(p.value).equals(raw)) refuse('inventory.canonical', 'Manifest must be canonical');
  const m = p.value as unknown as ExportManifest;
  checkPaths(m.files.map((f) => f.path));
  if (m.externalMaps.length) refuse('inventory.external', 'External maps are unsupported');
  if (m.files.length !== files.size - 1) refuse('inventory.unlisted', 'Inventory must list every non-manifest file');
  for (let i = 0; i < m.files.length; i++) {
    const f = m.files[i]!;
    if (i && compare(m.files[i - 1]!.path, f.path) >= 0 || f.path === 'manifest.json') refuse('inventory.order', 'Manifest entries must be lexical and exclude itself');
    const b = files.get(f.path); if (!b) refuse('inventory.missing', `Missing ${f.path}`);
    if (b.length !== f.bytes) refuse('inventory.size', `Size differs: ${f.path}`);
    if (sha256(b) !== f.sha256) refuse('inventory.sha256', `Digest differs: ${f.path}`);
  }
  const docs: JsonValue[] = [], ids = new Set<string>(), paths = new Set<string>();
  for (let i = 1; i < m.documents.length; i++) if (compare(m.documents[i - 1]!.id, m.documents[i]!.id) >= 0) refuse('inventory.order', 'Documents must be unique and sorted by ID');
  for (const d of m.documents) {
    const raw = files.get(d.path), role = m.files.find((f) => f.path === d.path)?.role;
    if (!raw || role !== 'authored' || ids.has(d.id) || paths.has(d.path)) refuse('inventory.document', 'Document index is incomplete or duplicated');
    const parsed = parseJson(raw); if (!parsed.ok) refuse('inventory.json', parsed.diagnostic.message);
    const v = parsed.value;
    if (!object(v) || v.id !== d.id || v.format !== d.format || v.version !== d.version || !sources.has(d.format)) refuse('inventory.document', 'Document identity differs');
    if (!exportBytes(v).equals(raw)) refuse('inventory.canonical', 'Authored file must be canonical');
    ids.add(d.id); paths.add(d.path); docs.push(v);
  }
  if (m.files.some((f) => f.role === 'authored' && !paths.has(f.path))) refuse('inventory.document', 'Unindexed authored file');
  if (!m.documents.some((d) => d.id === m.entryMapId && d.format === 'maplab.map')) refuse('inventory.entry', 'Entry map is absent');
  const graph = validateSourceGraph(docs); if (!graph.ok) refuse('inventory.closure', graph.diagnostics.map((d) => d.message).join('; '));
  const usedAssets = new Set<string>();
  for (const value of graph.documents) {

    if ('assets' in value) for (const a of value.assets) {
      const data = files.get(a.path);
      if (!data || m.files.find((f) => f.path === a.path)?.role !== 'asset') refuse('inventory.asset', `Missing asset: ${a.id}`);
      const image = inspectImage(data, a.mediaType);
      if (image.size[0] !== a.size[0] || image.size[1] !== a.size[1] || !Buffer.from(image.bytes).equals(data)) refuse('inventory.asset', `Asset metadata or approved bytes differ: ${a.id}`);
      usedAssets.add(a.path);
    }
  }
  const foreign=verifyForeign(graph.documents,files);
  for(const p of foreign.used)if(m.files.find(f=>f.path===p)?.role!=='foreign')refuse('inventory.foreign','Foreign role differs');
  if (m.files.some((f) => f.role === 'asset' && !usedAssets.has(f.path) || f.role === 'derived' || f.role === 'foreign' && !foreign.used.has(f.path))) refuse('inventory.role', 'Unreferenced assets or unsupported runtime artifacts');
  const entries = new Map(m.documents.map((d) => [d.id, d]));
  const reached = new Set<string>(), pending = [m.entryMapId];
  while (pending.length) {
    const id = pending.pop()!; if (reached.has(id)) continue; reached.add(id);
    const value = graph.documents.find((d) => d.id === id)!;
    if ('dependencies' in value) for (const dep of value.dependencies) {
      const target = entries.get(dep.id);
      if (!target) { if (dep.kind==='riglab' && foreign.used.has(dep.path)) continue; if (dep.required) refuse('inventory.closure', `Missing dependency ${dep.id}`); continue; }
      if (target.path !== dep.path || target.format !== `maplab.${dep.kind}`) refuse('inventory.closure', `Dependency identity differs: ${dep.id}`);
      pending.push(dep.id);
    }
  }
  if (reached.size !== entries.size) refuse('inventory.closure', 'Unreachable document in bundle');
  if (canonical(requiredContracts(graph.documents,foreign.contracts) as unknown as JsonValue) !== canonical(m.requiredContracts as unknown as JsonValue)) refuse('inventory.contracts', 'Required contract inventory differs from source bindings');
  const expectedSchemas = new Set(['maplab.export', ...m.documents.map((d) => d.format)].map((format) => `schemas/${format}.v1.schema.json`));
  if (m.files.some((f) => f.role === 'schema' && !expectedSchemas.has(f.path))) refuse('inventory.schema', 'Unexpected schema file');
  for (const format of new Set(['maplab.export', ...m.documents.map((d) => d.format)])) {
    const path = `schemas/${format}.v1.schema.json`, actual = files.get(path);
    if (!actual || m.files.find((f) => f.path === path)?.role !== 'schema' || !schemas.has(path) || !Buffer.from(schemas.get(path)!).equals(actual)) refuse('inventory.schema', `Pinned schema missing or changed: ${path}`);
  }
  return m;
}
