// Shared ML-009 helpers: scratch copies of the placeholder library, the real plugin on an in-process Vite dev
// server, and raw HTTP requests whose Host, Origin and other headers each test sets itself.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { libraryForm } from '../src/library/library-form';
import { maplabLibrary } from '../src/library/plugin';
import type { LibraryFolder } from '../src/library/folder';
import type { WriteStep } from '../src/library/writer';

export const repoRoot = fileURLToPath(new URL('../', import.meta.url));
export const placeholderDir = join(repoRoot, 'placeholder-library');
export const FOREST = 'maps/forest.map.json';
export const CLEARING = 'maps/clearing.map.json';
export const sha256 = (bytes: Buffer | Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

const made: string[] = [];
/** A fresh scratch copy of the placeholder library, by its real path (macOS tmpdir is a symlink). */
export function scratchLibrary(): LibraryFolder {
  const parent = mkdtempSync(join(tmpdir(), 'maplab-library-'));
  made.push(parent);
  const dir = join(realpathSync(parent), 'library');
  cpSync(placeholderDir, dir, { recursive: true });
  return { dir, label: dir, placeholder: false };
}
export function cleanup(): void { for (const p of made.splice(0)) rmSync(p, { recursive: true, force: true }); }

export const file = (f: LibraryFolder, path: string): Buffer => readFileSync(join(f.dir, path));
export const text = (f: LibraryFolder, path: string): string => file(f, path).toString('utf8');
export function put(f: LibraryFolder, path: string, bytes: string | Buffer): void {
  mkdirSync(dirname(join(f.dir, path)), { recursive: true });
  writeFileSync(join(f.dir, path), bytes);
}
export const json = (f: LibraryFolder, path: string): Record<string, unknown> & { metadata: { name: string } } => JSON.parse(text(f, path));
export const backups = (f: LibraryFolder): string[] => (existsSync(join(f.dir, 'backups')) ? readdirSync(join(f.dir, 'backups')).sort() : []);
export const indexOf = (f: LibraryFolder): { documents: { id: string; kind: string; path: string; sha256: string }[] } => JSON.parse(text(f, 'maplab.project.json'));
/** Every file of the library with its digest, to prove a refused request changed nothing. */
export function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${name.name}` : name.name;
      if (name.isDirectory()) walk(r); else out[r] = sha256(readFileSync(join(dir, r)));
    }
  };
  walk('');
  return out;
}

/** A library-form save body: `path`'s map renamed, based on its current file digest. */
export function renamed(f: LibraryFolder, path: string, name: string, id?: string): { id: string; kind: 'map'; text: string; baseDigest: string } {
  const doc = json(f, path);
  doc.metadata = { ...doc.metadata, name };
  return { id: id ?? (doc.id as string), kind: 'map', text: libraryForm(doc as never), baseDigest: sha256(file(f, path)) };
}

export interface Server { readonly server: ViteDevServer; readonly port: number; steps: WriteStep[]; fault: ((s: WriteStep) => void) | null; close(): Promise<void> }

/** The real plugin on a Vite dev server bound to 127.0.0.1, with step recording and fault injection. */
export async function startServer(library: string): Promise<Server> {
  const state: { steps: WriteStep[]; fault: ((s: WriteStep) => void) | null } = { steps: [], fault: null };
  const server = await createServer({
    configFile: false, root: repoRoot, logLevel: 'silent', appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [maplabLibrary({ repoRoot, library, hooks: { onStep: (s) => { state.steps.push(s); state.fault?.(s); } } })],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  });
  await server.listen();
  const port = (server.httpServer?.address() as AddressInfo).port;
  return {
    server, port,
    get steps() { return state.steps; }, set steps(v) { state.steps = v; },
    get fault() { return state.fault; }, set fault(v) { state.fault = v; },
    close: () => server.close(),
  };
}

export interface Reply { readonly status: number; readonly body: Record<string, unknown> & { code?: string; ok?: boolean }; readonly raw: string }

/** A raw request; headers default to MapLab's own page on this server, and `null` removes one. */
export function call(port: number, path: string, options: { method?: string; headers?: Record<string, string | null>; body?: string | object | Buffer } = {}): Promise<Reply> {
  const defaults: Record<string, string> = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' };
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...defaults, ...options.headers })) if (v !== null && v !== undefined) headers[k] = v;
  const body = typeof options.body === 'string' || Buffer.isBuffer(options.body) ? options.body : JSON.stringify(options.body ?? {});
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method: options.method ?? 'POST', headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed: Reply['body'] = {};
        try { parsed = JSON.parse(raw); } catch { /* Vite's own refusals are plain text */ }
        done({ status: res.statusCode ?? 0, body: parsed, raw });
      });
    });
    req.on('error', fail);
    req.end(body);
  });
}
