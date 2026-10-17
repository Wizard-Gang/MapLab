// Bounded strict JSON (RFC 8259 / I-JSON) parser. It rejects duplicate keys before a value
// could be discarded, and enforces size, depth and count budgets while it reads, so nothing
// unbounded is allocated. Pure: no I/O, no globals, no network.
import { error, type Diagnostic, type PathSegment } from './diagnostics';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Initial budgets (specification H4: 64 MiB per JSON document). Callers may only lower them. */
export interface JsonLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxStringLength: number;
  readonly maxObjectKeys: number;
  readonly maxArrayItems: number;
  readonly maxValues: number;
}

export const defaultJsonLimits: JsonLimits = Object.freeze({
  maxBytes: 64 * 1024 * 1024,
  maxDepth: 64,
  maxStringLength: 1024 * 1024,
  maxObjectKeys: 10_000,
  maxArrayItems: 1_048_576,
  maxValues: 4_000_000,
});

export type JsonResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

const MAX_NUMBER_LITERAL = 128;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

class Failure {
  readonly code: string;
  readonly message: string;
  readonly path: readonly PathSegment[];
  constructor(code: string, message: string, path: readonly PathSegment[]) {
    this.code = code;
    this.message = message;
    this.path = path;
  }
}

export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}

/** Parses UTF-8 bytes or an already-decoded string. Never throws; never returns partial values. */
export function parseJson(input: Uint8Array | string, limits: JsonLimits = defaultJsonLimits): JsonResult {
  let text: string;
  if (typeof input === 'string') {
    if (utf8Length(input) > limits.maxBytes) return fail('json.too-large', `Document exceeds ${limits.maxBytes} bytes`);
    text = input;
  } else {
    if (input.byteLength > limits.maxBytes) return fail('json.too-large', `Document exceeds ${limits.maxBytes} bytes`);
    if (input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) return fail('json.bom', 'A byte order mark is not allowed');
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input); }
    catch { return fail('json.invalid-utf8', 'Document is not valid UTF-8'); }
  }
  if (text.charCodeAt(0) === 0xfeff) return fail('json.bom', 'A byte order mark is not allowed');
  try {
    return { ok: true, value: new Parser(text, limits).document() };
  } catch (caught) {
    if (caught instanceof Failure) return { ok: false, diagnostic: error(caught.code, caught.path, caught.message) };
    throw caught;
  }
}

function fail(code: string, message: string): JsonResult {
  return { ok: false, diagnostic: error(code, [], message) };
}

class Parser {
  private i = 0;
  private values = 0;
  private readonly path: PathSegment[] = [];
  private readonly s: string;
  private readonly limits: JsonLimits;

  constructor(s: string, limits: JsonLimits) {
    this.s = s;
    this.limits = limits;
  }

  document(): JsonValue {
    this.space();
    const value = this.value(1);
    this.space();
    if (this.i < this.s.length) this.syntax('Unexpected content after the JSON value');
    return value;
  }

