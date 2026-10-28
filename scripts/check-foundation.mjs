import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkChange } from './check-change.mjs';
import { checkPolicyConfig } from './repository-policy.mjs';

// R1, adopted at ML-003, is a frozen revision record: every file stays present and link-checked.
const revisionR1 = [
  'README.md', 'A-research.md', 'B-riglab-hexframe-review.md', 'C-product.md',
  'D-world-physics.md', 'D-reference-controller.md', 'E-navigation.md', 'F-formats.md',
  'G-engine-integration.md', 'H-editor-architecture.md', 'I-validation-acceptance.md',
  'J-implementation-queue.md', 'K-decisions-risks.md',
  ...['common', 'map', 'gameplay', 'documents'].map((name) => `contract/${name}.ts`),
  'examples/forest/maplab.project.json', 'examples/forest-export/manifest.json',
  ...['forest', 'forest-export'].flatMap((dir) => [
    'maps/forest.map.json', 'maps/clearing.map.json', 'movement/player.movement.json',
    'movement/ground.movement.json', 'movement/flyer.movement.json', 'catalogs/core.catalog.json',
    'tilesets/forest.tileset.json',
  ].map((file) => `examples/${dir}/${file}`)),
  'examples/forest/prefabs/tree.prefab.json',
].map((file) => `docs/specifications/2026-10-17-maplab-r1/${file}`);

export const requiredFiles = [
  ...revisionR1,
  'AGENTS.md', 'implementation_plan.md', 'README.md', 'CONTRIBUTING.md',
  'SECURITY.md', 'LICENSE', 'docs/ARCHITECTURE.md', 'docs/FORMATS.md',
  'docs/PHYSICS-CONFORMANCE.md', 'docs/CHANGE-MANAGEMENT.md',
  'docs/CONTROLLER-CONTRACT.md', 'schemas/maplab.movement.v1.schema.json',
  'contracts/maplab.reference-controller.v1.capabilities.json',
  'docs/RELEASE-MANAGEMENT.md',
  'docs/PROVENANCE.md', 'docs/specifications/2026-10-16-maplab.md',
  'config/github-repository-settings.json', 'config/lifecycle-scripts.json',
  'config/change.json', 'config/release.json', 'package.json', 'package-lock.json', '.node-version',
  '.npmrc', '.gitignore', 'index.html', 'tsconfig.json', 'vite.config.ts',
  'vitest.config.ts', 'src/app/App.tsx', 'src/app/main.tsx', 'src/app/styles.css',
  'tests/app.test.tsx', 'tests/foundation.test.mjs', 'scripts/check-foundation.mjs',
  'scripts/check-build.mjs', '.github/workflows/verify.yml', '.github/workflows/gate.yml', '.github/workflows/change.yml',
  '.github/pull_request_template.md',
  'scripts/check-change.mjs', 'scripts/check-queue.mjs', 'scripts/repository-policy.mjs', 'scripts/verify-pr.mjs',
  'tests/change.test.mjs', 'tests/policy.test.mjs', 'docs/DELIVERY-GATES.md',
  // ML-009: the library folder, its loopback plugin, the npm start launcher and the browser gate.
  'playwright.config.ts', 'scripts/dev.mjs', 'scripts/dev-lifecycle.mjs', 'src/library/plugin.ts',
  'placeholder-library/maplab.project.json',
];

function demand(condition, message) {
  if (!condition) throw new Error(message);
}

// Every checkout step and its assert step, in each job that tests a revision.
const setup = [
  'test "$(git rev-parse HEAD)" = "$MAPLAB_EXPECTED_HEAD"',
  'npm install --global npm@12.1.0 --ignore-scripts --no-audit --no-fund',
];
const prTypes = '    types: [opened, synchronize, reopened, edited, ready_for_review]';
const aggregateRun = 'test "${{ needs.check.result }}" = success && test "${{ needs.browser.result }}" = success';
const browserInstall = 'npx playwright install --with-deps ${{ matrix.project }}';
const browserMirror = "sudo sed -i 's|azure\\.archive\\.ubuntu\\.com|archive.ubuntu.com|g' /etc/apt/apt-mirrors.txt";
const browserRun = 'npm run test:browser -- --project=${{ matrix.project }} --shard=${{ matrix.shard }}';
// Release protocol (ML-031): the full suite runs on release -> main PRs and on dispatch, the fast gate
// on task PRs into release/**, and change identity on both. No workflow runs on push.
export const workflowPins = {
  verify: {
    on: ['  pull_request:', '    branches: [main]', prTypes, '  workflow_dispatch:'], uses: 7,
    jobs: {
      check: [[...setup, 'npm ci', 'npm run check'], 'Required CI job/command missing: check'],
      browser: [[...setup, 'npm ci', browserMirror, browserInstall, browserRun],
        'CI must install Chromium and WebKit outside npm, then run every shard of the browser tests'],
      verify: [[aggregateRun], 'CI verify must require the check job and every browser shard to pass'],
      security: [[...setup, 'npm ci', 'npm run security'], 'Required CI job/command missing: security'],
    },
  },
  gate: {
    on: ['  pull_request:', "    branches: ['release/**']", prTypes], uses: 2,
    jobs: { gate: [[...setup, 'npm ci', 'npm run check:foundation', 'npm run typecheck', 'npm run build', 'npm run smoke'],
      'Feature gate must run exactly the non-test checks: gate'] },
  },
  change: {
    on: ['  pull_request:', "    branches: [main, 'release/**']", prTypes], uses: 2,
    jobs: { 'change-id': [[...setup, 'npm run check:change'], 'Required CI job/command missing: change-id'] },
  },
};

