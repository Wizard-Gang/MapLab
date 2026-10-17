// G1 steps 1–2 for a folder bundle: bounded safe-path inventory, then manifest parsing and
// byte verification (complete inventory, exact sizes, SHA-256, bundle digest).
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ReaderError, jcs, parseStrict } from './json.mjs';
import { validate } from './schema.mjs';

export const BUNDLE_LIMITS = Object.freeze({ files: 20_000, totalBytes: 512 * 1024 * 1024, depth: 16 });
const SEGMENT = /^[A-Za-z0-9_](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const ARCHIVE = /\.(?:zip|jar|7z|rar|tar|gz|tgz|bz2|xz)$/i;
export const ASSET_TYPES = Object.freeze({ '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.wav': 'audio/wav' });
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Returns null for a portable bundle-relative POSIX path, otherwise the problem. */
export function pathProblem(path) {
  if (typeof path !== 'string' || path.length === 0) return 'empty';
  if (Buffer.byteLength(path, 'utf8') > 240) return 'too long';
  for (const segment of path.split('/')) {
    if (!SEGMENT.test(segment)) return `unsafe segment "${segment}"`;
    if (RESERVED.test(segment)) return `reserved device name "${segment}"`;
  }
  return null;
}

/** Reads every regular file under `root` without following links. Throws on the first unsafe entry. */
export function readInventory(root) {
  const top = lstatSync(root);
  if (!top.isDirectory()) throw new ReaderError('bundle.root', 'Bundle root must be a real directory');
  const files = new Map();
  const aliases = new Map();
  let total = 0;
  const walk = (dir, prefix, depth) => {
    if (depth > BUNDLE_LIMITS.depth) throw new ReaderError('bundle.limit', `Directory nesting exceeds ${BUNDLE_LIMITS.depth}`, prefix);
    const names = readdirSync(dir).sort();
    if (prefix && names.length === 0) throw new ReaderError('bundle.empty-directory', `Empty directory ${prefix}; folder bundles carry files only`, prefix);
    for (const name of names) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(join(dir, name));
      if (stat.isSymbolicLink()) throw new ReaderError('bundle.symlink', `Symbolic links are refused: ${rel}`, rel);
      const problem = pathProblem(rel);
      if (problem) throw new ReaderError('bundle.path', `Unsafe entry path ${JSON.stringify(rel)}: ${problem}`, rel);
      const alias = rel.toLowerCase();
      if (aliases.has(alias)) throw new ReaderError('bundle.path-alias', `${rel} aliases ${aliases.get(alias)}`, rel);
      aliases.set(alias, rel);
      if (stat.isDirectory()) { walk(join(dir, name), rel, depth + 1); continue; }
      if (!stat.isFile()) throw new ReaderError('bundle.special-file', `Not a regular file: ${rel}`, rel);
      if (ARCHIVE.test(name)) throw new ReaderError('bundle.nested-archive', `Nested archives are refused: ${rel}`, rel);
      if (files.size >= BUNDLE_LIMITS.files) throw new ReaderError('bundle.limit', `More than ${BUNDLE_LIMITS.files} files`, rel);
      total += stat.size;
      if (total > BUNDLE_LIMITS.totalBytes) throw new ReaderError('bundle.limit', 'Bundle exceeds the expansion limit', rel);
      files.set(rel, readFileSync(join(dir, name)));
    }
  };
  walk(root, '', 0);
  if (!files.has('manifest.json')) throw new ReaderError('bundle.manifest-missing', 'manifest.json is missing at the bundle root');
  return files;
}

const sortedUnique = (values) => values.every((v, i) => i === 0 || values[i - 1] < v);

