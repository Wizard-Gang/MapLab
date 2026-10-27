import type {MapDocument,MovementDocument} from '../contracts';
import {digest} from '../physics-reference';
import {own} from '../flight/controller';
import {planActions,actionIdentity,ACTION_DEFAULTS,type ActionQuery,type ActionSettings,type ActionProof} from './planner';
export type ActionRequest={kind:'cancel';job:number}|{kind:'solve';job:number;revision:number;map:MapDocument;profile:MovementDocument;query:ActionQuery;settings:ActionSettings};
export type ActionReply={kind:'proof';job:number;proof:ActionProof}|{kind:'error';job:number;reason:string};
export function createActionEndpoint(post:(r:ActionReply)=>void){let current:{job:number;cancelled:boolean}|null=null;
 return async(r:ActionRequest)=>{if(r.kind==='cancel'){if(current?.job===r.job)current.cancelled=true;return;}if(current)current.cancelled=true;const token={job:r.job,cancelled:false};current=token;
  try{const proof=await planActions(r.map,r.profile,r.query,r.revision,r.settings,()=>token.cancelled);if(current===token&&!token.cancelled)post({kind:'proof',job:r.job,proof});}catch(e){if(current===token&&!token.cancelled)post({kind:'error',job:r.job,reason:String(e)});}
 };
}
export class ActionSession {
 private serial=0;private disposed=false;private pending:{job:number;revision:number;identity:string;querySha256:string}|null=null;
 private view:{phase:'idle'|'building'|'complete'|'failed';proof:ActionProof|null;error:string}={phase:'idle',proof:null,error:''};private listeners=new Set<()=>void>();
 constructor(private readonly send:(r:ActionRequest)=>void){}
 getSnapshot=()=>this.view;subscribe=(f:()=>void)=>{this.listeners.add(f);return()=>{this.listeners.delete(f);};};
 private set(view:typeof this.view){this.view=view;for(const f of this.listeners)f();}
 invalidate(){this.serial++;if(this.pending)this.send({kind:'cancel',job:this.pending.job});this.pending=null;this.set({phase:'idle',proof:null,error:''});}
 dispose(){this.invalidate();this.disposed=true;this.listeners.clear();}
 async solve(map:MapDocument,profile:MovementDocument,query:ActionQuery,revision:number,settings:ActionSettings=ACTION_DEFAULTS){
  if(this.disposed)throw Error('Disposed action session');this.invalidate();const job=this.serial,m=own(map),p=own(profile),q=own(query),s=own(settings);this.set({phase:'building',proof:null,error:''});
  try{const [identity,querySha256]=await Promise.all([actionIdentity(m,p,q.initial,s),digest(q)]);if(this.disposed||job!==this.serial)return;this.pending={job,revision,identity:identity.cacheKey,querySha256};this.send({kind:'solve',job,revision,map:m,profile:p,query:q,settings:s});}catch(e){if(job===this.serial&&!this.disposed)this.set({phase:'failed',proof:null,error:String(e)});}
 }
 accept(r:ActionReply):boolean {const p=this.pending;if(!p||this.disposed||r.job!==p.job)return false;if(r.kind==='error'){this.pending=null;this.set({phase:'failed',proof:null,error:r.reason});return true;}
  if(r.proof.revision!==p.revision||r.proof.identity.cacheKey!==p.identity||r.proof.querySha256!==p.querySha256||r.proof.canCertify!==false||r.proof.complete!==false)return false;this.pending=null;this.set({phase:'complete',proof:own(r.proof),error:''});return true;
 }
}
