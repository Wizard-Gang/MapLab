// Immutable approved foreign bytes; no index/source mutation and no extraction of authored paths.
import {mkdirSync,writeFileSync,renameSync,rmSync,existsSync,readdirSync,lstatSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {dirname,join} from 'node:path';
import {verifyRigBundle,manifestEntries,RIG_LIMITS,digest} from '../riglab/bundle';
import type {RigBundle,RigView} from '../riglab/model';
import {readStoreZip,checkPaths} from '../export/zip';
import {insidePath,readLibraryFile,LibraryError,type LibraryFolder} from './folder';
export const RIG_REQUEST_LIMIT=24*1024*1024;
const PATH=/^presentations\/([a-f0-9]{64})\/manifest\.json$/;
function fail(s:string):never {throw new LibraryError('riglab.refused',s);}
export interface RigReply {readonly ok:true;readonly path:string;readonly bundle:RigView}
const reply=(path:string,b:RigBundle):RigReply=>({ok:true,path,bundle:{digest:b.digest,rig:b.rig,clips:b.clips,baked:b.baked,weapons:b.weapons}});
export function readRig(folder:LibraryFolder,path:string):RigBundle {
 const match=PATH.exec(path);if(!match)fail('Only content-addressed RigLab manifests are readable');const prefix=path.slice(0,-'manifest.json'.length);
 const raw=readLibraryFile(folder,path,RIG_LIMITS.fileBytes);if(!raw)fail('RigLab manifest is missing');
 const {entries}=manifestEntries(raw!),files=new Map<string,Uint8Array>([['manifest.json',raw!]]);
 // Reject unlisted files and symlinks as well as listed missing files, before validating bytes.
 let count=0;const walk=(relative:string,depth=0):void=>{if(depth>16)fail('Foreign directory depth limit');const dir=insidePath(folder,prefix+relative);for(const item of readdirSync(dir,{withFileTypes:true})){if(++count>512)fail('Foreign inventory limit');const p=relative+item.name,full=insidePath(folder,prefix+p);if(lstatSync(full).isSymbolicLink())fail('Foreign symlink');if(item.isDirectory())walk(p+'/',depth+1);else if(!item.isFile()||!files.has(p)&&!entries.some(e=>e.file===p))fail('Unlisted foreign file');}};
 for(const e of entries){const b=readLibraryFile(folder,prefix+e.file,RIG_LIMITS.fileBytes);if(!b)fail('Foreign file is missing');files.set(e.file,b!);}walk('');return verifyRigBundle(files,match![1]);
}
export function readRigReply(folder:LibraryFolder,body:unknown):RigReply {const p=(body as {path?:unknown})?.path;if(typeof p!=='string')return fail('A manifest path is required');return reply(p,readRig(folder,p));}
export function importRig(folder:LibraryFolder,body:unknown):RigReply {
 if(folder.placeholder)fail('The placeholder library refuses imports');const text=(body as {base64?:unknown})?.base64;
 if(typeof text!=='string'||text.length>RIG_REQUEST_LIMIT||text.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))fail('Invalid or oversized ZIP base64');
 const bytes=Buffer.from(text,'base64');if(bytes.length<22||bytes.readUInt16LE(bytes.length-12)>RIG_LIMITS.files||bytes.toString('base64')!==text||bytes.length>RIG_LIMITS.bytes)fail('Foreign ZIP byte limit');
 const bundle=verifyRigBundle(readStoreZip(bytes,{allowUnsorted:true})),prefix=`presentations/${bundle.digest}`,path=`${prefix}/manifest.json`;
 checkPaths([...bundle.files.keys()].map(p=>prefix+'/'+p));
 if(existsSync(insidePath(folder,prefix)))return reply(path,readRig(folder,path));
 const staging=`presentations/import-${randomUUID()}`,dir=insidePath(folder,staging);mkdirSync(dir,{recursive:true});
 try{for(const [p,b]of bundle.files){const full=insidePath(folder,staging+'/'+p);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,b,{flag:'wx',mode:0o444});}insidePath(folder,prefix);renameSync(dir,insidePath(folder,prefix));}
 finally{rmSync(dir,{recursive:true,force:true});}
 return reply(path,readRig(folder,path));
}
