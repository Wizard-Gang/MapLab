// Structural, closed XML/SVG grammar. Imported source is never DOM markup; only this reserialization decodes.
export const SVG_BYTES = 2 * 1024 * 1024;
export const SVG_NODES = 20_000;
export const SVG_COMMANDS = 200_000;
interface Node { tag: string; attrs: Map<string, string>; children: Node[] }
const geometry = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'];
const common = ['id', 'transform', 'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'clip-path', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit'];
const attrs: Record<string, string[]> = {
  svg: ['xmlns', 'viewBox', 'width', 'height'], g: common, defs: ['id'],
  path: [...common, 'd'], rect: [...common, 'x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: [...common, 'cx', 'cy', 'r'], ellipse: [...common, 'cx', 'cy', 'rx', 'ry'],
  line: [...common, 'x1', 'y1', 'x2', 'y2'], polyline: [...common, 'points'], polygon: [...common, 'points'],
  linearGradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href'],
  radialGradient: ['id', 'cx', 'cy', 'r', 'fx', 'fy', 'fr', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href'],
  stop: ['offset', 'stop-color', 'stop-opacity'], clipPath: ['id', 'clipPathUnits', 'transform'],
};
const fail = (message: string): never => { throw new Error(`SVG refused: ${message}`); };
const numPattern = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
function numbers(s: string): number[] {
  const out: number[] = []; let i = 0, need = false;
  while (i < s.length) {
    while (/[ \t\r\n]/.test(s[i] ?? '') && i < s.length) i++;
    if (s[i] === ',') { if (!out.length || need) fail('invalid number separator'); need = true; i++; continue; }
    if (i === s.length) break;
    numPattern.lastIndex = i; const m = numPattern.exec(s); if (!m) fail('literal finite numbers required');
    const n = Number(m![0]); if (!Number.isFinite(n) || Math.abs(n) > 1_000_000) fail('number exceeds bounds');
    out.push(n); i = numPattern.lastIndex; need = false;
  }
  if (need || !out.length) fail('missing number'); return out;
}
const scalar = (s: string): number => { const a = numbers(s); if (a.length !== 1) fail('one number required'); return a[0]!; };
function pathCommands(d: string): number {
  let i = 0, command = '', first = true, count = 0;
  const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
  while (i < d.length) {
    while (/[ \t\r\n]/.test(d[i] ?? '') && i < d.length) i++;
    if (i === d.length) break;
    if (/[a-zA-Z]/.test(d[i]!)) { command = d[i++]!; if (first && command.toUpperCase() !== 'M') fail('path starts with move'); first = false; }
    else fail('path command required');
    const c = command.toUpperCase();
    if (c === 'Z') { count++; continue; }
    if (!arity[c]) fail('unsupported path command');
    const start = i;
    // e/E belongs to exponent notation. Other letters begin the next command.
    while (i < d.length && !/[a-df-zA-DF-Z]/.test(d[i]!)) i++;
    const ns = numbers(d.slice(start, i)); const n = arity[c]!;
    if (ns.length % n) fail('incomplete path command');
    if (c === 'A') for (let j = 0; j < ns.length; j += 7) if (ns[j]! < 0 || ns[j + 1]! < 0 || ![0, 1].includes(ns[j + 3]!) || ![0, 1].includes(ns[j + 4]!)) fail('invalid arc');
    count += ns.length / n; if (count > SVG_COMMANDS) fail('path command limit');
  }
  if (first) fail('empty path'); return count;
}
function transform(s: string): void {
  let i = 0;
  while (i < s.length) {
    while (/[ \t\r\n,]/.test(s[i] ?? '') && i < s.length) i++;
    if (i === s.length) break;
    const m = /^(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^()]*)\)/.exec(s.slice(i));
    if (!m) fail('literal transform required');
    const ns = numbers(m![2]!); const counts: Record<string, number[]> = { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] };
    if (!counts[m![1]!]!.includes(ns.length)) fail('invalid transform arity'); i += m![0].length;
  }
}
/** Strict XML tokenizer with explicit tag/attribute/tree validation, followed by approved-only serialization. */
export function sanitizeSvg(input: Uint8Array): { bytes: Uint8Array; size: readonly [number, number] } {
  if (input.length > SVG_BYTES) fail('2 MiB byte limit');
  let xml: string; try { xml = new TextDecoder('utf-8', { fatal: true }).decode(input); } catch { return fail('invalid UTF-8'); }
  if (/[&\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) fail('entities and controls forbidden');
  xml = xml.replace(/^\uFEFF/, '');
  if (xml.startsWith('<?xml')) {
    const m = /^<\?xml\s+version\s*=\s*["']1\.0["'](?:\s+encoding\s*=\s*["']UTF-8["'])?\s*\?>/i.exec(xml);
    if (!m) fail('unsupported XML declaration'); xml = xml.slice(m![0].length);
  }
  let at = 0, count = 0, commands = 0; const stack: Node[] = []; let root: Node | null = null;
  const ownCommands=new Map<Node,number>();
  const ids = new Map<string, Node>(), refs: { node: Node; id: string; kind: 'gradient' | 'clip' }[] = [];
  const name = (): string => { const m = /^[A-Za-z][A-Za-z0-9-]*/.exec(xml.slice(at)); if (!m) return fail('invalid XML name'); at += m[0].length; return m[0]; };
  const space = (): void => { while (/[ \t\r\n]/.test(xml[at] ?? '') && at < xml.length) at++; };
  while (at < xml.length) {
    space(); if (at === xml.length) break;
    if (xml.startsWith('<!--', at)) { const end = xml.indexOf('-->', at + 4); if (end < 0 || xml.slice(at + 4, end).includes('--')) fail('invalid comment'); at = end + 3; continue; }
    if (xml[at++] !== '<') fail('only geometry elements and whitespace allowed');
    if (xml[at] === '/') { at++; const tag = name(); space(); if (xml[at++] !== '>' || stack.pop()?.tag !== tag) fail('mismatched close tag'); continue; }
    const tag = name(); if (!Object.hasOwn(attrs, tag)) fail(`unsupported element ${tag}`);
    if (++count > SVG_NODES || stack.length >= 64) fail('node/depth limit');
    const node: Node = { tag, attrs: new Map(), children: [] }; let self = false;
    while (true) {
      const before = at; space();
      if (xml.startsWith('/>', at)) { at += 2; self = true; break; }
      if (xml[at] === '>') { at++; break; }
      if (before === at) fail('attributes need whitespace');
      const key = name(); if (!attrs[tag]!.includes(key) || node.attrs.has(key)) fail(`unsupported/duplicate ${tag} attribute ${key}`);
      space(); if (xml[at++] !== '=') fail('attribute assignment required'); space(); const q = xml[at++];
      if (q !== '"' && q !== "'") fail('quoted attribute required'); const end = xml.indexOf(q!, at);
      if (end < 0) fail('unterminated attribute'); const value = xml.slice(at, end); at = end + 1;
      if (/[<>]/.test(value)) fail('markup in attribute'); node.attrs.set(key, value);
    }
    const parent = stack.at(-1);
    if (!parent) { if (root || tag !== 'svg') fail('one svg root required'); root = node; }
    else {
      const allowed = parent.tag === 'svg' || parent.tag === 'g' ? [...geometry, 'g', 'defs'] : parent.tag === 'defs' ? [...geometry, 'g', 'linearGradient', 'radialGradient', 'clipPath'] : parent.tag === 'clipPath' ? [...geometry, 'g'] : ['linearGradient', 'radialGradient'].includes(parent.tag) ? ['stop'] : [];
      if (!allowed.includes(tag)) fail('invalid element nesting'); parent.children.push(node);
    }
    const commandStart=commands;
    for (const [key, value] of node.attrs) {
      if (key === 'id') { if (!/^[A-Za-z][A-Za-z0-9_.-]{0,95}$/.test(value) || ids.has(value)) fail('invalid/duplicate id'); ids.set(value, node); }
      else if (key === 'xmlns') { if (value !== 'http://www.w3.org/2000/svg') fail('wrong namespace'); }
      else if (key === 'viewBox') { const ns = numbers(value); if (ns.length !== 4 || ns[2]! <= 0 || ns[3]! <= 0 || ns[2]! > 131072 || ns[3]! > 131072) fail('invalid viewBox'); }
      else if (key === 'd') commands += pathCommands(value);
      else if (key === 'points') { const ns = numbers(value); if (ns.length < (tag === 'polygon' ? 6 : 4) || ns.length % 2) fail('invalid points'); commands += ns.length / 2; }
      else if (key === 'transform' || key === 'gradientTransform') transform(value);
      else if (key === 'href' || key === 'clip-path' || ((key === 'fill' || key === 'stroke') && value.startsWith('url('))) {
        const m = key === 'href' ? /^#([A-Za-z][A-Za-z0-9_.-]{0,95})$/.exec(value) : /^url\(#([A-Za-z][A-Za-z0-9_.-]{0,95})\)$/.exec(value);
        if (!m) fail('only internal references allowed'); refs.push({ node, id: m![1]!, kind: key === 'clip-path' ? 'clip' : 'gradient' });
      } else if (['fill', 'stroke', 'stop-color'].includes(key)) { if (!/^(?:none|#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)$/.test(value)) fail('literal hex paint required'); }
      else if (['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'offset'].includes(key)) { const n = scalar(key === 'offset' && value.endsWith('%') ? value.slice(0, -1) : value); if (n < 0 || n > (value.endsWith('%') && key === 'offset' ? 100 : 1)) fail('opacity/offset range'); }
      else if (['fill-rule', 'clip-rule'].includes(key)) { if (!['nonzero', 'evenodd'].includes(value)) fail('invalid fill rule'); }
      else if (key === 'stroke-linecap') { if (!['butt', 'round', 'square'].includes(value)) fail('invalid linecap'); }
      else if (key === 'stroke-linejoin') { if (!['miter', 'round', 'bevel'].includes(value)) fail('invalid linejoin'); }
      else if (key.endsWith('Units')) { if (!['userSpaceOnUse', 'objectBoundingBox'].includes(value)) fail('invalid units'); }
      else if (key === 'spreadMethod') { if (!['pad', 'reflect', 'repeat'].includes(value)) fail('invalid spread'); }
      else { const n = scalar(value.endsWith('%') && ['x1','x2','y1','y2','cx','cy','r','fx','fy','fr'].includes(key) ? value.slice(0,-1) : value); if (['width', 'height', 'r', 'rx', 'ry', 'fr', 'stroke-width', 'stroke-miterlimit'].includes(key) && n < 0) fail('negative length'); }
    }
    ownCommands.set(node,commands-commandStart);
    if (commands > SVG_COMMANDS) fail('aggregate path command limit'); if (!self) stack.push(node);
  }
  if (!root || stack.length) fail('missing/unclosed root');
  const box = root!.attrs.get('viewBox'); const ns = box ? numbers(box) : [0, 0, scalar(root!.attrs.get('width') ?? ''), scalar(root!.attrs.get('height') ?? '')];
  const size: readonly [number, number] = [ns[2]!, ns[3]!]; if (size.some(n => n <= 0 || n > 131072)) fail('positive bounded dimensions required');
  const edges = new Map<Node, Node[]>();
  const walk = (node: Node): void => { edges.set(node, [...node.children]); for (const c of node.children) walk(c); }; walk(root!);
  for (const ref of refs) { const dest = ids.get(ref.id); if (!dest || (ref.kind === 'clip' ? dest.tag !== 'clipPath' : !['linearGradient', 'radialGradient'].includes(dest.tag))) fail('missing/wrong reference'); edges.get(ref.node)!.push(dest!); }
  const visiting = new Set<Node>(), done = new Set<Node>(), costs = new Map<Node,readonly[number,number]>();
  const visit = (n: Node, depth = 0): void => { if (depth > 128) fail('reference depth limit'); if (visiting.has(n)) fail('cyclic geometry/reference'); if (done.has(n)) return; visiting.add(n); for (const c of edges.get(n)!) visit(c, depth + 1); let nodes=1,commands=ownCommands.get(n)??0;for(const c of edges.get(n)!){const cost=costs.get(c)!;nodes+=cost[0];commands+=cost[1];if(nodes>SVG_NODES||commands>SVG_COMMANDS)fail('expanded reference complexity limit');}costs.set(n,[nodes,commands]);visiting.delete(n); done.add(n); }; visit(root!);
  root!.attrs.set('xmlns', 'http://www.w3.org/2000/svg'); root!.attrs.set('viewBox', ns.join(' ')); root!.attrs.set('width', String(size[0])); root!.attrs.set('height', String(size[1]));
  const serialize = (n: Node): string => `<${n.tag}${[...n.attrs].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => ` ${k}="${v.replaceAll('"', '&quot;')}"`).join('')}>${n.children.map(serialize).join('')}</${n.tag}>`;
  const bytes = new TextEncoder().encode(serialize(root!)); if (bytes.length > SVG_BYTES) fail('approved byte limit');
  return { bytes, size };
}
