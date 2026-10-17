// ML-007 differential proof: the independent reader's parser and schema evaluator were written
// separately from src/contracts. On every owned conformance file and R1 example they must agree
// with the editor's library about byte acceptance and closed-schema validity.
import { expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseStrict } from './consumer/reader/json.mjs';
import { compile, validate } from './consumer/reader/schema.mjs';
import { DOCUMENT_SCHEMAS, evaluate, parseJson } from '../src/contracts/index.ts';

const root = resolve(import.meta.dirname, '..');
const walk = (dir) => readdirSync(dir).sort().flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const inputs = [...walk(join(root, 'conformance')), ...walk(join(root, 'docs/specifications/2026-10-17-maplab-r1/examples'))]
  .filter((f) => f.endsWith('.json') && !f.endsWith('cases.json'));
const independent = new Map(readdirSync(join(root, 'schemas')).map((n) => {
  const format = n.replace(/\.v1\.schema\.json$/, '');
  return [format, compile(parseStrict(readFileSync(join(root, 'schemas', n))), format)];
}));

test('the differential corpus is large and covers every published document format', () => {
  expect(inputs.length).toBeGreaterThan(150);
  expect([...independent.keys()].sort()).toEqual([...DOCUMENT_SCHEMAS.keys()].sort());
});

test.each(inputs.map((f) => [relative(root, f), f]))('independent and library readers agree on %s', (_name, file) => {
  const bytes = readFileSync(file);
  const library = parseJson(new Uint8Array(bytes));
  let value = null, accepted = true;
  try { value = parseStrict(bytes); } catch { accepted = false; }
  expect(accepted, 'byte acceptance').toBe(library.ok);
  if (!accepted || value === null || typeof value !== 'object' || Array.isArray(value)) return;
  const format = typeof value.format === 'string' ? value.format : null;
  if (!format || !independent.has(format)) return;
  const mine = validate(independent.get(format), value).length === 0;
  const theirs = evaluate(DOCUMENT_SCHEMAS.get(format), value).length === 0;
  expect(mine, 'closed-schema validity').toBe(theirs);
});