  private value(depth: number): JsonValue {
    if (++this.values > this.limits.maxValues) this.fail('json.too-many-values', `More than ${this.limits.maxValues} values`);
    const c = this.s[this.i];
    if (c === '{' || c === '[') {
      if (depth > this.limits.maxDepth) this.fail('json.depth', `Nesting exceeds depth ${this.limits.maxDepth}`);
      return c === '{' ? this.object(depth) : this.array(depth);
    }
    if (c === '"') return this.string();
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) return this.number();
    for (const [word, literal] of [['true', true], ['false', false], ['null', null]] as const) {
      if (this.s.startsWith(word, this.i)) { this.i += word.length; return literal; }
    }
    return this.syntax(c === undefined ? 'Unexpected end of input' : `Unexpected character ${JSON.stringify(c)}`);
  }

  private object(depth: number): JsonValue {
    const result: { [key: string]: JsonValue } = {};
    const seen = new Set<string>();
    this.i++;
    this.space();
    if (this.s[this.i] === '}') { this.i++; return result; }
    for (;;) {
      if (this.s[this.i] !== '"') this.syntax('Expected a string object key');
      const key = this.string();
      this.path.push(key);
      if (seen.has(key)) this.fail('json.duplicate-key', `Duplicate object key ${JSON.stringify(key)}`);
      if (seen.size >= this.limits.maxObjectKeys) this.fail('json.too-many-keys', `More than ${this.limits.maxObjectKeys} keys in one object`);
      seen.add(key);
      this.space();
      if (this.s[this.i] !== ':') this.syntax('Expected ":" after an object key');
      this.i++;
      this.space();
      // Own data property even for "__proto__", exactly as JSON.parse defines it.
      Object.defineProperty(result, key, { value: this.value(depth + 1), enumerable: true, writable: true, configurable: true });
      this.path.pop();
      this.space();
      const next = this.s[this.i++];
      if (next === '}') return result;
      if (next !== ',') this.syntax('Expected "," or "}" in an object', 1);
      this.space();
    }
  }

  private array(depth: number): JsonValue {
    const result: JsonValue[] = [];
    this.i++;
    this.space();
    if (this.s[this.i] === ']') { this.i++; return result; }
    for (;;) {
      if (result.length >= this.limits.maxArrayItems) this.fail('json.array-too-long', `More than ${this.limits.maxArrayItems} array items`);
      this.path.push(result.length);
      result.push(this.value(depth + 1));
      this.path.pop();
      this.space();
      const next = this.s[this.i++];
      if (next === ']') return result;
      if (next !== ',') this.syntax('Expected "," or "]" in an array', 1);
      this.space();
    }
  }

  private string(): string {
    const s = this.s;
    let out = '';
    let start = ++this.i;
    for (;;) {
      if (this.i >= s.length) this.syntax('Unterminated string');
      const c = s.charCodeAt(this.i);
      if (c === 0x22) break;
      if (c < 0x20) this.syntax('Unescaped control character in a string');
      if (c >= 0xd800 && c <= 0xdfff) {
        const low = s.charCodeAt(this.i + 1);
        if (c > 0xdbff || !(low >= 0xdc00 && low <= 0xdfff)) this.fail('json.lone-surrogate', 'Unpaired UTF-16 surrogate in a string');
        this.i += 2;
        continue;
      }
      if (c !== 0x5c) { this.i++; continue; }
      out += s.slice(start, this.i);
      out += this.escape();
      start = this.i;
      if (out.length > this.limits.maxStringLength) break;
    }
    out += s.slice(start, this.i);
    if (out.length > this.limits.maxStringLength) this.fail('json.string-too-long', `String longer than ${this.limits.maxStringLength} code units`);
    this.i++;
    return out;
  }

  private escape(): string {
    const e = this.s[this.i + 1];
    this.i += 2;
    if (e !== undefined && e !== 'u' && Object.hasOwn(SIMPLE_ESCAPES, e)) return SIMPLE_ESCAPES[e] as string;
    if (e !== 'u') return this.syntax('Invalid escape sequence', 2);
    const unit = this.hex4();
    if (unit >= 0xdc00 && unit <= 0xdfff) this.fail('json.lone-surrogate', 'Unpaired UTF-16 surrogate escape');
    if (unit < 0xd800 || unit > 0xdbff) return String.fromCharCode(unit);
    if (this.s[this.i] !== '\\' || this.s[this.i + 1] !== 'u') this.fail('json.lone-surrogate', 'Unpaired UTF-16 surrogate escape');
    this.i += 2;
    const low = this.hex4();
    if (low < 0xdc00 || low > 0xdfff) this.fail('json.lone-surrogate', 'Unpaired UTF-16 surrogate escape');
    return String.fromCharCode(unit, low);
  }

  private hex4(): number {
    const digits = this.s.slice(this.i, this.i + 4);
    if (!/^[0-9A-Fa-f]{4}$/.test(digits)) this.syntax('Invalid \\u escape');
    this.i += 4;
    return Number.parseInt(digits, 16);
  }

  private number(): number {
    NUMBER.lastIndex = this.i;
    const match = NUMBER.exec(this.s);
    if (!match) return this.syntax('Invalid number');
    const literal = match[0];
    const after = this.s[this.i + literal.length];
    if (after !== undefined && /[0-9.eE+-]/.test(after)) this.syntax('Invalid number');
    if (literal.length > MAX_NUMBER_LITERAL) this.fail('json.number-range', `Number literal longer than ${MAX_NUMBER_LITERAL} characters`);
    const value = Number(literal);
    if (!Number.isFinite(value)) this.fail('json.number-range', 'Number is outside the binary64 range');
    this.i += literal.length;
    return value;
  }

  private space(): void {
    for (;;) {
      const c = this.s.charCodeAt(this.i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.i++;
      else return;
    }
  }

  private syntax(message: string, back = 0): never {
    return this.fail('json.syntax', `${message} at ${this.where(this.i - back)}`);
  }

  private where(index: number): string {
    const before = this.s.slice(0, Math.max(0, index));
    const line = before.split('\n').length;
    return `line ${line}, column ${index - before.lastIndexOf('\n')}`;
  }

  private fail(code: string, message: string): never {
    throw new Failure(code, message, [...this.path]);
  }
}
