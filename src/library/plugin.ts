// Node only: the dev-server plugin that serves and writes the library folder (adopted H4, R1 H4/H8, the RigLab
// pattern). Its middleware is installed ahead of Vite's own, and every /__maplab/ request passes the loopback
// guard before anything is read. Requests run one at a time, so a save never interleaves with another read or
// write. The watcher reports outside edits, ignoring this server's own recent writes. Vite restarts the server
// when this code changes, because `vite.config.ts` imports it.
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, relative, sep } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { LibraryError, chooseLibrary, readLibrary, snapshot, type LibraryFolder } from './folder';
import { guardRefusal, isLibraryUrl } from './guard';
import { BACKUP_FOLDER, KIND_FOLDERS } from './layout';
import { CHANGED_EVENT, PROJECT_INDEX, REQUEST_LIMIT, ROUTES, SAVED_EVENT, SAVE_LIMIT, type ChangedEvent, type Identity, type ReadResponse, type SavedEvent } from './protocol';
import { recoverDocument, writeSave, type WriteHooks } from './writer';

/** How long the watcher ignores a path this server just wrote. */
export const RECENT_WRITE_MS = 2_000;
const CHANGE_SETTLE_MS = 150;

export interface LibraryPluginOptions {
  readonly repoRoot: string;
  /** The library folder, overriding `MAPLAB_LIBRARY`; for tests. */
  readonly library?: string;
  readonly hooks?: WriteHooks;
  readonly now?: () => Date;
}

/** Paths this server wrote, so its own saves are not reported back as outside edits. */
export class RecentWrites {
  private readonly until = new Map<string, number>();
  constructor(private readonly clock: () => number = Date.now) {}
  add(paths: readonly string[]): void { for (const p of paths) this.until.set(p, this.clock() + RECENT_WRITE_MS); }
  owns(path: string): boolean {
    const t = this.until.get(path);
    if (t === undefined) return false;
    if (t >= this.clock()) return true;
    this.until.delete(path);
    return false;
  }
}

/**
 * The request body as text, or null past `limit` bytes; an oversized body is drained so the client reads the refusal.
 * Bytes that are not UTF-8 reject, so a save never writes text that differs from what the page sent.
 */
export function readBody(request: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= limit) chunks.push(chunk); });
    request.on('end', () => {
      if (size > limit) return done(null);
      try { done(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { fail(new LibraryError('request.encoding', 'The request body is not UTF-8')); }
    });
    request.on('error', fail);
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(body));
}
const no = (code: string, message: string): object => ({ ok: false, code, message });

/** Whether a watcher path is a document or index file of `folder` (not a backup, cache or temporary file). */
export function watchedPath(folder: LibraryFolder, path: string): string | null {
  if (!path.startsWith(folder.dir + sep)) return null;
  const rel = relative(folder.dir, path).split(sep).join('/');
  if (rel === PROJECT_INDEX) return rel;
  const [top, name, more] = rel.split('/');
  if (more !== undefined || !name || name.startsWith('.') || top === BACKUP_FOLDER || !Object.values(KIND_FOLDERS).includes(top ?? '')) return null;
  return rel;
}

