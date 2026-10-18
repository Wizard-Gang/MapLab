// The rules behind `npm start` (R1 H8, the RigLab RL-029 pattern): teardown, reset, install, build, start,
// readiness, open. Node built-ins only, because the install step may replace node_modules/ while it runs.
// A process on the port is stopped only when it proves, through MapLab's guarded identity endpoint, that it is
// a MapLab dev server; anything else is left alone and reported.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const DEFAULT_PORT = 5182;
export const INSTALL_MARKER = 'node_modules/.maplab-install';
export const RESET_TARGETS = Object.freeze(['dist', 'node_modules/.vite']);
export const IDENTITY_ROUTE = '/__maplab/identity';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`MAPLAB_PORT must be a whole number from 1 to 65535; received ${JSON.stringify(value)}`);
  return port;
}

/** Disposable paths the reset step removes; refuses any target that would leave the checkout. */
export function resetPaths(root, targets = RESET_TARGETS) {
  const base = resolve(root);
  return targets.map((target) => {
    const path = resolve(base, target);
    if (!path.startsWith(base + sep)) throw new Error(`refusing to reset a path outside the checkout: ${path}`);
    return path;
  });
}

export const needsInstall = ({ nodeModules, lockHash, installedHash }) => !nodeModules || installedHash !== lockHash;

export const serverUrl = (port) => `http://127.0.0.1:${port}/`;

/** The MapLab identity a server on `port` reports, or null when nothing MapLab answers there. */
export async function identify(port, fetchImpl = fetch) {
  const host = `127.0.0.1:${port}`;
  try {
    const response = await fetchImpl(`http://${host}${IDENTITY_ROUTE}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://${host}` }, body: '{}', signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) { await response.body?.cancel(); return null; }
    const who = await response.json();
    return who?.app === 'maplab' && Number.isSafeInteger(who.pid) && who.pid > 1 && typeof who.root === 'string' ? who : null;
  } catch {
    return null;
  }
}

export function output(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.error) throw result.error;
  return result.status === 0 ? result.stdout.trim() : null;
}

/** PIDs listening on TCP `port`. */
export function portListeners(port, run = output) {
  return [...new Set((run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']) ?? '').split(/\s+/).filter(Boolean).map(Number))];
}

export function foreignPortError(port, pids) {
  return new Error(`port ${port} is in use by ${pids.length ? `PID ${pids.join(', ')}` : 'a process this user cannot inspect'}, which is not a MapLab dev server, `
    + `so nothing was stopped. Inspect it with lsof -nP -iTCP:${port} -sTCP:LISTEN, or start MapLab on another port with MAPLAB_PORT=<port> npm start.`);
}

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};

/** SIGTERM, then SIGKILL after a bounded wait. `group` also signals the process group the launcher started. */
export async function stopProcess(pid, { group = false, kill = process.kill, isAlive = alive, wait = sleep } = {}) {
  const send = (signal) => {
    for (const target of group ? [-pid, pid] : [pid]) {
      try { kill(target, signal); return true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    return false;
  };
  for (const [signal, polls] of [['SIGTERM', 50], ['SIGKILL', 20]]) {
    if (!send(signal)) return;
    for (let poll = 0; poll < polls; poll += 1) {
      if (!isAlive(pid)) return;
      await wait(100);
    }
  }
  throw new Error(`process ${pid} did not exit after SIGKILL`);
}

/**
 * Stops the MapLab dev server listening on `port`, whichever checkout started it. Refuses, stopping nothing, when a
 * listener does not identify itself as that MapLab server (another app, or a page that only looks like it).
 */
export async function teardown({ port, listeners = portListeners, whoIs = identify, stop = stopProcess, log = () => {} }) {
  const pids = listeners(port);
  if (!pids.length) return null;
  const who = await whoIs(port);
  if (!who || pids.some((pid) => pid !== who.pid)) throw foreignPortError(port, pids);
  log(`stopping the MapLab dev server on port ${port}: PID ${who.pid} from ${who.root} (library ${who.library})`);
  await stop(who.pid);
  if (listeners(port).length) throw new Error(`port ${port} is still in use after teardown`);
  return who;
}

/** Waits until the server on `port` identifies itself as process `pid`. */
export async function waitForReady(port, pid, { exited, timeoutMs = 30_000, whoIs = identify, wait = sleep }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited()) throw new Error('Vite exited before it was ready');
    const who = await whoIs(port);
    if (who?.pid === pid) return who;
    await wait(150);
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for MapLab on ${serverUrl(port)}`);
}

export function openBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(opener, [url], { stdio: 'ignore', detached: true });
  child.once('error', () => console.warn(`Could not open a browser; continue at ${url}`));
  child.unref();
}
