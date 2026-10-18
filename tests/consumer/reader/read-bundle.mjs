#!/usr/bin/env node
// Independent MapLab bundle reader (ML-007). Usage:
//   node tests/consumer/reader/read-bundle.mjs --schemas SCHEMA_DIR [--expect-digest SHA256] BUNDLE_DIR
// Reads final bytes from disk and the pinned published schemas only; imports Node built-ins and
// this folder, never MapLab's src/, editor, React or build output. Runs the byte, manifest,
// negotiation, schema, closure and reference parts of G1 steps 1–4 (not the F3 semantic rules)
// and prints a JSON report. Exit 0 = accepted, 1 = rejected with diagnostics, 2 = usage or reader failure.
// It constructs no world, renderer, engine, controller or navigation, and certifies none of them.
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ReaderError, parseStrict } from './json.mjs';
import { compile } from './schema.mjs';
import { readInventory, sha256, verifyManifest } from './bundle.mjs';
import { SUPPORTED_FORMATS, checkClosure, loadDocuments } from './references.mjs';
import { checkReferences } from './resolve.mjs';

export const READER = Object.freeze({ name: 'maplab-independent-reader', version: 1 });

/** Loads `maplab.<format>.v<N>.schema.json` files; each `$id` must match its file name. */
export function loadSchemas(dir) {
  const schemas = new Map();
  const bytes = new Map();
  for (const name of readdirSync(dir).sort()) {
    const m = /^(maplab\.[a-z]+)\.v([1-9][0-9]*)\.schema\.json$/.exec(name);
    if (!m) continue;
    const raw = readFileSync(join(dir, name));
    const schema = parseStrict(raw);
    if (schema.$id !== `urn:maplab:schema:${m[1]}:${m[2]}`) throw new ReaderError('schema.identity', `${name} declares ${schema.$id}`);
    schemas.set(`${m[1]}@${m[2]}`, compile(schema, `${m[1]}@${m[2]}`));
    bytes.set(`${m[1]}@${m[2]}`, raw);
  }
  for (const f of ['maplab.export@1', ...SUPPORTED_FORMATS]) if (!schemas.has(f)) throw new ReaderError('schema.missing', `The pinned ${f} schema is required`);
  return { schemas, bytes };
}

/** Runs the staged pipeline; stops after the first stage that reports an error. */
export function readBundle(bundleDir, schemaDir, expectDigest = null) {
  const report = { reader: READER, ok: false, stage: 'inventory', bundleSha256: null, entryMapId: null, documents: [], maps: [], portals: [], skippedFiles: [], diagnostics: [],
    claims: { bytesVerified: false, schemasValidated: false, referencesResolved: false, worldConstructed: false, engineExecuted: false, navigationExecuted: false } };
  const fatal = (e) => { report.diagnostics.push({ code: e.code, file: e.file ?? null, path: e.path ?? '$', message: e.message }); return report; };
  const { schemas, bytes } = loadSchemas(schemaDir);
  let files, verified;
  try { files = readInventory(bundleDir); } catch (e) { if (e instanceof ReaderError) return fatal(e); throw e; }
  report.stage = 'manifest';
  try { verified = verifyManifest(files, schemas, bytes); } catch (e) { if (e instanceof ReaderError) return fatal(e); throw e; }
  const { manifest, bundleSha256 } = verified;
  report.bundleSha256 = bundleSha256;
  report.entryMapId = manifest.entryMapId;
  if (expectDigest !== null && expectDigest !== bundleSha256) return fatal(new ReaderError('bundle.digest', `Bundle digest ${bundleSha256} is not the trusted ${expectDigest}`));
  report.claims.bytesVerified = true;
  report.skippedFiles = manifest.files.filter((f) => f.role === 'derived' || f.role === 'foreign').map((f) => ({ path: f.path, role: f.role }));
  report.stage = 'documents';
  const docs = loadDocuments(manifest, files, schemas, report.diagnostics);
  if (report.diagnostics.length) return report;
  report.claims.schemasValidated = true;
  report.stage = 'closure';
  checkClosure(manifest, docs, report.diagnostics);
  if (report.diagnostics.length) return report;
  report.stage = 'references';
  report.portals = checkReferences(manifest, docs, report.diagnostics);
  if (report.diagnostics.length) return report;
  report.claims.referencesResolved = true;
  report.documents = manifest.documents.map((d) => ({ ...d, sha256: sha256(files.get(d.path)) }));
  report.maps = [...docs.values()].filter((d) => d.value.format === 'maplab.map').map(({ value: m }) => ({
    id: m.id, playerStarts: m.entities.filter((e) => e.kind === 'playerStart').map((e) => e.id), entities: m.entities.length,
    bodies: m.bodies.length, footholds: m.footholds.length, triggers: m.triggers.length, dependencies: m.dependencies.map((d) => d.id),
  }));
  report.stage = 'complete';
  report.ok = true;
  return report;
}

function main(argv) {
  let schemaDir = null, digest = null;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--schemas') schemaDir = argv[++i] ?? null;
    else if (argv[i] === '--expect-digest') digest = argv[++i] ?? null;
    else rest.push(argv[i]);
  }
  if (!schemaDir || rest.length !== 1 || (digest !== null && !/^[0-9a-f]{64}$/.test(digest))) {
    process.stderr.write('Usage: read-bundle.mjs --schemas SCHEMA_DIR [--expect-digest SHA256] BUNDLE_DIR\n');
    return 2;
  }
  let report;
  try { report = readBundle(rest[0], schemaDir, digest); } catch (e) {
    process.stderr.write(`Reader failure: ${e instanceof ReaderError ? `${e.code}: ` : ''}${e.message}\n`);
    return 2;
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
