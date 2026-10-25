import {readRig} from './riglab';
import {validateBinding} from '../riglab/presentation';
import {verifyForeign} from '../riglab/foreign';
// Node-only saved-library export adapter. The format/inventory/ZIP core has no library imports.
import { readFileSync } from 'node:fs';
import { parseJson, validateDocumentSchema, validateSourceGraph, type ExportManifest, type JsonValue, type SourceDocument } from '../contracts';
import { exportBytes, exportValue, requiredContracts, sha256, verifyFiles, type ExportBundle } from '../export/bundle';
import { compare, readStoreZip, refuse, storeZip, ZIP_LIMITS } from '../export/zip';
import { type LibraryFolder, readLibraryFile } from './folder';
import { checkIndex } from './layout';
import { PROJECT_INDEX } from './protocol';
import { readAsset } from './assets';
import pkg from '../../package.json' with { type: 'json' };
const sources = new Set(['maplab.map', 'maplab.tileset', 'maplab.catalog', 'maplab.movement']);
const object = (v: unknown): v is Record<string, JsonValue> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** The exact local schema bytes injected into the independent format verifier. */
export const pinnedSchemas: ReadonlyMap<string, Uint8Array> = new Map(['map', 'movement', 'catalog', 'tileset', 'export'].map((kind) => {
  const path = `schemas/maplab.${kind}.v1.schema.json`;
  return [path, readFileSync(new URL(`../../${path}`, import.meta.url))];
}));
export async function exportLibrary(folder: LibraryFolder, entryMapId: string, baseDigest: string): Promise<ExportBundle> {
  const indexBytes = readLibraryFile(folder, PROJECT_INDEX);
  if (!indexBytes) refuse('export.index', 'Project index is missing');
  const parsedIndex = parseJson(indexBytes); if (!parsedIndex.ok) refuse('export.index', parsedIndex.diagnostic.message);
  const checked = checkIndex(parsedIndex.value); if (!checked.ok) refuse('export.index', checked.diagnostics.map((d) => d.message).join('; '));
  const documents = checked.index.documents, selected = new Map<string, { path: string; value: SourceDocument }>();
  const entry = documents.find((d) => d.id === entryMapId && d.kind === 'map');
  const entryBytes = entry ? readLibraryFile(folder, entry.path) : null;
  if (!entryBytes || sha256(entryBytes) !== baseDigest) refuse('export.stale', 'The saved entry map changed; reopen it before exporting');
  let sourceBytes = 0;
  const needed = new Set<string>();
  const pending = [entryMapId];
  for (;;) {
    while (pending.length) {
      const id = pending.pop()!; if (selected.has(id)) continue;
      const d = documents.find((x) => x.id === id);
      const raw = d ? readLibraryFile(folder, d.path) : null;
      if (!d || !raw || sha256(raw) !== d.sha256) refuse('export.revision', `Missing or torn dependency ${id}`);
      sourceBytes += raw.length; if (sourceBytes >= ZIP_LIMITS.bytes || selected.size >= ZIP_LIMITS.files) refuse('export.limit', 'Source closure exceeds bundle limits');
      const parsed = parseJson(raw); if (!parsed.ok) refuse('export.json', `${id}: ${parsed.diagnostic.message}`);
      const issues = validateDocumentSchema(parsed.value); if (issues.length) refuse('export.schema', `${id}: ${issues[0]!.message}`);
      const value = parsed.value as unknown as SourceDocument;
      if (value.id !== id || value.format !== `maplab.${d.kind}` || !sources.has(value.format)) refuse('export.format', `Unsupported or mismatched export document ${id}`);
      selected.set(id, { path: d.path, value });
      // Follow typed document references only: a flag, label or string parameter may
      // legitimately equal a document ID without making that document a dependency.
      if (value.format === 'maplab.map') {
        value.terrain.forEach((t) => needed.add(t.tilesetId));
        value.entities.forEach((e) => {
          if ('movementId' in e) needed.add(e.movementId);
          if ('destination' in e && e.destination) needed.add(e.destination.mapId);
        });
        value.navigation.modeVolumes.forEach((v) => v.profileIds.forEach((id) => needed.add(id)));
        value.navigation.overrides.forEach((v) => v.profileIds.forEach((id) => needed.add(id)));
        value.presentations.forEach((p) => needed.add(p.bundleDependencyId));
      }
      const typedRefs = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(typedRefs);
        else if (object(v)) {
          if (object(v.ref)) {
            if (v.ref.kind === 'movement' && typeof v.ref.id === 'string') needed.add(v.ref.id);
            if (typeof v.ref.mapId === 'string') needed.add(v.ref.mapId);
          }
          for (const [k, x] of Object.entries(v)) if (!['dependencies', 'prefabPlacements', 'metadata', 'entries'].includes(k)) typedRefs(x);
        }
      };
      typedRefs(value);
      if ('dependencies' in value) for (const dep of value.dependencies) {
        if (dep.kind !== 'riglab' && (dep.required || dep.kind !== 'prefab' && dep.kind !== 'catalog' && needed.has(dep.id))) {
          const target = documents.find((x) => x.id === dep.id);
          if (!target || target.path !== dep.path || target.kind !== dep.kind) refuse('export.dependency', `Missing or mismatched dependency ${dep.id}`);
          pending.push(dep.id);
        }
      }
    }
    // Typed references and catalog bindings can live in transitive movement profiles.
    // Expand all optional dependency edges to a fixed point after each document pass.
    const bindings = new Set(requiredContracts([...selected.values()].map((d) => d.value)).map((c) => `${c.key}@${c.version}`));
    for (const { value } of selected.values()) if ('dependencies' in value) for (const dep of value.dependencies) {
      if (dep.kind==='riglab' || dep.required || selected.has(dep.id)) continue;
      if (dep.kind !== 'catalog') {
        if (dep.kind !== 'prefab' && needed.has(dep.id)) {
          const target = documents.find((d) => d.id === dep.id);
          if (!target || target.path !== dep.path || target.kind !== dep.kind) refuse('export.dependency', `Missing or mismatched dependency ${dep.id}`);
          pending.push(dep.id);
        }
        continue;
      }
      const candidate = documents.find((d) => d.id === dep.id), raw = candidate ? readLibraryFile(folder, candidate.path) : null;
      const parsed = raw ? parseJson(raw) : null;
      if (parsed?.ok && object(parsed.value) && Array.isArray(parsed.value.entries)
        && parsed.value.entries.some((e) => object(e) && bindings.has(`${e.key}@${e.version}`))) {
        if (candidate!.path !== dep.path || candidate!.kind !== 'catalog') refuse('export.dependency', `Mismatched catalog ${dep.id}`);
        pending.push(dep.id);
      }
    }
    if (!pending.length) break;
  }
  const values = [...selected.values()].map((d) => d.value as unknown as JsonValue), graph = validateSourceGraph(values);
  if (!graph.ok) refuse('export.validation', graph.diagnostics.map((d) => `${d.documentId ?? ''}${d.jsonPath}: ${d.message}`).join('; '));
  const files = new Map<string, Uint8Array>(), roles = new Map<string, ExportManifest['files'][number]['role']>();
  const add = (path: string, data: Uint8Array, role: ExportManifest['files'][number]['role']): void => {
    const old = files.get(path); if (old && (!Buffer.from(old).equals(data) || roles.get(path) !== role)) refuse('export.path', `Conflicting file ${path}`);
    files.set(path, data); roles.set(path, role);
    if (files.size > ZIP_LIMITS.files || [...files.values()].reduce((n, b) => n + b.length, 0) >= ZIP_LIMITS.bytes) refuse('export.limit', 'Bundle exceeds v1 limits');
  };
  for (const { path, value } of selected.values()) {
    add(path, exportBytes(exportValue(value as unknown as JsonValue)), 'authored');
    if ('presentations' in value) for (const binding of value.presentations) {
      const dep=value.dependencies.find(d=>d.id===binding.bundleDependencyId&&d.kind==='riglab');
      if(!dep) refuse('export.presentation','Missing RigLab dependency');
      const bundle=readRig(folder,dep!.path);validateBinding(bundle,binding,value.assets);
      const prefix=dep!.path.slice(0,-'manifest.json'.length);
      for(const [p,b]of bundle.files)add(prefix+p,b,'foreign');
    }
    if ('assets' in value) for (const a of value.assets) {
      const result = readAsset(folder, { path: a.path });
      if (result.asset.mediaType !== a.mediaType || result.asset.size[0] !== a.size[0] || result.asset.size[1] !== a.size[1]) refuse('export.asset', `Asset metadata differs from approved bytes: ${a.id}`);
      add(a.path, Buffer.from(result.base64, 'base64'), 'asset');
    }
  }
  // Ship the exact locally published schemas used to validate, including the container schema.
  for (const format of new Set(['maplab.export', ...[...selected.values()].map((d) => d.value.format)])) {
    const path = `schemas/${format}.v1.schema.json`;
    add(path, pinnedSchemas.get(path)!, 'schema');
  }
  const manifest: ExportManifest = { format: 'maplab.export', version: 1, generator: { name: 'MapLab', version: pkg.version }, entryMapId,
    documents: [...selected].sort(([a], [b]) => compare(a, b)).map(([id, d]) => ({ id, format: d.value.format, version: 1, path: d.path })),
    files: [...files].sort(([a], [b]) => compare(a, b)).map(([path, b]) => ({ path, bytes: b.length, sha256: sha256(b), role: roles.get(path)! })),
    requiredContracts: requiredContracts([...selected.values()].map((d) => d.value),verifyForeign(graph.documents,files).contracts), externalMaps: [] };
  add('manifest.json', exportBytes(manifest), 'authored');
  verifyFiles(files, pinnedSchemas);
  const zip = storeZip(files); verifyFiles(readStoreZip(zip), pinnedSchemas);
  return { manifest, digest: sha256(files.get('manifest.json')!), files, zip, warnings: graph.diagnostics.filter((d) => d.severity === 'warning').map((d) => `${d.code}: ${d.message}`) };
}