export function maplabLibrary(options: LibraryPluginOptions): Plugin {
  const now = options.now ?? (() => new Date());
  return {
    name: 'maplab-library',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      let folder: LibraryFolder | null = null;
      let unavailable = '';
      try {
        folder = chooseLibrary({ repoRoot: options.repoRoot, env: options.library ?? process.env.MAPLAB_LIBRARY });
        server.config.logger.info(`MapLab library: ${folder.label}${folder.placeholder ? ' (read-only)' : ''}`);
      } catch (e) {
        unavailable = e instanceof Error ? e.message : String(e);
        server.config.logger.error(`MapLab library unavailable: ${unavailable}`);
      }
      const recent = new RecentWrites();
      let queue: Promise<unknown> = Promise.resolve();
      const serial = <T>(work: () => Promise<T>): Promise<T> => { const next = queue.then(work, work); queue = next.catch(() => undefined); return next; };
      const notify = (event: string, data: SavedEvent | ChangedEvent): void => { server.ws.send({ type: 'custom', event, data }); };

      async function route(url: string, body: unknown, response: ServerResponse): Promise<void> {
        const f = folder as LibraryFolder;
        if (url === ROUTES.identity) return send(response, 200, { app: 'maplab', pid: process.pid, root: realpathSync(server.config.root), library: f.label } satisfies Identity);
        if (url === ROUTES.library) return send(response, 200, await snapshot(await readLibrary(f)));
        if (url === ROUTES.read) {
          const ids = (body as { ids?: unknown }).ids;
          if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string') || ids.length > 64) return send(response, 400, no('read.request', 'A read is {ids: [...]} with at most 64 IDs'));
          const read = await readLibrary(f);
          const out: { id: string; path: string; digest: string; text: string }[] = [];
          for (const id of ids as string[]) {
            const d = read.documents.find((x) => x.id === id);
            if (!d?.bytes || !d.digest) return send(response, 404, no('read.missing', `${id} is not readable in the library`));
            out.push({ id, path: d.path, digest: d.digest, text: new TextDecoder('utf-8', { fatal: true }).decode(d.bytes) });
          }
          return send(response, 200, { ok: true, documents: out } satisfies ReadResponse);
        }
        if (url === ROUTES.save || url === ROUTES.recover) {
          const saveId = randomUUID();
          const outcome = url === ROUTES.save ? await writeSave(f, body, saveId, now(), options.hooks) : await recoverDocument(f, body, saveId, now(), options.hooks);
          if (!outcome.ok) return send(response, outcome.status, outcome.refusal);
          recent.add(outcome.touched.map((p) => join(f.dir, ...p.split('/'))));
          notify(SAVED_EVENT, { saveId, paths: outcome.touched });
          server.config.logger.info(`MapLab library: ${url === ROUTES.save ? 'saved' : 'recovered'} ${outcome.touched.join(', ')} in ${f.label}`);
          return send(response, 200, outcome.result);
        }
        return send(response, 404, no('route.unknown', `No library endpoint ${url}`));
      }

      server.middlewares.use((request: IncomingMessage, response: ServerResponse, next: () => void) => {
        if (!isLibraryUrl(request.url)) return next();
        const refusal = guardRefusal(request);
        if (refusal) { request.resume(); return send(response, refusal.status, no(refusal.code, refusal.message)); }
        if (!folder) { request.resume(); return send(response, 503, no('library.unavailable', unavailable)); }
        const url = (request.url ?? '').split('?')[0] as string;
        void (async () => {
          const text = await readBody(request, url === ROUTES.save ? SAVE_LIMIT : REQUEST_LIMIT);
          if (text === null) return send(response, 413, no('request.too-large', 'The request body is too large'));
          let body: unknown;
          try { body = JSON.parse(text); } catch { return send(response, 400, no('request.json', 'The request body is not JSON')); }
          await serial(() => route(url, body, response));
        })().catch((e: unknown) => {
          const known = e instanceof LibraryError;
          if (!known) server.config.logger.error(`MapLab library request failed: ${e instanceof Error ? e.stack : String(e)}`);
          if (!response.headersSent) send(response, known ? (e.code === 'request.encoding' ? 400 : 409) : 500, no(known ? e.code : 'library.failed', e instanceof Error ? e.message : String(e)));
        });
      });

      if (folder) {
        const f = folder;
        server.watcher.add(f.dir);
        let pending = new Set<string>();
        let timer: ReturnType<typeof setTimeout> | undefined;
        server.watcher.on('all', (_event: string, path: string) => {
          const rel = watchedPath(f, path);
          if (rel === null || recent.owns(path)) return;
          pending.add(rel);
          clearTimeout(timer);
          timer = setTimeout(() => { const paths = [...pending].sort(); pending = new Set(); notify(CHANGED_EVENT, { paths }); }, CHANGE_SETTLE_MS);
        });
      }
    },
  };
}