/** Parses and verifies manifest.json against the pinned export schema and the inventory. */
export function verifyManifest(files, schemas, pinnedSchemaBytes) {
  const bytes = files.get('manifest.json');
  const at = (e) => Object.assign(e, { file: 'manifest.json' });
  let manifest;
  try { manifest = parseStrict(bytes); } catch (e) { throw at(e); }
  const exportSchema = schemas.get('maplab.export@1');
  if (manifest?.format !== 'maplab.export' || manifest?.version !== 1) throw at(new ReaderError('document.version', 'Manifest must be maplab.export version 1 exactly', '$.version'));
  const violations = validate(exportSchema, manifest);
  if (violations.length) throw at(new ReaderError(`schema.${violations[0].keyword}`, `Manifest violates maplab.export v1 (${violations.length} findings)`, violations[0].path));
  if (Buffer.compare(Buffer.from(jcs(manifest), 'utf8'), bytes) !== 0) throw at(new ReaderError('manifest.canonical', 'Manifest bytes are not RFC 8785 canonical'));
  const paths = manifest.files.map((f) => f.path);
  if (!sortedUnique(paths)) throw at(new ReaderError('manifest.order', 'files must be unique and sorted by path', '$.files'));
  if (!sortedUnique(manifest.documents.map((d) => d.id))) throw at(new ReaderError('manifest.order', 'documents must be unique and sorted by id', '$.documents'));
  const listedAliases = new Set();
  manifest.files.forEach((f, i) => {
    const problem = pathProblem(f.path);
    if (problem) throw at(new ReaderError('manifest.path', `Unsafe listed path: ${problem}`, `$.files[${i}].path`));
    if (f.path === 'manifest.json') throw at(new ReaderError('manifest.self', 'The manifest must exclude itself', `$.files[${i}]`));
    if (listedAliases.has(f.path.toLowerCase())) throw at(new ReaderError('manifest.path', 'Listed paths alias by case', `$.files[${i}].path`));
    listedAliases.add(f.path.toLowerCase());
  });
  for (const path of files.keys()) {
    if (path !== 'manifest.json' && !paths.includes(path)) throw new ReaderError('inventory.unlisted', `Unlisted bundle entry ${path}`, path);
  }
  manifest.files.forEach((f, i) => {
    const actual = files.get(f.path);
    if (!actual) throw at(new ReaderError('inventory.missing', `Listed file ${f.path} is absent`, `$.files[${i}]`));
    if (actual.length !== f.bytes) throw at(new ReaderError('inventory.size', `${f.path} has ${actual.length} bytes, manifest says ${f.bytes}`, `$.files[${i}].bytes`));
    if (sha256(actual) !== f.sha256) throw at(new ReaderError('inventory.sha256', `${f.path} SHA-256 differs from the manifest`, `$.files[${i}].sha256`));
    const ext = (f.path.match(/\.[a-z0-9]+$/) ?? [''])[0];
    if (f.role === 'asset' && !Object.hasOwn(ASSET_TYPES, ext)) throw at(new ReaderError('asset.extension', `Asset ${f.path} has an unapproved extension`, `$.files[${i}].path`));
    if (f.role === 'schema') {
      const m = /^schemas\/(maplab\.[a-z]+)\.v([1-9][0-9]*)\.schema\.json$/.exec(f.path);
      const pinned = m && pinnedSchemaBytes.get(`${m[1]}@${m[2]}`);
      if (!pinned || Buffer.compare(pinned, actual) !== 0) throw at(new ReaderError('schema.mismatch', `${f.path} is not a schema this reader pins`, `$.files[${i}]`));
    }
  });
  manifest.documents.forEach((d, i) => {
    const file = manifest.files.find((f) => f.path === d.path);
    if (!file || file.role !== 'authored') throw at(new ReaderError('manifest.document-file', `Document ${d.id} must name an authored file`, `$.documents[${i}].path`));
  });
  manifest.files.forEach((f, i) => {
    if (f.role === 'authored' && !manifest.documents.some((d) => d.path === f.path)) throw at(new ReaderError('manifest.unindexed', `Authored file ${f.path} has no document entry`, `$.files[${i}]`));
  });
  return { manifest, bundleSha256: sha256(bytes) };
}
