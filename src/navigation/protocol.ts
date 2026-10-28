import type { MapDocument } from '../contracts/document-types';
import type { MovementDocument } from '../contracts/movement-types';
import { buildSurfaceGraph, identity, DEFAULT_SETTINGS, type Graph, type Settings, type Identity } from './surface';
import { GraphCache } from './cache';
export type Request={readonly kind:'build';readonly job:number;readonly revision:number;readonly map:MapDocument;readonly profile:MovementDocument;readonly settings:Settings}|{readonly kind:'cancel';readonly job:number};
export type Reply={readonly kind:'result';readonly job:number;readonly revision:number;readonly graph:Graph}|{readonly kind:'error';readonly job:number;readonly revision:number;readonly reason:string};
/** Transport-independent worker endpoint. Cancellation can run while the builder yields. */
export function createGraphWorker(post:(reply:Reply)=>void){
 let current:{job:number;cancelled:boolean}|null=null;
 return async (request:Request):Promise<void>=>{
  if(request.kind==='cancel'){if(current?.job===request.job)current.cancelled=true;return;}
  if(current)current.cancelled=true;
  const token={job:request.job,cancelled:false};current=token;
  try{
   const graph=await buildSurfaceGraph(request.map,request.profile,request.revision,request.settings,()=>token.cancelled);
   if(current===token&&!token.cancelled)post({kind:'result',job:request.job,revision:request.revision,graph});
  }catch(e){if(current===token&&!token.cancelled)post({kind:'error',job:request.job,revision:request.revision,reason:String(e)});}
 };
}
/** Main-thread publication guard: invalidate synchronously before any digest/worker await.
 * Consumers own this ephemeral session; authored documents and history never receive results. */
export class GraphSession {
 private serial=0;
 private pending:{job:number;revision:number;cacheKey:string}|null=null;
 private disposed=false;
 private cache=new GraphCache();
 private published:Graph|null=null;
 private readonly send:(request:Request)=>void;
 constructor(send:(request:Request)=>void,private readonly identify:(map:MapDocument,profile:MovementDocument,settings:Settings)=>Promise<Identity|null>=identity,private readonly cancelWork:()=>void=()=>{}){this.send=send;}
 get graph():Graph|null{return this.published;}
 get cacheUsage(){return {bytes:this.cache.bytes,budget:this.cache.budget,entries:this.cache.size};}
 invalidate():void{this.serial++;this.cancelWork();if(this.pending)this.send({kind:'cancel',job:this.pending.job});this.pending=null;this.published=null;}
 dispose():void{this.invalidate();this.disposed=true;this.cache.clear();}
 async build(map:MapDocument,profile:MovementDocument,revision:number,settings:Settings=DEFAULT_SETTINGS):Promise<void>{
  if(this.disposed)throw new Error('disposed graph session');
  this.invalidate();const job=this.serial,snapshot=structuredClone(map),p=structuredClone(profile),s={...settings};
  const id=await this.identify(snapshot,p,s);
  if(!id||this.disposed||job!==this.serial)return;
  this.pending={job,revision,cacheKey:id.cacheKey};
  const cached=this.cache.get(id.cacheKey);
  if(cached){this.published={...cached,revision};this.pending=null;return;}
  this.send({kind:'build',job,revision,map:snapshot,profile:p,settings:s});
 }
 accept(reply:Reply):boolean{
  const p=this.pending;
  if(this.disposed||!p||reply.job!==p.job||reply.revision!==p.revision)return false;
  if(reply.kind==='error'){this.pending=null;return false;}
  const g=reply.graph;if(g.revision!==p.revision||g.identity.cacheKey!==p.cacheKey||g.canCertify!==false)return false;
  this.pending=null;this.published=structuredClone(g);
  this.cache.put(g);
  return true;
 }
}
