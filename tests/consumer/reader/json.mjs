// Strict, bounded JSON for the independent reader (adopted G1 step 1, I-JSON / RFC 8259).
// Fatal UTF-8 decoding, no BOM, duplicate member names rejected, lone surrogates rejected,
// finite numbers only. Node built-ins only; shares no code with MapLab's src/ library.

export class ReaderError extends Error {
  constructor(code, message, path = '$') {
    super(message);
    this.code = code;
    this.path = path;
  }
}

export const LIMITS = Object.freeze({ bytes: 64 * 1024 * 1024, depth: 64, string: 1024 * 1024, members: 10_000, items: 1_048_576 });

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export const pathText = (segments) => '$' + segments.map((s) => (typeof s === 'number' ? `[${s}]` : `.${s}`)).join('');

/** Parses bytes into plain JSON values with null-prototype-free ordinary objects. */
export function parseStrict(bytes, limits = LIMITS) {
  if (bytes.length > limits.bytes) throw new ReaderError('json.limit', `Document exceeds ${limits.bytes} bytes`);
  let text;
  try { text = decoder.decode(bytes); } catch { throw new ReaderError('json.utf8', 'Bytes are not valid UTF-8'); }
  if (text.charCodeAt(0) === 0xfeff) throw new ReaderError('json.bom', 'A byte-order mark is not allowed');
  let i = 0;
  const path = [];
  const fail = (code, message) => { throw new ReaderError(code, `${message} at offset ${i}`, pathText(path)); };
  const space = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++; };
  const string = () => {
    i++;
    let out = '';
    for (;;) {
      if (i >= text.length) fail('json.syntax', 'Unterminated string');
      const c = text.charCodeAt(i);
      if (c === 0x22) { i++; break; }
      if (c < 0x20) fail('json.syntax', 'Unescaped control character');
      if (c === 0x5c) {
        const e = text[i + 1];
        if (e === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('json.syntax', 'Malformed unicode escape');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else if (e !== undefined && Object.hasOwn(ESCAPES, e)) { out += ESCAPES[e]; i += 2; } else fail('json.syntax', 'Malformed escape');
      } else { out += text[i]; i++; }
      if (out.length > limits.string) fail('json.limit', 'String too long');
    }
    if (!out.isWellFormed()) fail('json.surrogate', 'Lone surrogate in string');
    return out;
  };
  // `depth` counts open containers, the outermost being 1; at most `limits.depth` may nest.
  const value = (depth) => {
    space();
    const c = text[i];
    if ((c === '{' || c === '[') && depth > limits.depth) fail('json.limit', 'Nesting too deep');
    if (c === '{') {
      i++;
      const out = {};
      const names = new Set();
      space();
      if (text[i] === '}') { i++; return out; }
      for (;;) {
        space();
        if (text[i] !== '"') fail('json.syntax', 'Expected member name');
        const name = string();
        if (names.has(name)) fail('json.duplicate-key', `Duplicate member "${name}"`);
        if (names.size >= limits.members) fail('json.limit', 'Too many members');
        names.add(name);
        space();
        if (text[i] !== ':') fail('json.syntax', 'Expected colon');
        i++;
        path.push(name);
        Object.defineProperty(out, name, { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
        path.pop();
        space();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return out; }
        fail('json.syntax', 'Expected comma or closing brace');
      }
    }
    if (c === '[') {
      i++;
      const out = [];
      space();
      if (text[i] === ']') { i++; return out; }
      for (;;) {
        if (out.length >= limits.items) fail('json.limit', 'Too many items');
        path.push(out.length);
        out.push(value(depth + 1));
        path.pop();
        space();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return out; }
        fail('json.syntax', 'Expected comma or closing bracket');
      }
    }
    if (c === '"') return string();
    for (const [word, literal] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(word, i)) { i += word.length; return literal; }
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (!m) fail('json.syntax', 'Unexpected token');
    i += m[0].length;
    const n = Number(m[0]);
    if (!Number.isFinite(n)) fail('json.number', 'Number is not finite');
    return n;
  };
  const result = value(1);
  space();
  if (i !== text.length) fail('json.syntax', 'Trailing content');
  return result;
}

/** RFC 8785 canonical text for values produced by parseStrict (export form; no trailing newline). */
export function jcs(v) {
  if (Array.isArray(v)) return `[${v.map(jcs).join(',')}]`;
  if (v !== null && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
