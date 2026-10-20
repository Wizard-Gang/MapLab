import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { checkQueue } from '../scripts/check-queue.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = [];
afterEach(() => temporary.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
function fixture() {
  const p = mkdtempSync(join(tmpdir(), 'maplab-queue-'));
  temporary.push(p);
  for (const f of ['implementation_plan.md',
    'docs/specifications/2026-10-16-maplab.md', 'docs/deliveries.json', 'config/change.json']) {
    mkdirSync(dirname(join(p, f)), { recursive: true });
    cpSync(join(root, f), join(p, f));
  }
  return p;
}
const edit = (p, file, fn) => {
  const f = join(p, file);
  writeFileSync(f, fn(readFileSync(f, 'utf8')));
};
// Corruptions target whichever task is active, so activation never edits this file.
const delivered = JSON.parse(readFileSync(join(root, 'docs/deliveries.json'), 'utf8')).length;
const makeId = (n) => 'ML-' + String(n).padStart(3, '0');
const active = makeId(delivered + 1), next = makeId(delivered + 2);
const plan = readFileSync(join(root, 'implementation_plan.md'), 'utf8');
const activeBlock = plan.slice(plan.indexOf('<!-- active-queue:start -->'), plan.indexOf('<!-- active-queue:end -->'));
const fieldOf = (label) => activeBlock.split('\n').find((l) => l.startsWith('- **' + label + ':** ')).slice(label.length + 8);
const scope = fieldOf('Source scope'), acceptance = fieldOf('Acceptance');
const fixtures = activeBlock.split('\n').find((l) => l.startsWith('  3. ')).split('Create owned fixture(s): ')[1];
test('all 44 J2 IDs and original scope/acceptance preserved; first open follows the delivery chain', () => {
  expect(checkQueue(fixture())).toEqual({ active, completed: delivered, future: 43 - delivered, reserved: 44 });
});
test.each([
  ['missing future ML-044', 'implementation_plan.md', (s) => s.replace(/### ML-044 \/[\s\S]*?(?=<!-- future-queue:end -->)/, ''), 'Reserved future tasks'],
  ['duplicate future ID', 'implementation_plan.md', (s) => s.replace('### ' + next + ' /', '### ' + next + ' / P0\n\n### ' + next + ' /'), 'Reserved future tasks'],
  ['skipped first open', 'implementation_plan.md', (s) => s.replace('### ' + active + ' /', '### ' + next + ' /'), 'Active queue'],
  ['tampered scope', 'implementation_plan.md', (s) => s.replace('**Source scope:** ' + scope, '**Source scope:** Replaced ' + scope), 'Specification J2 Source scope drift'],
  ['relaxed acceptance', 'implementation_plan.md', (s) => s.replace('**Acceptance:** ' + acceptance, '**Acceptance:** ' + acceptance.slice(0, -1) + ' unless waived.'), 'Specification J2 Acceptance drift'],
  ['wrong specification anchor', 'implementation_plan.md', (s) => s.replace(/(### ML-\d{3} \/[^\n]*\n[\s\S]*?\[[A-K]\d+\]\(docs\/specifications\/2026-10-16-maplab\.md#)[^)]+\)/, '$1wrong)'), 'Specification traceability'],
  ['missing fixture', 'implementation_plan.md', (s) => s.replace('Create owned fixture(s): ' + fixtures, 'Create owned fixture(s): TODO'), 'Executable subtasks'],
  ['premature completion', 'implementation_plan.md', (s) => s.replace('<!-- completed-history:end -->', '- **' + active + '** — prematurely complete\n<!-- completed-history:end -->'), 'Completed tasks'],
])('rejects %s', (_label, file, transform, diagnostic) => {
  const p=fixture();
  edit(p, file, transform);
  expect(readFileSync(join(p, file), 'utf8')).not.toBe(readFileSync(join(root, file), 'utf8'));
  expect(() => checkQueue(p)).toThrow(diagnostic);
});
test('spec J2 contract drift cannot pass unchanged delivery queue', () => {
  const p=fixture();
  edit(p,'docs/specifications/2026-10-16-maplab.md', (s) => s.replace('| ' + scope + ' |', '| Loose ' + scope + ' |'));
  expect(readFileSync(join(p, 'docs/specifications/2026-10-16-maplab.md'), 'utf8')).toContain('Loose ' + scope);
  expect(() => checkQueue(p)).toThrow('Specification J2 Source scope drift');
});
