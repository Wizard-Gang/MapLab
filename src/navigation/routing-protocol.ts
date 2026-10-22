import type { MapDocument } from '../contracts/document-types';
import type { MovementDocument } from '../contracts/movement-types';
import { digest, type ClimbState } from '../physics-reference';
import { Navigation, ROUTE_DEFAULTS, routingIdentity, type Goal, type RouteProof, type RouteSettings } from './routes';
export type RouteQuery={readonly kind:'route';readonly sourceId:string;readonly initial:ClimbState|null;readonly goal:Goal;readonly algorithm:'astar'|'dijkstra'}|{readonly kind:'region';readonly sourceId:string;readonly initial:ClimbState|null;readonly regionId:string;readonly algorithm:'astar'|'dijkstra'}|{readonly kind:'patrol';readonly entityId:string;readonly algorithm:'astar'|'dijkstra'};
export type RoutingRequest={readonly kind:'cancel';readonly job:number}|{readonly kind:'solve';readonly job:number;readonly revision:number;readonly map:MapDocument;readonly profile:MovementDocument;readonly settings:RouteSettings;readonly query:RouteQuery};
export type RoutingReply={readonly kind:'proof';readonly job:number;readonly requestSha256:string;readonly proof:RouteProof}|{readonly kind:'error';readonly job:number;readonly reason:string};
export function createRoutingEndpoint(post:(reply:RoutingReply)=>void){
 let active:{job:number;cancelled:boolean}|null=null;
 return async(request:RoutingRequest):Promise<void>=>{
  if(request.kind==='cancel'){if(active?.job===request.job)active.cancelled=true;return;}
  if(active)active.cancelled=true;const token={job:request.job,cancelled:false};active=token;
  try{
   const nav=await Navigation.build(request.map,request.profile,request.revision,request.settings,()=>token.cancelled);
   const q=request.query,proof=nav.status!=='candidate'?await nav.unavailable(q.algorithm,q.kind==='patrol'?null:q.initial):q.kind==='patrol'?await nav.patrol(q.entityId,q.algorithm,()=>token.cancelled):q.kind==='region'?await nav.region(q.initial??nav.sourceState(q.sourceId),q.regionId,q.algorithm,()=>token.cancelled):await nav.route(q.initial??nav.sourceState(q.sourceId),q.goal,q.algorithm,()=>token.cancelled);
   const requestSha256=await digest(q);if(active===token&&!token.cancelled)post({kind:'proof',job:request.job,requestSha256,proof});
  }catch(e){if(active===token&&!token.cancelled)post({kind:'error',job:request.job,reason:String(e)});}
 };
}
export interface RoutingView {readonly phase:'idle'|'building'|'complete'|'failed';readonly proof:RouteProof|null;readonly error:string}
/** Synchronous invalidation precedes digest/worker awaits. Derived results never enter history. */
export class RoutingSession {
 private serial=0;private disposed=false;private pending:{job:number;revision:number;cacheKey:string;requestSha256:string}|null=null;
 private view:RoutingView={phase:'idle',proof:null,error:''};private listeners=new Set<()=>void>();private cache=new Map<string,RouteProof>();
 constructor(private readonly send:(r:RoutingRequest)=>void){}
 readonly getSnapshot=()=>this.view;
 readonly subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private set(view:RoutingView){this.view=view;for(const f of this.listeners)f();}
 invalidate(){this.serial++;if(this.pending)this.send({kind:'cancel',job:this.pending.job});this.pending=null;this.set({phase:'idle',proof:null,error:''});}
 dispose(){this.invalidate();this.disposed=true;this.cache.clear();this.listeners.clear();}
 async solve(map:MapDocument,profile:MovementDocument,revision:number,query:RouteQuery,settings:RouteSettings=ROUTE_DEFAULTS):Promise<void>{
  if(this.disposed)throw Error('disposed routing session');this.invalidate();const job=this.serial,source=structuredClone(map),p=structuredClone(profile),s=structuredClone(settings),q=structuredClone(query);this.set({phase:'building',proof:null,error:''});
  try{
   const [identity,requestSha256]=await Promise.all([routingIdentity(source,p,s),digest(q)]);if(this.disposed||job!==this.serial)return;
   this.pending={job,revision,cacheKey:identity.cacheKey,requestSha256};const cacheKey=identity.cacheKey+requestSha256,cached=this.cache.get(cacheKey);
   if(cached){this.pending=null;this.cache.delete(cacheKey);this.cache.set(cacheKey,cached);this.set({phase:'complete',proof:{...structuredClone(cached),revision},error:''});return;}
   this.send({kind:'solve',job,revision,map:source,profile:p,settings:s,query:q});
  }catch(e){if(!this.disposed&&job===this.serial){this.pending=null;this.set({phase:'failed',proof:null,error:String(e)});}}
 }
 accept(reply:RoutingReply):boolean{
  const p=this.pending;if(this.disposed||!p||reply.job!==p.job)return false;
  if(reply.kind==='error'){this.pending=null;this.set({phase:'failed',proof:null,error:reply.reason});return true;}
  if(reply.requestSha256!==p.requestSha256||reply.proof.revision!==p.revision||reply.proof.identity.cacheKey!==p.cacheKey||reply.proof.canCertify!==false)return false;
  this.pending=null;const proof=structuredClone(reply.proof);this.set({phase:'complete',proof,error:''});
  if(proof.status==='verified reachable with replay witness'){const key=p.cacheKey+p.requestSha256;this.cache.delete(key);this.cache.set(key,structuredClone(proof));if(this.cache.size>4)this.cache.delete(this.cache.keys().next().value!);}
  return true;
 }
}
