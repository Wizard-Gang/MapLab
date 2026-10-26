import type {MapDocument} from '../contracts/document-types';
import type {MovementDocument} from '../contracts/movement-types';
import {blockers,dirtyBounds,WitnessIndex,regenerate,type Blocker,type BlockerReport} from './blockers';
import {AIR_DEFAULTS,type AirSettings} from './airborne';
export type BlockerRequest={readonly kind:'cancel';readonly job:number}|{readonly kind:'regenerate';readonly job:number;readonly revision:number;readonly map:MapDocument;readonly profile:MovementDocument;readonly blockers:readonly Blocker[];readonly settings:AirSettings};
export type BlockerReply={readonly kind:'result';readonly job:number;readonly report:BlockerReport}|{readonly kind:'error';readonly job:number;readonly revision:number;readonly reason:string};
export function createBlockerEndpoint(post:(reply:BlockerReply)=>void){
 let current:{job:number;cancelled:boolean}|null=null;const cache=new Map<string,BlockerReport>();
 return async(request:BlockerRequest):Promise<void>=>{
  if(request.kind==='cancel'){if(current?.job===request.job)current.cancelled=true;return;}
  if(current)current.cancelled=true;const token={job:request.job,cancelled:false};current=token;
  try{
   const key=JSON.stringify([request.map.id,request.profile.id]),report=await regenerate(request.map,request.profile,request.revision,request.blockers,request.settings,cache.get(key)??null,()=>token.cancelled);
   if(current!==token||token.cancelled)return;
   if(['candidate','no route found within declared search/sampling budget'].includes(report.result.status)){cache.delete(key);cache.set(key,report);if(cache.size>4)cache.delete(cache.keys().next().value!);}
   post({kind:'result',job:request.job,report});
  }catch(e){if(current===token&&!token.cancelled)post({kind:'error',job:request.job,revision:request.revision,reason:String(e)});}
 };
}
export interface BlockerView {readonly phase:'idle'|'building'|'complete'|'failed';readonly report:BlockerReport|null;readonly disabledKeys:readonly string[];readonly error:string}
/** A new revision hides every obsolete preview synchronously, before transport/digest awaits. */
export class BlockerSession {
 private serial=0;private disposed=false;private pending:{job:number;revision:number;blockers:readonly Blocker[]}|null=null;
 private view:BlockerView={phase:'idle',report:null,disabledKeys:[],error:''};private listeners=new Set<()=>void>();private last:BlockerReport|null=null;
 constructor(private readonly send:(r:BlockerRequest)=>void){}
 readonly getSnapshot=()=>this.view;
 readonly subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private set(v:BlockerView){this.view=v;for(const f of this.listeners)f();}
 invalidate(){this.serial++;if(this.pending)this.send({kind:'cancel',job:this.pending.job});this.pending=null;this.set({phase:'idle',report:null,disabledKeys:[],error:''});}
 dispose(){this.invalidate();this.last=null;this.disposed=true;this.listeners.clear();}
 update(map:MapDocument,profile:MovementDocument,revision:number,value:readonly Blocker[],settings:AirSettings=AIR_DEFAULTS):void{
  if(this.disposed)throw Error('Disposed blocker session');this.invalidate();
  try{
   if(!Number.isSafeInteger(revision)||revision<0)throw Error('Invalid runtime revision');const bs=blockers(value),dirty=this.last?dirtyBounds(this.last.blockers,bs):null;
   const disabledKeys=dirty&&this.last?new WitnessIndex(this.last.result.edges).query(dirty):[];
   this.pending={job:this.serial,revision,blockers:bs};this.set({phase:'building',report:null,disabledKeys,error:''});
   this.send({kind:'regenerate',job:this.serial,revision,map:structuredClone(map),profile:structuredClone(profile),blockers:bs,settings:{...settings}});
  }catch(e){this.pending=null;this.set({phase:'failed',report:null,disabledKeys:[],error:String(e)});}
 }
 accept(reply:BlockerReply):boolean{
  const p=this.pending;if(this.disposed||!p||reply.job!==p.job)return false;
  if(reply.kind==='error'){if(reply.revision!==p.revision)return false;this.pending=null;this.set({phase:'failed',report:null,disabledKeys:[],error:reply.reason});return true;}
  const r=reply.report;if(r.revision!==p.revision||r.result.revision!==p.revision||r.result.canCertify!==false||JSON.stringify(r.blockers)!==JSON.stringify(p.blockers)||r.result.status==='cancelled')return false;
  this.pending=null;this.last=structuredClone(r);this.set({phase:'complete',report:structuredClone(r),disabledKeys:r.disabledKeys,error:''});return true;
 }
}
