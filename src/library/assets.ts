// Node-only immutable image copies. Import/read stay behind the library's origin/host/JSON guard and queue.
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, unlinkSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { inspectImage, RASTER_BYTES, type ImageType } from '../assets/inspect';
import { LibraryError, insidePath, readLibraryFile, type LibraryFolder } from './folder';
import type { Asset } from '../contracts/common-types';

export const ASSET_REQUEST_LIMIT = 23 * 1024 * 1024;
const extensions: Record<ImageType,string> = { 'image/png':'png','image/webp':'webp','image/svg+xml':'svg' };
export const ASSET_PATH = /^assets\/([a-f0-9]{12})\/([a-f0-9]{64})\.(png|webp|svg)$/;
const sha = (b:Uint8Array):string=>createHash('sha256').update(b).digest('hex');
const refusal = (s:string):never=>{throw new LibraryError('asset.refused',s);};
export interface AssetReply { readonly ok:true; readonly asset:Asset; readonly base64:string }
function describe(bytes:Uint8Array,mediaType:ImageType,size:readonly[number,number]):Asset {
  const hash=sha(bytes);return { id:`asset.${hash}`,path:`assets/${hash.slice(0,12)}/${hash}.${extensions[mediaType]}`,mediaType,wuPerAssetUnit:1,size };
}
export function importAsset(folder:LibraryFolder,body:unknown):AssetReply {
  if(folder.placeholder)throw new LibraryError('library.read-only','The placeholder library refuses asset imports');
  const b=body as {base64?:unknown;mediaType?:unknown};
  if(typeof b.base64!=='string'||typeof b.mediaType!=='string'||b.base64.length>Math.ceil(RASTER_BYTES/3)*4||b.base64.length%4!==0||/[^A-Za-z0-9+/=]/.test(b.base64))refusal('Bounded canonical base64 image required');
  const raw=Buffer.from(b.base64 as string,'base64');if(raw.toString('base64')!==b.base64)refusal('Noncanonical base64');
  let approved;try { approved=inspectImage(raw,b.mediaType as string); }catch(e){return refusal(e instanceof Error?e.message:String(e));}
  const asset=describe(approved.bytes,approved.mediaType,approved.size),full=insidePath(folder,asset.path);
  const previous=readLibraryFile(folder,asset.path,RASTER_BYTES);
  if(previous) { if(sha(previous)!==sha(approved.bytes))refusal('Immutable asset path already holds different bytes'); }
  else {
    mkdirSync(dirname(full),{recursive:true});insidePath(folder,asset.path);
    const temp=insidePath(folder,`assets/${sha(approved.bytes).slice(0,12)}/import-${randomUUID()}.tmp`);let fd:number|undefined;
    try {fd=openSync(temp,'wx',0o600);for(let at=0;at<approved.bytes.length;)at+=writeSync(fd,approved.bytes,at,approved.bytes.length-at);fsyncSync(fd);closeSync(fd);fd=undefined;insidePath(folder,asset.path);linkSync(temp,full);const dir=openSync(dirname(full),'r');try{fsyncSync(dir);}finally{closeSync(dir);} }
    finally {if(fd!==undefined)closeSync(fd);if(existsSync(temp))unlinkSync(temp);}
  }
  return {ok:true,asset,base64:Buffer.from(approved.bytes).toString('base64')};
}
export function readAsset(folder:LibraryFolder,body:unknown):AssetReply {
  const path=(body as {path?:unknown}).path;if(typeof path!=='string')return refusal('Asset path required');
  const m=ASSET_PATH.exec(path);if(!m||m[1]!==m[2]!.slice(0,12))return refusal('Only content-addressed approved asset paths are readable');
  const raw=readLibraryFile(folder,path,RASTER_BYTES);if(!raw||sha(raw)!==m[2])return refusal('Asset is missing or its immutable digest differs');
  const type=({'png':'image/png','webp':'image/webp','svg':'image/svg+xml'} as const)[m[3] as 'png'|'webp'|'svg'];
  let approved;try{approved=inspectImage(raw,type);}catch(e){return refusal(e instanceof Error?e.message:String(e));}
  if(sha(approved.bytes)!==m[2])return refusal('SVG bytes are not approved canonical structure');
  return {ok:true,asset:describe(approved.bytes,type,approved.size),base64:Buffer.from(approved.bytes).toString('base64')};
}
