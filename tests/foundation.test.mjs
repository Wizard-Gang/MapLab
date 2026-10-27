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
  for (const file of requiredFiles) {
    mkdirSync(dirname(join(path, file)), { recursive: true });
    cpSync(join(root, file), join(path, file));
  }
  return path;
}

function workflow(path, name, change) {
  const target = join(path, `.github/workflows/${name}.yml`);
  const before = readFileSync(target, 'utf8');
  const after = change(before);
  expect(after).not.toBe(before);
  writeFileSync(target, after);
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
  ['affected Vitest rollback with matching lock root', (p) => {
    editJson(p, 'package.json', (v) => { v.devDependencies.vitest = '5.0.2'; });
    editJson(p, 'package-lock.json', (v) => {
      v.packages[''].devDependencies.vitest = '5.0.2';
      v.packages['node_modules/vitest'].version = '5.0.2';
    });
  }, 'dependency pins'],
  ['affected transitive mocker rollback', (p) => editJson(p, 'package-lock.json', (v) => {
    v.packages['node_modules/@vitest/mocker'].version = '5.0.2';
  }), 'Lockfile security pin'],
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
    writeFileSync(f, readFileSync(f, 'utf8').replace('        run: npm run test:browser -- --project=${{ matrix.project }} --shard=${{ matrix.shard }}\n', '        run: echo skipped\n'));
  }, 'browser tests'],
  ['a dropped WebKit project', (p) => {
    const f = join(p, '.github/workflows/verify.yml');
    writeFileSync(f, readFileSync(f, 'utf8').replace('        project: [chromium, webkit]\n', '        project: [chromium]\n'));
  }, 'browser tests'],
  ['a verify job that ignores failed browser shards', (p) => {
    const f = join(p, '.github/workflows/verify.yml');
    writeFileSync(f, readFileSync(f, 'utf8').replace(' && test "${{ needs.browser.result }}" = success', ''));
  }, 'every browser shard'],
  ['browsers installed after the browser tests', (p) => {
    const f = join(p, '.github/workflows/verify.yml');
    const text = readFileSync(f, 'utf8').replace('        run: npx playwright install --with-deps ${{ matrix.project }}\n', '').replace('        run: npm run test:browser -- --project=${{ matrix.project }} --shard=${{ matrix.shard }}\n', '        run: npm run test:browser -- --project=${{ matrix.project }} --shard=${{ matrix.shard }}\n      - name: Late install\n        run: npx playwright install --with-deps ${{ matrix.project }}\n');
    writeFileSync(f, text);
  }, 'browser tests'],
  // Release protocol: the full suite never runs on push, the gate stays test-free, change identity covers both bases.
  ['a push trigger on the full suite', (p) => workflow(p, 'verify', (s) => s.replace('  workflow_dispatch:\n', '  workflow_dispatch:\n  push:\n    branches: [main]\n')), 'CI triggers disagree'],
  ['a full suite that release PRs cannot reach', (p) => workflow(p, 'verify', (s) => s.replace('    branches: [main]\n', "    branches: ['release/**']\n")), 'CI triggers disagree'],
  ['a change gate that ignores release branches', (p) => workflow(p, 'change', (s) => s.replace("    branches: [main, 'release/**']\n", '    branches: [main]\n')), 'CI triggers disagree'],
  ['a missing change identity workflow', (p) => rmSync(join(p, '.github/workflows/change.yml')), 'Missing or empty'],
  ['a feature gate that runs the tests', (p) => workflow(p, 'gate', (s) => s.replace('        run: npm run smoke\n', '        run: npm run smoke\n      - name: Tests\n        run: npm test\n')), 'non-test checks'],
  ['a feature gate that skips the build', (p) => workflow(p, 'gate', (s) => s.replace('      - name: Build\n        run: npm run build\n', '')), 'non-test checks'],
  ['a feature gate on a floating action', (p) => workflow(p, 'gate', (s) => s.replace('actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803', 'actions/checkout@v6')), 'immutable commit SHAs'],
  ['a feature gate that tests the merge revision', (p) => workflow(p, 'gate', (s) => s.replace('          ref: ${{ github.event.pull_request.head.sha || github.sha }}\n', '')), 'least privilege'],
  ['an extra job beside the feature gate', (p) => workflow(p, 'gate', (s) => s + '  lint:\n    name: lint\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run typecheck\n'), 'CI jobs disagree'],
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
