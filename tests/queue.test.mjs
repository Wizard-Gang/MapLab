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
  for (const f of ['implementation_plan.md', 'docs/IMPLEMENTATION-ROADMAP.md',
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
test('all 44 J2 IDs and original scope/acceptance preserved; first open is ML-002', () => {
  expect(checkQueue(fixture())).toEqual({ active: 'ML-002', completed: 1, future: 42, reserved: 44 });
});
test.each([
  ['missing future ML-044', 'implementation_plan.md', (s) => s.replace(/### ML-044 \/[\s\S]*?(?=<!-- future-queue:end -->)/, ''), 'Reserved future tasks'],
  ['duplicate future ID', 'implementation_plan.md', (s) => s.replace('### ML-006 /', '### ML-005 /'), 'Reserved future tasks'],
  ['skipped first open', 'implementation_plan.md', (s) => s.replace('### ML-002 /', '### ML-003 /'), 'Active queue'],
  ['tampered scope', 'implementation_plan.md', (s) => s.replace('Base schemas/parser:', 'Replaced schemas/parser:'), 'Specification J2 Source scope drift'],
  ['relaxed acceptance', 'implementation_plan.md', (s) => s.replace('no network schema fetch.', 'network schema fetch allowed.'), 'Specification J2 Acceptance drift'],
  ['wrong specification anchor', 'implementation_plan.md', (s) => s.replace(/\[D1\]\(docs\/specifications\/2026-10-16-maplab\.md#[^)]+\)/, '[D1](docs/specifications/2026-10-16-maplab.md#wrong)'), 'Specification traceability'],
  ['missing fixture', 'implementation_plan.md', (s) => s.replace('Create owned fixture(s): Valid and malformed map headers, quantization/bounds extremes, duplicate keys, traversal paths and unknown required versions', 'Create owned fixture(s): TODO'), 'Executable subtasks'],
  ['premature completion', 'implementation_plan.md', (s) => s.replace('<!-- completed-history:end -->', '- **ML-002** — prematurely complete\n<!-- completed-history:end -->'), 'Completed tasks'],
  ['duplicated roadmap definition', 'docs/IMPLEMENTATION-ROADMAP.md', (s) => s + '\n### ML-003 / P0\n', 'Duplicate live task definitions'],
])('rejects %s', (_label, file, transform, diagnostic) => {
  const p=fixture();
  edit(p, file, transform);
  expect(() => checkQueue(p)).toThrow(diagnostic);
});
test('spec J2 contract drift cannot pass unchanged delivery queue', () => {
  const p=fixture();
  edit(p,'docs/specifications/2026-10-16-maplab.md',
    (s) => s.replace('Base schemas/parser: format headers','Loose schemas/parser: format headers'));
  expect(() => checkQueue(p)).toThrow('Specification J2 Source scope drift');
});
