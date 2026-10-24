import type {MapDocument,MovementDocument} from '../contracts';
import {digest} from '../physics-reference';import {planFlight,flightIdentity,FLIGHT_DEFAULTS,type FlightQuery,type FlightProof,type FlightSettings} from './planner';
export type FlightRequest={kind:'cancel';job:number}|{kind:'solve';job:number;revision:number;map:MapDocument;profile:MovementDocument;query:FlightQuery;settings:FlightSettings};
export type FlightReply={kind:'proof';job:number;proof:FlightProof}|{kind:'error';job:number;reason:string};
export function createFlightEndpoint(post:(reply:FlightReply)=>void){let current:{job:number;cancelled:boolean}|null=null;
 return async(r:FlightRequest):Promise<void>=>{if(r.kind==='cancel'){if(current?.job===r.job)current.cancelled=true;return;}if(current)current.cancelled=true;const token={job:r.job,cancelled:false};current=token;
  try{const proof=await planFlight(r.map,r.profile,r.query,r.revision,r.settings,()=>token.cancelled);if(current===token&&!token.cancelled)post({kind:'proof',job:r.job,proof});}catch(e){if(current===token&&!token.cancelled)post({kind:'error',job:r.job,reason:String(e)});}
 };
}
export interface FlightView {readonly phase:'idle'|'building'|'complete'|'failed';readonly proof:FlightProof|null;readonly error:string}
export class FlightSession {
 private serial=0;private disposed=false;private pending:{job:number;revision:number;cacheKey:string;querySha256:string}|null=null;
 private view:FlightView={phase:'idle',proof:null,error:''};private listeners=new Set<()=>void>();
 constructor(private readonly send:(request:FlightRequest)=>void){}
 getSnapshot=()=>this.view;subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private set(view:FlightView){this.view=view;for(const f of this.listeners)f();}
 invalidate(){this.serial++;if(this.pending)this.send({kind:'cancel',job:this.pending.job});this.pending=null;this.set({phase:'idle',proof:null,error:''});}
 dispose(){this.invalidate();this.disposed=true;this.listeners.clear();}
 async solve(map:MapDocument,profile:MovementDocument,query:FlightQuery,revision:number,settings:FlightSettings=FLIGHT_DEFAULTS){
  if(this.disposed)throw Error('Disposed flight session');this.invalidate();const job=this.serial,m=structuredClone(map),p=structuredClone(profile),q=structuredClone(query),s=structuredClone(settings);this.set({phase:'building',proof:null,error:''});
  try{const [id,querySha256]=await Promise.all([flightIdentity(m,p,s),digest(q)]);if(this.disposed||job!==this.serial)return;this.pending={job,revision,cacheKey:id.cacheKey,querySha256};this.send({kind:'solve',job,revision,map:m,profile:p,query:q,settings:s});}catch(e){if(job===this.serial&&!this.disposed)this.set({phase:'failed',proof:null,error:String(e)});}
 }
 accept(reply:FlightReply):boolean {
  const p=this.pending;if(this.disposed||!p||reply.job!==p.job)return false;if(reply.kind==='error'){this.pending=null;this.set({phase:'failed',proof:null,error:reply.reason});return true;}
  if(reply.proof.revision!==p.revision||reply.proof.identity.cacheKey!==p.cacheKey||reply.proof.querySha256!==p.querySha256||reply.proof.canCertify!==false||reply.proof.representation!=='flight free-space rect-union lattice')return false;
  this.pending=null;this.set({phase:'complete',proof:structuredClone(reply.proof),error:''});return true;
 }
}
