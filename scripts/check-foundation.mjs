import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const requiredFiles = [
  'AGENTS.md', 'implementation_plan.md', 'README.md', 'CONTRIBUTING.md',
  'SECURITY.md', 'LICENSE', 'docs/ARCHITECTURE.md', 'docs/FORMATS.md',
  'docs/PHYSICS-CONFORMANCE.md', 'docs/CHANGE-MANAGEMENT.md',
  'docs/RELEASE-MANAGEMENT.md', 'docs/IMPLEMENTATION-ROADMAP.md',
  'docs/PROVENANCE.md', 'docs/specifications/2026-10-16-maplab.md',
  'config/github-repository-settings.json', 'config/lifecycle-scripts.json',
  'config/change.json', 'package.json', 'package-lock.json', '.node-version',
  '.npmrc', '.gitignore', 'index.html', 'tsconfig.json', 'vite.config.ts',
  'vitest.config.ts', 'src/app/App.tsx', 'src/app/main.tsx', 'src/app/styles.css',
  'tests/app.test.tsx', 'tests/foundation.test.mjs', 'scripts/check-foundation.mjs',
  'scripts/check-build.mjs', '.github/workflows/verify.yml',
  '.github/pull_request_template.md',
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
  const pins = {
    react: '19.3.0', 'react-dom': '19.3.0', '@types/node': '26.6.5',
    '@types/react': '19.3.0', '@types/react-dom': '19.3.0',
    typescript: '7.0.2', vite: '8.3.1', vitest: '5.0.2',
  };
  const actual = { ...pkg.dependencies, ...pkg.devDependencies };
  demand(JSON.stringify(Object.entries(actual).sort()) === JSON.stringify(Object.entries(pins).sort()),
    'Foundation dependency pins changed or are not exact');
  demand(!pkg.optionalDependencies && !pkg.peerDependencies, 'Unreviewed dependency category');
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
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    demand(!entry.link && /^https:\/\/registry\.npmjs\.org\//.test(entry.resolved ?? '')
      && /^sha512-[A-Za-z0-9+/]+=*$/.test(entry.integrity ?? ''),
    `Unpinned registry bytes or local dependency: ${path}`);
  }
  const change = json('config/change.json');
  demand(/^ML-\d{3}$/.test(change.id) &&
    /^(FEATURE|FIX|DOCS|CHORE|REFACTOR|TEST|SECURITY)$/.test(change.type), 'Malformed controlled change ID/type');
  demand(new RegExp(`^\\[${change.id}\\] \\[${change.type}\\] [A-Z].+`).test(change.title),
    'Malformed controlled change title');
  demand(change.id === 'ML-001' && change.bootstrap === 'empty-repository-root-commit',
    'ML-001 bootstrap identity changed; activate future tasks through controlled governance');
  demand(change.record === `docs/changes/${change.id}.md` && existsSync(resolve(root, change.record)),
    'Change record identity disagrees');
  demand(read(change.record).startsWith(`# ${change.title}\n`), 'Change record title disagrees');
  const plan = read('implementation_plan.md');
  const queue = plan.match(/<!-- active-queue:start -->([\s\S]*?)<!-- active-queue:end -->/);
  demand(queue, 'Active queue markers are missing');
  const ids = queue[1].match(/\bML-\d{3}\b/g) ?? [];
  demand(ids.length === 1 && ids[0] === change.id, 'Active queue must contain only the controlled task');
  const roadmap = read('docs/IMPLEMENTATION-ROADMAP.md');
  const rows = [...roadmap.matchAll(/^\| \*\*(ML-\d{3}) \/[^\n]+/gm)].map((match) => match[1]);
  demand(rows.length === 44 && rows.every((id, i) => id === `ML-${String(i + 1).padStart(3, '0')}`),
    'Reserved roadmap must contain ML-001–044 exactly once in order');
  const settings = json('config/github-repository-settings.json');
  demand(settings.repository === 'Wizard-Gang/MapLab' && settings.visibility === 'private'
    && settings.status === 'desired-only; apply and verify in ML-002', 'Desired settings identity/status disagrees');
  demand(JSON.stringify(settings.main?.requiredChecks) === '["verify","change-id","security"]'
    && settings.main?.bypassActors?.length === 0, 'Desired checks/bypass policy disagrees');
  const workflow = read('.github/workflows/verify.yml');
  const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  demand(uses.length === 2 && uses.every((action) => /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/.test(action)),
    'CI Actions must use immutable commit SHAs');
  demand(workflow.includes('contents: read') && workflow.includes('persist-credentials: false')
    && workflow.includes('run: npm ci') && workflow.includes('run: npm run check'),
  'Initial CI must run credential-free canonical checks with least privilege');
  for (const file of [...requiredFiles.filter((p) => p.endsWith('.md')), change.record]) {
    for (const [, target] of read(file).matchAll(/\]\(([^\s)]+)\)/g)) {
      if (/^(?:https?:|#|mailto:)/.test(target)) continue;
      demand(existsSync(resolve(root, dirname(file), target.split('#')[0])),
        `Broken local authority link in ${file}: ${target}`);
    }
  }
  return 'Foundation verified: pins, lockfile, policies, authorities, ML-001 identity and reserved roadmap';
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
