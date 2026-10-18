import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';
import { requiredFiles } from '../scripts/check-foundation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = [];
const current = JSON.parse(readFileSync(join(root, 'config/change.json')));
const history = JSON.parse(readFileSync(join(root, 'docs/deliveries.json')));
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'maplab-foundation-'));
  temporary.push(path);
  for (const file of [...requiredFiles, current.record, ...history.map((e) => `docs/changes/${e.id}.md`)]) {
    mkdirSync(dirname(join(path, file)), { recursive: true });
    cpSync(join(root, file), join(path, file));
  }
  return path;
}

function run(path) {
  return spawnSync(process.execPath, [resolve(root, 'scripts/check-foundation.mjs'), '--root', path], {
    encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: '' },
  });
}

function editJson(path, file, change) {
  const target = join(path, file);
  const value = JSON.parse(readFileSync(target, 'utf8'));
  change(value);
  writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
}

test('the foundation CLI accepts a standalone copy with no Git metadata or credentials', () => {
  const result = run(fixture());
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});

test.each([
  ['floating dependency', (p) => editJson(p, 'package.json', (v) => { v.dependencies.react = '^19.3.0'; }), 'dependency pins'],
  ['lock mismatch', (p) => editJson(p, 'package-lock.json', (v) => { v.packages['node_modules/react'].version = '19.2.0'; }), 'Lockfile pin'],
  ['missing authority', (p) => rmSync(join(p, 'SECURITY.md')), 'Missing or empty'],
  ['extra active task', (p) => {
    const f = join(p, 'implementation_plan.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace('<!-- active-queue:end -->', '### ML-003 / P0\n<!-- active-queue:end -->'));
  }, 'Active queue'],
  ['malformed ID', (p) => editJson(p, 'config/change.json', (v) => { v.id = 'RL-001'; }), 'Malformed controlled change'],
  ['malformed title', (p) => editJson(p, 'config/change.json', (v) => { v.title = 'Uncontrolled task title'; }), 'Malformed controlled change title'],
  ['lifecycle enabled', (p) => {
    const f = join(p, '.npmrc');
    writeFileSync(f, readFileSync(f, 'utf8').replace('ignore-scripts=true', 'ignore-scripts=false'));
  }, 'ignore-scripts=true'],
  ...['check', 'check:change', 'test', 'security'].map((name) => [
    `stubbed ${name} command`, (p) => editJson(p, 'package.json', (v) => { v.scripts[name] = 'node -e "process.exit(0)"'; }), 'Required executable command',
  ]),
  ['floating browser runner', (p) => editJson(p, 'package.json', (v) => { v.devDependencies['@playwright/test'] = '^1.64.1'; }), 'dependency pins'],
  ['an unreviewed extra dependency', (p) => editJson(p, 'package.json', (v) => { v.devDependencies['left-pad'] = '1.3.0'; }), 'dependency pins'],
  ...['start', 'test:browser'].map((name) => [
    `stubbed ${name} command`, (p) => editJson(p, 'package.json', (v) => { v.scripts[name] = 'node -e "process.exit(0)"'; }), 'Required executable command',
  ]),
  ['skipped browser tests', (p) => {
    const f = join(p, '.github/workflows/verify.yml');
    writeFileSync(f, readFileSync(f, 'utf8').replace('        run: npm run test:browser\n', '        run: echo skipped\n'));
  }, 'browser tests'],
  ['browsers installed after the browser tests', (p) => {
    const f = join(p, '.github/workflows/verify.yml');
    const text = readFileSync(f, 'utf8').replace('        run: npx playwright install --with-deps chromium webkit\n', '').replace('        run: npm run test:browser\n', '        run: npm run test:browser\n      - name: Late install\n        run: npx playwright install --with-deps chromium webkit\n');
    writeFileSync(f, text);
  }, 'browser tests'],
  ['missing placeholder library', (p) => rmSync(join(p, 'placeholder-library/maplab.project.json')), 'Missing or empty'],
  ['disabled security job', (p) => {
    const f = join(p, '.github/workflows/verify.yml');
    writeFileSync(f, readFileSync(f, 'utf8').replace('  security:\n', '  security:\n    if: false\n'));
  }, 'least privilege'],
])('the real foundation CLI rejects %s', (_label, corrupt, diagnostic) => {
  const path = fixture();
  corrupt(path);
  const result = run(path);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(diagnostic);
});
