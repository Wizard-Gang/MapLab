// WebKit and Chromium end-to-end tests (R1 I3, C8). Browsers come from `npx playwright install`, never from npm
// lifecycle scripts. Two dev servers run: one on a scratch copy of the placeholder library that the tests write
// and reset, and one on the read-only placeholder itself. Neither ever reads ~/Documents/MapLab.
import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const root = fileURLToPath(new URL('.', import.meta.url));
export const WRITABLE_PORT = 5191;
export const PLACEHOLDER_PORT = 5192;
// Workers re-evaluate this file, so the scratch folder is made once and handed down through the environment.
if (!process.env.MAPLAB_E2E_LIBRARY) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'maplab-e2e-'));
  const scratch = join(parent, 'library');
  cpSync(join(root, 'placeholder-library'), scratch, { recursive: true });
  process.env.MAPLAB_E2E_LIBRARY = scratch;
  // Only the process that made the folder removes it, once the run and its servers are done.
  process.once('exit', () => rmSync(parent, { recursive: true, force: true }));
}
const env = (library: string): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)), MAPLAB_LIBRARY: library,
  VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true',
});
const server = (port: number, library: string) => ({
  command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort`,
  url: `http://127.0.0.1:${port}/`, cwd: root, env: env(library), reuseExistingServer: false, timeout: 60_000,
});

export default defineConfig({
  testDir: 'tests/browser',
  // The tests share one scratch library, which each test resets.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${WRITABLE_PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [server(WRITABLE_PORT, process.env.MAPLAB_E2E_LIBRARY), server(PLACEHOLDER_PORT, join(root, 'placeholder-library'))],
});
