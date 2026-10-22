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
  'config/change.json', 'package.json', 'package-lock.json', '.node-version',
  '.npmrc', '.gitignore', 'index.html', 'tsconfig.json', 'vite.config.ts',
  'vitest.config.ts', 'src/app/App.tsx', 'src/app/main.tsx', 'src/app/styles.css',
  'tests/app.test.tsx', 'tests/foundation.test.mjs', 'scripts/check-foundation.mjs',
  'scripts/check-build.mjs', '.github/workflows/verify.yml',
  '.github/pull_request_template.md', 'docs/deliveries.json',
  'scripts/check-change.mjs', 'scripts/check-queue.mjs', 'scripts/repository-policy.mjs', 'scripts/verify-pr.mjs',
  'tests/change.test.mjs', 'tests/policy.test.mjs', 'docs/DELIVERY-GATES.md',
  // ML-009: the library folder, its loopback plugin, the npm start launcher and the browser gate.
  'playwright.config.ts', 'scripts/dev.mjs', 'scripts/dev-lifecycle.mjs', 'src/library/plugin.ts',
  'placeholder-library/maplab.project.json',
];

function demand(condition, message) {
  if (!condition) throw new Error(message);
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
  const change = checkChange(root);
  checkPolicyConfig(json('config/github-repository-settings.json'));
  const workflow = read('.github/workflows/verify.yml');
  const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  demand(uses.length === 6 && uses.every((action) => [
    'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
    'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
  ].includes(action)),
    'CI Actions must use immutable commit SHAs');
  demand(workflow.includes('contents: read') && !/permissions:\s*write-all|contents:\s*write|pull_request_target|continue-on-error|^\s*(?:if|shell|defaults|working-directory):/m.test(workflow)
    && workflow.includes('persist-credentials: false')
    && workflow.includes('run: npm ci') && workflow.includes('run: npm run check')
    && workflow.includes('run: npm run check:change') && workflow.includes('run: npm run security')
    && workflow.includes('github.event.pull_request.head.sha || github.sha'),
    'CI must run exact-head credential-free canonical and separate online gates with least privilege');
  demand(/  push:\n    branches: \[main\]/.test(workflow), 'CI pushes must be restricted to main; tag/branch cleanup is not delivery CI');
  const jobs = Object.fromEntries([...workflow.matchAll(/^  ([a-z-]+):\n([\s\S]*?)(?=^  [a-z-]+:|$(?![\s\S]))/gm)].map((m) => [m[1], m[2]]));
  for (const [job, command] of Object.entries({ verify: 'npm run check', 'change-id': 'npm run check:change', security: 'npm run security' })) {
    demand(jobs[job]?.includes(`    name: ${job}\n`) && jobs[job].split('\n').some((line) => line.trim() === `run: ${command}`), `Required CI job/command missing: ${job}`);
  }
  const verifySteps = (jobs.verify ?? '').split('\n').map((line) => line.trim());
  const at = (command) => verifySteps.indexOf(`run: ${command}`);
  demand(at('npm run check') >= 0 && at('npx playwright install --with-deps chromium webkit') > at('npm run check')
    && at('npm run test:browser') > at('npx playwright install --with-deps chromium webkit'),
  'CI verify must install Chromium and WebKit outside npm, then run the browser tests');
  for (const file of [...requiredFiles.filter((p) => p.endsWith('.md')), change.record]) {
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
