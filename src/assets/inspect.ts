// Image byte boundary shared by the browser and the loopback helper. No network or DOM APIs.
import { sanitizeSvg } from './svg';
export type ImageType = 'image/png' | 'image/webp' | 'image/svg+xml';
export const RASTER_BYTES = 16 * 1024 * 1024;
export const PIXELS = 16_000_000;
export interface ApprovedImage { readonly bytes: Uint8Array; readonly mediaType: ImageType; readonly size: readonly [number, number] }
const no = (s: string): never => { throw new Error(`Asset refused: ${s}`); };
const ascii = (b: Uint8Array, a: number, n: number): string => String.fromCharCode(...b.subarray(a,a+n));
const dims = (w: number, h: number): readonly [number,number] => { if (![w,h].every(n=>Number.isInteger(n)&&n>0&&n<=4096) || w*h>PIXELS) no('raster dimensions/16 MP limit');return [w,h]; };
const u32 = (b: Uint8Array, at: number, le=false): number => new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(at,le);
export function crc32(bytes: Uint8Array): number { let c=0xffffffff;for (const n of bytes) { c^=n;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0); }return (c^0xffffffff)>>>0; }
function png(b: Uint8Array): readonly [number,number] {
  if (b.length<45 || ascii(b,0,8)!=='\x89PNG\r\n\x1a\n') no('PNG signature');
  let at=8, size:readonly[number,number]|null=null, idat=false, ended=false, afterData=false, palette=false;
  while(at<b.length) {
    if(at+12>b.length)no('truncated PNG chunk'); const n=u32(b,at),tag=ascii(b,at+4,4);if(n>b.length-at-12)no('PNG chunk size');
    if(crc32(b.subarray(at+4,at+8+n))!==u32(b,at+8+n))no('PNG CRC');
    if(!size) { if(tag!=='IHDR'||n!==13)no('PNG header'); size=dims(u32(b,at+8),u32(b,at+12));const depth=b[at+16]!,color=b[at+17]!;const depths:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};if(!depths[color]?.includes(depth)||b[at+18]!==0||b[at+19]!==0||![0,1].includes(b[at+20]!))no('PNG encoding'); }
    else if(tag==='IHDR')no('duplicate PNG header');
    else if(tag==='IDAT') { if(afterData||n===0)no('PNG data order');idat=true; }
    else if(tag==='IEND') { if(n||!idat||at+12!==b.length)no('PNG end');ended=true; }
    else { if(idat)afterData=true;if(tag==='PLTE'){if(palette||idat||n===0||n%3||n>768)no('PNG palette');palette=true;} else if(!['tRNS','cHRM','gAMA','sBIT','sRGB','bKGD','pHYs'].includes(tag))no('unsupported PNG chunk (including animation)'); }
    at+=12+n;
  }
  if(!ended||!size)no('incomplete PNG');return size!;
}
function webp(b: Uint8Array): readonly[number,number] {
  if(b.length<20||ascii(b,0,4)!=='RIFF'||ascii(b,8,4)!=='WEBP'||u32(b,4,true)!==b.length-8)no('WebP container');
  let at=12,header:readonly[number,number]|null=null,image:readonly[number,number]|null=null;
  const seen=new Set<string>();
  while(at<b.length) {
    if(at+8>b.length)no('truncated WebP');const tag=ascii(b,at,4),n=u32(b,at+4,true),s=at+8;if(n>b.length-s||seen.has(tag))no('WebP chunk size/duplicate');seen.add(tag);
    if(tag==='VP8X') { if(at!==12||n!==10||(b[s]!&0xc3)!==0||(b[s]!&2)!==0||b[s+1]||b[s+2]||b[s+3])no('WebP extended/animation');const u24=(i:number)=>b[i]!+256*b[i+1]!+65536*b[i+2]!;header=dims(1+u24(s+4),1+u24(s+7)); }
    else if(tag==='VP8L') { if(n<5||b[s]!==0x2f)no('WebP lossless header');const bits=u32(b,s+1,true);if(bits>>>29)no('WebP lossless version');image=dims(1+(bits&0x3fff),1+((bits>>>14)&0x3fff)); }
    else if(tag==='VP8 ') { if(n<10||(b[s]!&1)!==0||ascii(b,s+3,3)!=='\x9d\x01\x2a')no('WebP lossy header');image=dims((b[s+6]!+256*b[s+7]!)&0x3fff,(b[s+8]!+256*b[s+9]!)&0x3fff); }
    else if(!['ALPH','ICCP'].includes(tag))no('unsupported WebP chunk (including animation)');
    at=s+n+(n%2);if(at>b.length)no('WebP padding');
  }
  if(!image||seen.has('VP8L')&&seen.has('VP8 ')||header&&(header[0]!==image![0]||header[1]!==image![1]))no('WebP dimensions/image');return image!;
}
export function inspectImage(input: Uint8Array, mediaType: string): ApprovedImage {
  if(mediaType==='image/svg+xml')return { ...sanitizeSvg(input), mediaType };
  if(!['image/png','image/webp'].includes(mediaType))return no('only PNG, WebP and allowlisted SVG are supported');
  if(input.length>RASTER_BYTES)no('16 MiB byte limit');
  return { bytes:input.slice(),mediaType:mediaType as ImageType,size:mediaType==='image/png'?png(input):webp(input) };
}
