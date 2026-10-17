import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';
import { requiredFiles } from '../scripts/check-foundation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'maplab-foundation-'));
  temporary.push(path);
  for (const file of [...requiredFiles, 'docs/changes/ML-001.md']) {
    mkdirSync(dirname(join(path, file)), { recursive: true });
    cpSync(join(root, file), join(path, file));
  }
  return path;
}

function run(path) {
  return spawnSync(process.execPath, [resolve(root, 'scripts/check-foundation.mjs'), '--root', path], {
    encoding: 'utf8', env: process.env,
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
    writeFileSync(f, readFileSync(f, 'utf8').replace('<!-- active-queue:end -->', '- ML-002\n<!-- active-queue:end -->'));
  }, 'Active queue'],
  ['malformed ID', (p) => editJson(p, 'config/change.json', (v) => { v.id = 'RL-001'; }), 'Malformed controlled change'],
  ['malformed title', (p) => editJson(p, 'config/change.json', (v) => { v.title = '[ML-002] [CHORE] Wrong task'; }), 'Malformed controlled change title'],
  ['lifecycle enabled', (p) => {
    const f = join(p, '.npmrc');
    writeFileSync(f, readFileSync(f, 'utf8').replace('ignore-scripts=true', 'ignore-scripts=false'));
  }, 'ignore-scripts=true'],
])('the real foundation CLI rejects %s', (_label, corrupt, diagnostic) => {
  const path = fixture();
  corrupt(path);
  const result = run(path);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(diagnostic);
});
