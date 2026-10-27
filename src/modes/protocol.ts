import type {MapDocument,MovementDocument} from '../contracts';
import {digest} from '../physics-reference';
import {planModes,modeIdentity,MODE_DEFAULTS,type ModeQuery,type ModeSettings,type ModeProof} from './planner';
export type ModeRequest={kind:'cancel';job:number}|{kind:'solve';job:number;revision:number;map:MapDocument;profile:MovementDocument;query:ModeQuery;settings:ModeSettings};
export type ModeReply={kind:'proof';job:number;proof:ModeProof}|{kind:'error';job:number;reason:string};
export function createModeEndpoint(post:(r:ModeReply)=>void){let current:{job:number;cancelled:boolean}|null=null;
 return async(r:ModeRequest)=>{if(r.kind==='cancel'){if(current?.job===r.job)current.cancelled=true;return;}if(current)current.cancelled=true;const token={job:r.job,cancelled:false};current=token;
  try{const proof=await planModes(r.map,r.profile,r.query,r.revision,r.settings,()=>token.cancelled);if(current===token&&!token.cancelled)post({kind:'proof',job:r.job,proof});}catch(e){if(current===token&&!token.cancelled)post({kind:'error',job:r.job,reason:String(e)});}
 };
}
export class ModeSession {
 private serial=0;private disposed=false;private pending:{job:number;revision:number;identity:string;querySha256:string}|null=null;
 private view:{phase:'idle'|'building'|'complete'|'failed';proof:ModeProof|null;error:string}={phase:'idle',proof:null,error:''};private listeners=new Set<()=>void>();
 constructor(private readonly send:(r:ModeRequest)=>void){}
 getSnapshot=()=>this.view;subscribe=(f:()=>void)=>{this.listeners.add(f);return()=>{this.listeners.delete(f);};};
 private set(view:typeof this.view){this.view=view;for(const f of this.listeners)f();}
 invalidate(){this.serial++;if(this.pending)this.send({kind:'cancel',job:this.pending.job});this.pending=null;this.set({phase:'idle',proof:null,error:''});}
 dispose(){this.invalidate();this.disposed=true;this.listeners.clear();}
 async solve(map:MapDocument,profile:MovementDocument,query:ModeQuery,revision:number,settings:ModeSettings=MODE_DEFAULTS){
  if(this.disposed)throw Error('Disposed mode session');this.invalidate();const job=this.serial,m=structuredClone(map),p=structuredClone(profile),q=structuredClone(query),s=structuredClone(settings);this.set({phase:'building',proof:null,error:''});
  try{const [identity,querySha256]=await Promise.all([modeIdentity(m,p,s),digest(q)]);if(this.disposed||job!==this.serial)return;this.pending={job,revision,identity:identity.cacheKey,querySha256};this.send({kind:'solve',job,revision,map:m,profile:p,query:q,settings:s});}catch(e){if(job===this.serial&&!this.disposed)this.set({phase:'failed',proof:null,error:String(e)});}
 }
 accept(r:ModeReply):boolean {const p=this.pending;if(!p||this.disposed||r.job!==p.job)return false;if(r.kind==='error'){this.pending=null;this.set({phase:'failed',proof:null,error:r.reason});return true;}
  if(r.proof.revision!==p.revision||r.proof.identity.cacheKey!==p.identity||r.proof.querySha256!==p.querySha256||r.proof.canCertify!==false||r.proof.complete!==false)return false;this.pending=null;this.set({phase:'complete',proof:structuredClone(r.proof),error:''});return true;
 }
}
