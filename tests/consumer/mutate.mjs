// Applies one inert conformance mutation record to a temporary copy of a bundle. Test-only:
// JSON edits re-encode the edited file as RFC 8785 and re-hash it in the manifest unless the
// record says `"rehash": false`, so each record isolates exactly one defect.
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { jcs, parseStrict } from '../../consumer/json.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const tokens = (pointer) => pointer.split('/').slice(1).map((t) => t.replaceAll('~1', '/').replaceAll('~0', '~'));

function edit(value, pointer, op, replacement) {
  const keys = tokens(pointer);
  const last = keys.pop();
  const parent = keys.reduce((node, k) => node[Array.isArray(node) ? Number(k) : k], value);
  if (op === 'set') parent[Array.isArray(parent) ? Number(last) : last] = replacement;
  else if (op === 'remove') { if (Array.isArray(parent)) parent.splice(Number(last), 1); else delete parent[last]; }
  else if (op === 'append') parent[last].push(replacement);
  else if (op === 'insertSorted') { parent[last].push(replacement); parent[last].sort((a, b) => (jcs(a.key ?? a.path ?? a.id) < jcs(b.key ?? b.path ?? b.id) ? -1 : 1)); }
}

/** Copies `source` to `dir` and applies `record.edits` in order; `schemaDir` supplies pinned schema bytes. */
export function materialize(source, dir, record, schemaDir) {
  rmSync(dir, { recursive: true, force: true });
  cpSync(source, dir, { recursive: true });
  const read = (p) => readFileSync(join(dir, p));
  const manifest = () => parseStrict(read('manifest.json'));
  const writeManifest = (m) => writeFileSync(join(dir, 'manifest.json'), jcs(m));
  const rehash = (path) => {
    const m = manifest();
    const f = m.files.find((x) => x.path === path);
    if (f) { const b = read(path); f.bytes = b.length; f.sha256 = sha(b); writeManifest(m); }
  };
  for (const e of record.edits) {
    if (e.file !== undefined) {
      const op = ['set', 'remove', 'append', 'insertSorted'].find((k) => e[k] !== undefined);
      if (op) {
        const v = parseStrict(read(e.file));
        edit(v, e[op], op, e.value);
        writeFileSync(join(dir, e.file), e.encoding === 'pretty' ? JSON.stringify(v, null, 2) : jcs(v));
      } else if (e.replace !== undefined) {
        const text = read(e.file).toString('latin1');
        if (!text.includes(e.replace)) throw new Error(`${record.id}: ${e.replace} not found in ${e.file}`);
        const withBytes = e.withHex !== undefined ? Buffer.from(e.withHex, 'hex').toString('latin1') : Buffer.from(e.with, 'utf8').toString('latin1');
        writeFileSync(join(dir, e.file), Buffer.from(text.replace(e.replace, withBytes), 'latin1'));
      } else if (e.truncate !== undefined) {
        const b = read(e.file);
        writeFileSync(join(dir, e.file), b.subarray(0, b.length - e.truncate));
      } else if (e.prependHex !== undefined) {
        writeFileSync(join(dir, e.file), Buffer.concat([Buffer.from(e.prependHex, 'hex'), read(e.file)]));
      } else if (e.reencode !== undefined) {
        const v = parseStrict(read(e.file));
        writeFileSync(join(dir, e.file), e.reencode === 'pretty' ? JSON.stringify(v, null, 2) : jcs(v));
      } else throw new Error(`${record.id}: unknown file edit`);
      if (e.file !== 'manifest.json' && e.rehash !== false) rehash(e.file);
    } else if (e.add !== undefined) {
      mkdirSync(dirname(join(dir, e.add)), { recursive: true });
      const bytes = e.copyOf !== undefined ? read(e.copyOf) : e.pinnedSchema !== undefined ? readFileSync(join(schemaDir, e.pinnedSchema)) : Buffer.from(e.text ?? '', 'utf8');
      writeFileSync(join(dir, e.add), bytes);
      if (e.role) {
        const m = manifest();
        m.files.push({ path: e.add, bytes: bytes.length, sha256: sha(bytes), role: e.role });
        m.files.sort((a, b) => (a.path < b.path ? -1 : 1));
        if (e.document) { m.documents.push({ ...e.document, path: e.add }); m.documents.sort((a, b) => (a.id < b.id ? -1 : 1)); }
        writeManifest(m);
      }
    } else if (e.delete !== undefined) {
      rmSync(join(dir, e.delete));
      if (e.unlist) {
        const m = manifest();
        m.files = m.files.filter((f) => f.path !== e.delete);
        m.documents = m.documents.filter((d) => d.path !== e.delete);
        writeManifest(m);
      }
    } else if (e.symlink !== undefined) {
      symlinkSync(e.target, join(dir, e.symlink));
    } else throw new Error(`${record.id}: unknown edit`);
  }
}
