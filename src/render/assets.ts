// Decoding happens only after byte inspection, using inert Blob images. Never assign an authored URL to src.
import type { Asset } from '../contracts/common-types';
import { inspectImage, PIXELS, type ApprovedImage } from '../assets/inspect';
import { readImage } from '../library/client';
export const IMAGE_BUDGET = 256 * 1024 * 1024;
export const svgBucket = (scale:number):number=>scale<=0.5?0.5:scale<=1?1:scale<=2?2:4;
export const base64Bytes = (s:string):Uint8Array=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export function bytesBase64(b:Uint8Array):string {let s='';for(let at=0;at<b.length;at+=8192)s+=String.fromCharCode(...b.subarray(at,at+8192));return btoa(s);}
export interface Decoded { readonly source:CanvasImageSource;readonly width:number;readonly height:number;close():void }
/** Small generic LRU for deterministic budget/lifecycle tests as well as the actual decoded surfaces. */
export class ImageLru {
  private entries=new Map<string,Decoded>();bytes=0;
  constructor(readonly budget=IMAGE_BUDGET){}
  get(key:string):Decoded|undefined {const v=this.entries.get(key);if(v){this.entries.delete(key);this.entries.set(key,v);}return v;}
  put(key:string,v:Decoded):void {this.remove(key);const n=v.width*v.height*4;if(n>this.budget){v.close();throw new Error('Decoded image exceeds cache budget');}while(this.bytes+n>this.budget)this.remove(this.entries.keys().next().value!);this.entries.set(key,v);this.bytes+=n;}
  private remove(key:string):void {const v=this.entries.get(key);if(v){this.entries.delete(key);this.bytes-=v.width*v.height*4;v.close();}}
  clear():void {for(const key of [...this.entries.keys()])this.remove(key);}
}
export async function decodeImage(approved:ApprovedImage,signal:AbortSignal,bucket=1):Promise<Decoded> {
  if(signal.aborted)throw new Error('Image decode cancelled');
  const [w,h]=approved.size;let width=w,height=h;
  if(approved.mediaType==='image/svg+xml') {const ratio=Math.min(bucket,4096/w,4096/h,Math.sqrt(PIXELS/(w*h)));width=Math.max(1,Math.ceil(w*ratio));height=Math.max(1,Math.ceil(h*ratio));}
  const blob=new Blob([approved.bytes.slice().buffer],{type:approved.mediaType}),url=URL.createObjectURL(blob),img=new Image();
  try {
    await new Promise<void>((resolve,reject)=>{const abort=():void=>{img.src='';reject(new Error('Image decode cancelled'));};const clear=():void=>{signal.removeEventListener('abort',abort);img.onload=img.onerror=null;};img.onload=()=>{clear();resolve();};img.onerror=()=>{clear();reject(new Error('Malformed or unsupported image encoding'));};signal.addEventListener('abort',abort,{once:true});img.src=url;if(signal.aborted){clear();abort();}});
    if(signal.aborted)throw new Error('Image decode cancelled');
    if(approved.mediaType!=='image/svg+xml'&&(img.naturalWidth!==w||img.naturalHeight!==h))throw new Error('Decoded raster dimensions differ from inspected header');
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image decoder has no Canvas2D context');ctx.drawImage(img,0,0,width,height);
    return {source:canvas,width,height,close(){canvas.width=canvas.height=0;}};
  } finally {img.onload=img.onerror=null;img.src='';URL.revokeObjectURL(url);}
}
/** One request/decode at a time; a bounded queue and disposal abort keep tab changes from accumulating images. */
export class DecodedImages {
  readonly lru=new ImageLru();private waiting=new Map<string,{asset:Asset;bucket:number}>();private errors=new Map<string,string>();private current:string|null=null;private controller=new AbortController();private disposed=false;private frameKeys=new Set<string>();private frameBytes=0;
  constructor(private readonly changed:()=>void,private readonly notice:(s:string)=>void){}
  beginFrame():void { this.frameKeys.clear();this.frameBytes=0; }
  endFrame():void { for(const key of this.waiting.keys())if(!this.frameKeys.has(key))this.waiting.delete(key); }
  get(asset:Asset,scale:number):Decoded|undefined {
    const bucket=asset.mediaType==='image/svg+xml'?svgBucket(scale*asset.wuPerAssetUnit):1,key=`${asset.path}/${bucket}`;if(!this.frameKeys.has(key)){const [w,h]=asset.size,ratio=asset.mediaType==='image/svg+xml'?Math.min(bucket,4096/w,4096/h,Math.sqrt(PIXELS/(w*h))):1,n=Math.max(1,Math.ceil(w*ratio))*Math.max(1,Math.ceil(h*ratio))*4;
      if(this.frameBytes+n>IMAGE_BUDGET){this.notice('Visible image cache budget reached; hide layers or zoom in.');return;}this.frameBytes+=n;this.frameKeys.add(key);}
    const v=this.lru.get(key);if(v)return v;
    if(this.errors.has(key)){this.notice(this.errors.get(key)!);return;}
    if(!this.disposed&&key!==this.current&&!this.waiting.has(key)&&this.waiting.size<128){this.waiting.set(key,{asset,bucket});void this.next();}return;
  }
  private async next():Promise<void> {
    if(this.current||this.disposed)return;const entry=this.waiting.entries().next().value;if(!entry)return;const [key,{asset,bucket}]=entry;this.waiting.delete(key);this.current=key;
    try {
      const r=await readImage(asset.path,this.controller.signal);if(!r.ok)throw new Error(r.message);
      if(r.asset.mediaType!==asset.mediaType||r.asset.size[0]!==asset.size[0]||r.asset.size[1]!==asset.size[1])throw new Error('Declared image metadata differs from approved bytes');
      const approved=inspectImage(base64Bytes(r.base64),asset.mediaType);const v=await decodeImage(approved,this.controller.signal,bucket);if(this.disposed)v.close();else this.lru.put(key,v);
    }catch(e){if(!this.disposed){const s=e instanceof Error?e.message:String(e);this.errors.set(key,s);this.notice(s);}}
    finally {this.current=null;if(!this.disposed){this.changed();void this.next();}}
  }
  dispose():void {this.disposed=true;this.controller.abort();this.waiting.clear();this.errors.clear();this.lru.clear();}
}