function checkWorkflows(read) {
  const artifact = '      - name: Preserve raw performance samples and memory snapshots\n'
    + '        if: ${{ always() }}\n'
    + '        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4\n'
    + '        with:\n          name: performance-${{ matrix.project }}-${{ strategy.job-index }}\n'
    + '          path: test-results/**/performance.json\n          if-no-files-found: ignore\n';
  for (const [file, pin] of Object.entries(workflowPins)) {
    const workflow = read(`.github/workflows/${file}.yml`);
    const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    demand(uses.length === pin.uses && uses.every((action) => [
      'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
      'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
      'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    ].includes(action)),
      'CI Actions must use immutable commit SHAs');
    // Conditions are allowed only on the aggregate and this exact artifact-preservation step.
    const aggregate = '    name: verify\n    needs: [check, browser]\n    if: ${{ always() }}\n';
    const checkouts = uses.filter((action) => action.startsWith('actions/checkout@')).length;
    const count = (text) => workflow.split(text).length - 1;
    demand(workflow.includes('\npermissions:\n  contents: read\n') && !/permissions:\s*write-all|contents:\s*write|pull_request_target|continue-on-error|^\s*(?:if|shell|defaults|working-directory):/m.test(file === 'verify' ? workflow.replace(aggregate, '').replace(artifact, '') : workflow)
      && count('persist-credentials: false') === checkouts
      && count('ref: ${{ github.event.pull_request.head.sha || github.sha }}') === checkouts
      && workflow.includes('  MAPLAB_EXPECTED_HEAD: ${{ github.event.pull_request.head.sha || github.sha }}\n'),
      'CI must run exact-head credential-free canonical and separate online gates with least privilege');
    const on = workflow.match(/^on:\n((?: .*\n|\n)*?)(?=\S)/m)?.[1].replace(/\n+$/, '').split('\n');
    demand(JSON.stringify(on) === JSON.stringify(pin.on),
      `CI triggers disagree with the release protocol: ${file}.yml`);
    const body = workflow.slice(workflow.indexOf('\njobs:\n') + 7);
    const jobs = Object.fromEntries([...body.matchAll(/^  ([a-z-]+):\n([\s\S]*?)(?=^  [a-z-]+:|$(?![\s\S]))/gm)].map((m) => [m[1], m[2]]));
    demand(workflow.includes('\njobs:\n') && JSON.stringify(Object.keys(jobs)) === JSON.stringify(Object.keys(pin.jobs)),
      `CI jobs disagree with the release protocol: ${file}.yml`);
    for (const [job, [commands, message]] of Object.entries(pin.jobs)) {
      const runs = jobs[job].split('\n').map((line) => line.trim()).filter((line) => line.startsWith('run: ')).map((line) => line.slice(5));
      const header = { verify: aggregate, browser: '    name: browser (${{ matrix.project }} ${{ matrix.shard }})\n' }[job] ?? `    name: ${job}\n`;
      demand(jobs[job].startsWith(header)
        && JSON.stringify(runs) === JSON.stringify(commands), message);
    }
    if (file === 'verify') {
      demand(jobs.browser.includes(artifact) && count('actions/upload-artifact@') === 1, 'CI must preserve exact-head performance artifacts');
      demand(jobs.browser.includes('        project: [chromium, webkit]\n') && jobs.browser.includes('        shard: [1/2, 2/2]\n'),
        'CI must install Chromium and WebKit outside npm, then run every shard of the browser tests');
      demand(jobs.verify === `${aggregate}    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n`
        + '      - name: Require the check job and every browser shard to pass\n'
        + `        run: ${aggregateRun}\n`,
      'CI verify must require the check job and every browser shard to pass');
    }
  }
}

export function checkFoundation(root) {
  const read = (file) => readFileSync(resolve(root, file), 'utf8');
  const json = (file) => JSON.parse(read(file));
  demand(process.version === 'v26.10.0', 'Node must be exactly 26.10.0');
  demand(/^npm\/12\.1\.0\s/.test(process.env.npm_config_user_agent ?? ''),
    'Run through npm 12.1.0');
  for (const file of requiredFiles) {
    demand(existsSync(resolve(root, file)) && read(file).trim().length > 0,
      `Missing or empty governing/foundation file: ${file}`);
  }
  const pkg = json('package.json');
  demand(pkg.name === 'maplab' && pkg.version === '0.1.0' && pkg.private === true,
    'Package must identify unreleased private maplab 0.1.0');
  demand(pkg.engines?.node === '26.10.0' && pkg.engines?.npm === '12.1.0'
    && pkg.packageManager === 'npm@12.1.0' && read('.node-version').trim() === '26.10.0',
  'Toolchain pins disagree');
  // ML-009 added the reviewed browser runner. Its browsers are installed by `npx playwright install`, never by npm.
  const pins = {
    react: '19.3.0', 'react-dom': '19.3.0', '@types/node': '26.6.5',
    '@types/react': '19.3.0', '@types/react-dom': '19.3.0',
    typescript: '7.0.2', vite: '8.3.4', vitest: '5.0.5', '@playwright/test': '1.64.1',
  };
  const actual = { ...pkg.dependencies, ...pkg.devDependencies };
  demand(JSON.stringify(Object.entries(actual).sort()) === JSON.stringify(Object.entries(pins).sort()),
    'Foundation dependency pins changed or are not exact');
  demand(!pkg.optionalDependencies && !pkg.peerDependencies, 'Unreviewed dependency category');
  const commands = {
    'check:foundation': 'node scripts/check-foundation.mjs',
    'check:change': 'node scripts/check-change.mjs',
    typecheck: 'tsc --noEmit', test: 'vitest run', build: 'vite build',
    smoke: 'node scripts/check-build.mjs',
    check: 'npm run check:foundation && npm run typecheck && npm test && npm run build && npm run smoke',
    security: 'npm audit --audit-level=low && npm audit signatures',
    'policy:check': 'node scripts/repository-policy.mjs',
    'policy:apply': 'node scripts/repository-policy.mjs --apply',
    'delivery:verify': 'node scripts/verify-pr.mjs',
    start: 'node scripts/dev.mjs', 'test:browser': 'playwright test',
  };
  for (const [name, command] of Object.entries(commands)) {
    demand(pkg.scripts?.[name] === command, `Required executable command changed: ${name}`);
    demand(!pkg.scripts?.[`pre${name}`] && !pkg.scripts?.[`post${name}`], `Unapproved check hook: ${name}`);
  }

  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
    demand(!pkg.scripts?.[hook], `Unapproved root lifecycle hook: ${hook}`);
  }
  const npmrc = Object.fromEntries(read('.npmrc').trim().split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#')).map((line) => line.split('=')));
  for (const key of ['engine-strict', 'save-exact', 'ignore-scripts']) {
    demand(npmrc[key] === 'true', `.npmrc must set ${key}=true`);
  }
  demand(process.env.npm_config_ignore_scripts !== 'false', 'Lifecycle denial was overridden');
  const lifecycle = json('config/lifecycle-scripts.json');
  demand(lifecycle.default === 'deny' && Array.isArray(lifecycle.allowedDependencies)
    && lifecycle.allowedDependencies.length === 0, 'Dependency lifecycle allowlist must be empty');
  const lock = json('package-lock.json');
  demand(lock.lockfileVersion === 3 && lock.name === pkg.name && lock.version === pkg.version,
    'Lockfile identity/version disagrees');
  const lockRoot = lock.packages?.[''];
  demand(lockRoot, 'Lockfile root is missing');
  for (const key of ['dependencies', 'devDependencies', 'engines']) {
    demand(JSON.stringify(lockRoot[key]) === JSON.stringify(pkg[key]), `Lockfile root ${key} disagrees`);
  }
  for (const [name, version] of Object.entries(pins)) {
    demand(lock.packages[`node_modules/${name}`]?.version === version, `Lockfile pin disagrees: ${name}`);
  }
  demand(lock.packages['node_modules/@vitest/mocker']?.version === '5.0.5',
    'Lockfile security pin disagrees: @vitest/mocker');
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    demand(!entry.link && /^https:\/\/registry\.npmjs\.org\//.test(entry.resolved ?? '')
      && /^sha512-[A-Za-z0-9+/]+=*$/.test(entry.integrity ?? ''),
    `Unpinned registry bytes or local dependency: ${path}`);
  }
  checkChange(root);
  checkPolicyConfig(json('config/github-repository-settings.json'));
  checkWorkflows(read);
  for (const file of requiredFiles.filter((p) => p.endsWith('.md'))) {
    for (const [, target] of read(file).matchAll(/\]\(([^\s)]+)\)/g)) {
      if (/^(?:https?:|#|mailto:)/.test(target)) continue;
      demand(existsSync(resolve(root, dirname(file), target.split('#')[0])),
        `Broken local authority link in ${file}: ${target}`);
    }
  }
  return 'Foundation verified: pins, lockfile, policies, authorities, current task identity, closed bootstrap and traced first-open/current/future queue';
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  try {
    const args = process.argv.slice(2);
    demand(args.length === 0 || (args.length === 2 && args[0] === '--root'), 'Usage: check-foundation.mjs [--root directory]');
    console.log(checkFoundation(args[1] ? resolve(args[1]) : resolve(dirname(self), '..')));
  } catch (error) {
    console.error(`Foundation rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
