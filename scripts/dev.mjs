// `npm start` (R1 H8): teardown, reset, install, build, start, readiness, open. Each run replaces the MapLab dev
// server on its port instead of failing on it; Ctrl-C stops the server it started.
//   MAPLAB_PORT     port (default 5182; agents in worktrees use another port and a scratch MAPLAB_LIBRARY)
//   MAPLAB_NO_OPEN  1 to skip opening the browser (or pass --no-open)
//   MAPLAB_LIBRARY  the library folder, read by the dev server's library plugin
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALL_MARKER, needsInstall, openBrowser, parsePort, portListeners, resetPaths, serverUrl, sha256, stopProcess, teardown, waitForReady } from './dev-lifecycle.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vite = join(root, 'node_modules/vite/bin/vite.js');
const step = (message) => console.log(`\n\x1b[36m▸ ${message}\x1b[0m`);

function run(file, args) {
  const result = spawnSync(file, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${[file, ...args].join(' ')} exited with status ${result.status}`);
}
// npm sets npm_execpath to its own CLI, so install uses the npm 12.1.0 that runs this script.
const npm = (args) => (process.env.npm_execpath ? run(process.execPath, [process.env.npm_execpath, ...args]) : run('npm', args));

let phase = 'configuration';
let child;
let stopping = false;

async function stop(code) {
  if (stopping) return;
  stopping = true;
  if (child?.pid && child.exitCode === null) {
    try { await stopProcess(child.pid, { group: true }); } catch (error) { console.error(`[maplab] stop failed: ${error.message}`); code = 1; }
  }
  process.exit(code);
}

try {
  if (process.platform === 'win32') throw new Error('the launcher supports macOS and Linux; run npm run dev instead');
  const port = parsePort(process.env.MAPLAB_PORT);
  const url = serverUrl(port);
  const open = !process.argv.includes('--no-open') && process.env.MAPLAB_NO_OPEN !== '1';

  phase = 'teardown';
  step(`Teardown: stopping any MapLab dev server on port ${port}`);
  const stopped = await teardown({ port, log: (line) => console.log(`  ${line}`) });
  if (!stopped) console.log('  nothing was listening');

  phase = 'reset';
  step('Reset: clearing dist/ and node_modules/.vite/');
  for (const path of resetPaths(root)) rmSync(path, { recursive: true, force: true });

  phase = 'install';
  const lockHash = sha256(readFileSync(join(root, 'package-lock.json')));
  const marker = join(root, INSTALL_MARKER);
  const installedHash = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null;
  if (needsInstall({ nodeModules: existsSync(join(root, 'node_modules')), lockHash, installedHash })) {
    step('Install: npm ci (node_modules/ is missing or older than package-lock.json)');
    npm(['ci', '--no-audit', '--no-fund']);
    writeFileSync(marker, `${lockHash}\n`);
  } else {
    step('Install: node_modules/ matches package-lock.json');
  }

  phase = 'build';
  step('Build: vite build');
  run(process.execPath, [vite, 'build', '--logLevel', 'warn']);

  phase = 'start';
  step(`Start: Vite on ${url}`);
  // Its own process group, so stopping it stops everything it started; no stdin, so it never reads the terminal.
  child = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], detached: true });
  child.once('error', (error) => { console.error(`[maplab] start failed: ${error.message}`); void stop(1); });
  child.once('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[maplab] Vite exited with ${signal ?? `status ${code}`}${signal === 'SIGTERM' ? '; a newer npm start on this port replaces the running server' : ''}`);
    process.exit(code ?? 1);
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => void stop(0));

  phase = 'readiness';
  const who = await waitForReady(port, child.pid, { exited: () => child.exitCode !== null || child.signalCode !== null });
  if (!portListeners(port).includes(child.pid)) throw new Error(`PID ${child.pid} is not the listener on port ${port}`);
  step(`Ready: ${url}  (library: ${who.library})${open ? '' : '   browser not opened (--no-open or MAPLAB_NO_OPEN=1)'}`);
  if (open) openBrowser(url);
} catch (error) {
  console.error(`\n[maplab] ${phase} failed: ${error.message}`);
  await stop(1);
}
