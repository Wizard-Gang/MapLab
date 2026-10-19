import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { inspectImage, RASTER_BYTES, crc32 } from '../src/assets/inspect';
import { sanitizeSvg, SVG_BYTES } from '../src/assets/svg';
import { ImageLru, svgBucket, type Decoded } from '../src/render/assets';
const fixture=(name:string)=>new Uint8Array(readFileSync(join(import.meta.dirname,'../conformance/visuals',name)));
const svg=(s:string)=>new TextEncoder().encode(s);
const wrap=(s:string)=>svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${s}</svg>`);
for(const [name,type] of [['owned.png','image/png'],['owned.webp','image/webp'],['owned.svg','image/svg+xml']] as const)test(`owned ${name} validates and approved bytes are idempotent`,()=>{
  const a=inspectImage(fixture(name),type),b=inspectImage(a.bytes,type);expect([...b.bytes]).toEqual([...a.bytes]);expect(a.size).toEqual(name.endsWith('svg')?[16,16]:[8,8]);
});
test('fixture inventory pins owned bytes and expected refusal',()=>{const index=JSON.parse(readFileSync(join(import.meta.dirname,'../conformance/visuals/index.json'),'utf8'));for(const f of index.files){const b=fixture(f.path);expect(createHash('sha256').update(b).digest('hex')).toBe(f.sha256);if(f.accept)expect(()=>inspectImage(b,f.type)).not.toThrow();else expect(()=>inspectImage(b,f.type)).toThrow();}});
for(const content of [
  '<script/>','<style>@import url(https://evil.invalid)</style>','<image href="https://evil.invalid/a"/>','<foreignObject/>','<animate/>','<use href="#a"/>','<filter/>','<text>x</text>',
  '<g onclick="alert(1)"/>','<g style="fill:red"/>','<g fill="url(https://evil.invalid/a)"/>','<g fill="red"/>','<g xmlns="http://evil.invalid"/>','<g xlink:href="#x"/>','<g transform="translate(Infinity)"/>','<rect width="-1"/>','<rect width="1" width="2"/>','<rect width="1"height="2"/>','<path d="M0 0A1 1 0 3 0 4 4"/>','<path d="M0 0L1"/>','<path d="M0 0C1e999 1 2 2 3 3"/>','<polygon points="0 0 1"/>','<g fill="url(#absent)"/>','<defs><clipPath id="c"><g clip-path="url(#c)"/></clipPath></defs>','<defs><linearGradient id="g" href="#g"/></defs>','<g id="a"/><g id="a"/>','<g><rect/></svg>', '<g>not geometry</g>', '<g/><svg/>',
])test(`SVG rejects ${content.slice(0,75)}`,()=>expect(()=>sanitizeSvg(wrap(content))).toThrow());
for(const text of ['<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>','<?evil?><svg/>','<svg viewBox="0 0 1 1">&amp;</svg>','<svg viewBox="0 0 1 1"/>trailer','<svg viewBox="0 0 1 1"><![CDATA[x]]></svg>'])test(`XML refuses unsupported syntax ${text.slice(0,45)}`,()=>expect(()=>sanitizeSvg(svg(text))).toThrow());
test('node, path-segment, aggregate, depth, byte and reference-chain budgets reject before decode',()=>{
  const refuses=(b:Uint8Array,reason:RegExp):void=>{ expect(()=>sanitizeSvg(b)).toThrow(reason); };
  refuses(wrap('<rect/>'.repeat(20000)), /node/);
  refuses(wrap(`<path d="M0 0${'L0 0'.repeat(200000)}"/>`), /command/);
  refuses(wrap(`<path d="M0 0${'L0 0'.repeat(100000)}"/><path d="M0 0${'L0 0'.repeat(100000)}"/>`), /command/);
  refuses(wrap('<g>'.repeat(64)+'</g>'.repeat(64)), /depth/);
  refuses(new Uint8Array(SVG_BYTES+1), /byte/);
  const gradients=Array.from({length:200},(_,i)=>`<linearGradient id="g${i}"${i<199?` href="#g${i+1}"`:''}/>`).join('');
  refuses(wrap(`<defs>${gradients}</defs>`), /depth/);
});
test('approved XML contains only serialized allowlisted structure; gradients clips geometry and negative origin survive',()=>{
  const a=sanitizeSvg(fixture('owned.svg'));
  const s=new TextDecoder().decode(a.bytes);
  expect(s).toContain('viewBox="-4 -4 16 16"');
  expect(s).toContain('clip-path="url(#window)"');
  expect(s).not.toMatch(/<script|<!|<image/);
  const radial=wrap('<defs><radialGradient id="r" gradientTransform="rotate(45)" cx="50%"><stop offset="50%" stop-color="#112233"/></radialGradient></defs><ellipse cx="8" cy="8" rx="3" ry="2" fill="url(#r)"/>');
  expect(()=>sanitizeSvg(radial)).not.toThrow();
});
test('raster media, CRC, truncation, oversized dimensions, bytes and appended polyglots reject',()=>{
  const b=fixture('owned.png');for(const bad of [b.slice(0,20),new Uint8Array([...b,1]),b.map((n,i)=>i===40?n^1:n),fixture('massive.png')])expect(()=>inspectImage(bad,'image/png')).toThrow();
  expect(()=>inspectImage(b,'image/webp')).toThrow();expect(()=>inspectImage(b,'image/jpeg')).toThrow();expect(()=>inspectImage(new Uint8Array(RASTER_BYTES+1),'image/png')).toThrow(/byte/);
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  const webp=fixture('owned.webp');expect(()=>inspectImage(webp.slice(0,-1),'image/webp')).toThrow();expect(()=>inspectImage(new Uint8Array([...webp,0]),'image/webp')).toThrow();
});
test('LRU obeys exact RGBA budget, closes evictions/replacements and refuses oversized surfaces',()=>{
  const closed:string[]=[];const image=(s:string,w=2,h=2):Decoded=>({source:{} as CanvasImageSource,width:w,height:h,close:()=>{closed.push(s);}});const cache=new ImageLru(32);cache.put('a',image('a'));cache.put('b',image('b'));expect(cache.bytes).toBe(32);cache.get('a');cache.put('c',image('c'));expect(closed).toEqual(['b']);expect(cache.get('b')).toBeUndefined();cache.put('a',image('a2'));expect(closed).toContain('a');expect(()=>cache.put('huge',image('huge',4,4))).toThrow();expect(closed).toContain('huge');cache.clear();expect(cache.bytes).toBe(0);expect(closed).toContain('a2');expect(closed).toContain('c');expect([0.25,0.5,0.75,1,1.5,2,3,12].map(svgBucket)).toEqual([0.5,0.5,1,1,2,2,4,4]);
});

test('small acyclic SVG graph with exponential clip expansion refuses its expanded budget',()=>{
  const clips=Array.from({length:20},(_,i)=>`<clipPath id="c${i}"><rect width="8" height="8"${i<19?` clip-path="url(#c${i+1})"`:''}/><circle r="4"${i<19?` clip-path="url(#c${i+1})"`:''}/></clipPath>`).join('');
  expect(()=>sanitizeSvg(wrap(`<defs>${clips}</defs><rect width="8" height="8" clip-path="url(#c0)"/>`))).toThrow(/complexity/);
});
