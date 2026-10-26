import {step,airJumpCount,supportedJumpProfile,hasDash} from '../dash/runtime';
import {buildDashActions} from './dash';
import {DASH_PRIMITIVE_SHA256} from '../dash/identity';
import {buildAirJumpActions,primitiveLimits,type PrimitiveLimits} from './air-jumps';
import {AIR_PRIMITIVE_SHA256} from '../air-jumps/identity';
import {groundIntentSupported,groundMotionAllowed} from './intent';
// Bounded single-action solver. These exact action states are not a route graph.
import type { MapDocument } from '../contracts/document-types';
import type { MovementDocument } from '../contracts/movement-types';
import { createWorld, resolveStance, overlaps, digest } from '../physics-reference';
import type { ContactMap, ClimbState, Step, RunInput, World } from '../physics-reference';
import { buildSurfaceGraph, identity as surfaceIdentity, DEFAULT_SETTINGS, type Interval, type Identity } from './surface';

export interface AirSettings {
 readonly spacingSu:number; readonly maxCandidates:number; readonly maxTicks:number;
 readonly maxReplayTicks:number; readonly maxClearanceSamples:number;
}
export type AirOptions=AirSettings&Partial<PrimitiveLimits>;
export const AIR_DEFAULTS:AirSettings={spacingSu:8192,maxCandidates:20_000,maxTicks:240,maxReplayTicks:1_000_000,maxClearanceSamples:2_000_000};
export type Action='jump'|'fall'|'drop'|'dash';
export interface Witness {
 readonly key:string; readonly kind:Action; readonly status:'verified reachable with replay witness';
 readonly fromInterval:string; readonly toInterval:string; readonly initial:ClimbState; readonly terminal:ClimbState;
 readonly input:readonly RunInput[]; readonly frames:readonly Step[]; readonly costTicks:number;
 readonly dependencies:{readonly identity:Identity;readonly sweptBoundsSu:readonly [number,number,number,number];readonly sha256:string};
}
export interface AirResult {
 readonly format:'maplab.airborne-actions'; readonly version:1; readonly revision:number;
 readonly status:'candidate'|'no route found within declared search/sampling budget'|'budget'|'unsupported'|'cancelled';
 readonly canCertify:false; readonly complete:false; readonly identity:Identity; readonly settings:AirOptions;
 readonly assumptions:readonly string[]; readonly diagnostics:readonly string[];
 readonly samples:number; readonly replayTicks:number; readonly rejected:Readonly<Record<string,number>>;
 readonly intervals:readonly Interval[]; readonly edges:readonly Witness[];
}
export async function airborneIdentity(map:MapDocument,p:MovementDocument,settings:AirOptions):Promise<Identity>{
 const base=await surfaceIdentity(map,p,DEFAULT_SETTINGS);
 const settingsSha256=await digest({solver:hasDash(p)?'stateful-dash@1':airJumpCount(p)>0?'stateful-airborne@1':'single-airborne@2',surfaceSolver:base.settingsSha256,...settings,...(hasDash(p)?{...primitiveLimits(settings),primitiveSha256:DASH_PRIMITIVE_SHA256}:airJumpCount(p)>0?{...primitiveLimits(settings),primitiveSha256:AIR_PRIMITIVE_SHA256}:{})});
 const value={...base,settingsSha256};return {...value,cacheKey:await digest({worldSha256:value.worldSha256,profileSha256:value.profileSha256,controllerSha256:value.controllerSha256,settingsSha256})};
}
const stateAt=(w:World,i:Interval,x:number,vx:number):ClimbState|null=>{
 const pose=resolveStance(w,x,i.supportId).find(s=>s.face.supportId===i.supportId);if(!pose)return null;
 return {x,y:pose.y,vx,vy:0,mode:'ground',supportId:i.supportId,planeId:w.source.footholds.find(f=>f.id===i.supportId)?.planeId??w.defaultPlane,facing:vx<0?-1:1,tick:0,jumpHeldPrev:false,jumpReleased:false,ticksSinceJump:0,dropSuppression:null,resources:{airJumps:airJumpCount(w.profile),dashCharges:0,cooldowns:{}},traversalId:null,climbReady:true};
};
/** Physical identity includes empty space and all sources, so insertion/deletion anywhere
 * invalidates these witnesses. Swept bounds additionally identify the local dependency area.
 * Launch velocities are explicit preconditions, never a claim of reachable run-up/reset. */
export async function buildAirborneActions(source:MapDocument,profile:MovementDocument,revision:number,settings:AirOptions=AIR_DEFAULTS,cancelled:()=>boolean=()=>false,yieldTask:()=>Promise<void>=()=>new Promise(r=>setTimeout(r,0)),launchRegionSu?:readonly[number,number,number,number]):Promise<AirResult>{
 const limits={spacingSu:1_000_000,maxCandidates:100_000,maxTicks:3600,maxReplayTicks:2_000_000,maxClearanceSamples:2_000_000};
 for(const k of Object.keys(limits) as (keyof typeof limits)[])if(!Number.isSafeInteger(settings[k])||settings[k]<1||settings[k]>limits[k])throw Error('invalid airborne settings');
 primitiveLimits(settings);
 if(!Number.isSafeInteger(revision)||revision<0)throw Error('invalid airborne revision');
 const map=structuredClone(source),p=structuredClone(profile),options={...settings},id=await airborneIdentity(map,p,options);
 let samples=0,replayTicks=0;const rejected:Record<string,number>={};
 const reject=(why:string)=>{rejected[why]=(rejected[why]??0)+1;};
 const assumptions=['Static initial transforms; no runtime blockers or conditions.','Single ground jump, edge fall or selected-group drop only; no multi-jump, moving-platform, route or completeness claim.','Exact launch velocity/resources are preconditions; landing states are not interchangeable with surface anchors.','No route means only no witness in the declared deterministic sampling budget; physical edits require a full rebuild.'];
 const result=(status:AirResult['status'],diagnostics:readonly string[],intervals:readonly Interval[]=[],edges:readonly Witness[]=[]):AirResult=>({format:'maplab.airborne-actions',version:1,revision,status,canCertify:false,complete:false,identity:id,settings:options,assumptions,diagnostics,samples,replayTicks,rejected,intervals,edges});
 if(cancelled())return result('cancelled',['cancelled']);
 // Keep applicable intent explicit; unrelated flyer volumes cannot disable ground patrols.
 if(!supportedJumpProfile(p)||!groundIntentSupported(map,p))return result('unsupported',['unsupported capability or navigation intent']);
 let w:World;try{w=createWorld(map as unknown as ContactMap,p);}catch(e){return result('unsupported',[String(e)]);}
 const surface=await buildSurfaceGraph(map,p,revision,{maxSamples:options.maxClearanceSamples,maxTicks:3600},cancelled,yieldTask);
 if(surface.status!=='candidate')return result(surface.status,surface.diagnostics);
 if(hasDash(p))return buildDashActions(map,p,w,revision,options,id,surface.intervals,cancelled,yieldTask,launchRegionSu);
 if(airJumpCount(p)>0)return buildAirJumpActions(map,p,w,revision,options,id,surface.intervals,cancelled,yieldTask,launchRegionSu);
 const intervals=surface.intervals,edges:Witness[]=[];
 const jump=p.abilities.find(a=>a.kind==='jump');
 const holds=jump?[...new Set([0,Math.floor(jump.holdTicks/2),jump.holdTicks])].sort((a,b)=>a-b):[];
 const speeds=[...new Set([0,p.ground.walkSpeed,p.ground.runSpeed,Math.floor(p.ground.runSpeed/2),-p.ground.walkSpeed,-p.ground.runSpeed,-Math.floor(p.ground.runSpeed/2)])].sort((a,b)=>a-b);
 const safe=(s:ClimbState)=>s.x-w.half>=map.bounds[0]*256&&s.x+w.half<=(map.bounds[0]+map.bounds[2])*256&&s.y-w.height>=map.bounds[1]*256&&s.y<=(map.bounds[1]+map.bounds[3])*256&&!overlaps(w,s.x,s.y);
 const locate=(s:ClimbState)=>intervals.find(i=>i.supportId===s.supportId&&s.x>=i.minX&&s.x<=i.maxX);
 const allowed=(i:Interval,v:number)=>v===0||i.direction==='both'||(v>0?i.direction==='aToB':i.direction==='bToA');
 const checkpoint=async()=>{if(replayTicks%256===0)await yieldTask();if(cancelled())throw Error('cancelled');};
 try{
 for(const i of intervals){
  const positions=new Set([i.minX,i.maxX,Math.floor((i.minX+i.maxX)/2)]);
  for(let x=Math.ceil(i.minX/options.spacingSu)*options.spacingSu;x<=i.maxX;x+=options.spacingSu)positions.add(x);
  // Target and obstacle critical X positions supplement the declared lattice, including narrow gaps.
  for(const x of [...intervals.flatMap(t=>[t.minX,t.maxX]),...w.faces.flatMap(f=>[f.a[0]-w.half,f.a[0]+w.half,f.b[0]-w.half,f.b[0]+w.half])])for(const refined of [x-Math.floor(options.spacingSu/2),x,x+Math.floor(options.spacingSu/2)])if(refined>=i.minX&&refined<=i.maxX)positions.add(refined);
  for(const x of [...positions].sort((a,b)=>a-b))for(const vx of speeds){
   if(launchRegionSu&&(x<launchRegionSu[0]||x>launchRegionSu[2]))continue;
   if(!allowed(i,vx))continue;
   const initial=stateAt(w,i,x,vx);if(!initial||!safe(initial))continue;
   // Conservative horizontal capability envelope, including ground conveyor run-out.
   const baseSpeed=BigInt(Math.max(p.ground.walkSpeed,p.ground.runSpeed));
   const scaled=[p.ground.uphill,p.ground.downhill].map(r=>(baseSpeed*BigInt(r.num)+BigInt(r.den)-1n)/BigInt(r.den));
   const speed=[baseSpeed,BigInt(p.air.maxSpeed),BigInt(Math.abs(vx)),...scaled].reduce((a,b)=>a>b?a:b)+BigInt(Math.max(0,...map.materials.map(m=>Math.abs(m.conveyorSu))));
   const travel=speed*BigInt(options.maxTicks);
   if(!intervals.some(t=>t.supportId!==i.supportId&&BigInt(t.minX)<=BigInt(x)+travel&&BigInt(t.maxX)>=BigInt(x)-travel)){reject('outside-capability-envelope');continue;}
   const kinds:Action[]=['fall'];if(jump)kinds.push('jump');
   const fh=map.footholds.find(f=>f.id===i.supportId)!;if(p.drop.canDrop&&fh.mode==='oneWay'&&fh.dropAllowed)kinds.push('drop');
   for(const kind of kinds)for(const hold of kind==='jump'?holds:[0])for(const direction of [-1,0,1] as const)for(const schedule of ['steady','coast'] as const){
    if(!allowed(i,direction))continue;
    if(kind==='fall'&&!((x===i.minX&&direction===-1&&vx<=0)||(x===i.maxX&&direction===1&&vx>=0)))continue;
    if(samples>=options.maxCandidates)throw Error('candidate-budget');samples++;
    let s=initial,air=false;const frames:Step[]=[],input:RunInput[]=[];
    let minX=s.x-w.half,maxX=s.x+w.half,minY=s.y-w.height,maxY=s.y;
    for(let tick=0;tick<options.maxTicks;tick++){
     if(replayTicks>=options.maxReplayTicks)throw Error('replay-budget');await checkpoint();replayTicks++;
     const command:RunInput={fromTick:tick,moveX:schedule==='coast'&&air?0:direction,moveY:0,run:true,jump:kind==='jump'&&tick<=hold,drop:kind==='drop'&&tick===0};
     const previous=input.at(-1);if(!previous||previous.moveX!==command.moveX||previous.jump!==command.jump||previous.drop!==command.drop)input.push(command);
     const {fromTick:_,...controls}=command;
     const f=step(w,s,controls),next=f.state as ClimbState;frames.push(f);
     if(f.status==='unsupported')return result('unsupported',[f.reason??'unsupported controller action']);
     if(f.status==='contactBudget')return result('budget',['contactBudget']);
     if(f.status!=='ok'){reject(f.status);break;}
     minX=Math.min(minX,next.x-w.half);maxX=Math.max(maxX,next.x+w.half);minY=Math.min(minY,next.y-w.height);maxY=Math.max(maxY,next.y);
     if(!safe(next)){reject('body-clearance-or-bounds');break;}
     if(!groundMotionAllowed(map,p,kind,s,next)){reject('authored-forbid-region');break;}
     if(f.contacts.some(c=>c.kind==='blocking'&&!(kind==='fall'&&c.axis==='y'&&c.normal[1]<0&&c.supportId===initial.supportId&&next.y===initial.y))){reject('wall-or-ceiling');break;}
     if(next.mode==='climb'){reject('unsupported-mode-transition');break;}
     // A coast schedule stopped over a partial launch floor cannot finish an edge fall.
     if(kind==='fall'&&next.x===s.x&&next.y===s.y&&next.vx===0){reject('no-departure');break;}
     if(next.mode==='air')air=true;
     if(next.mode==='ground'){
      if(kind==='fall'&&!air&&next.supportId!==initial.supportId){reject('connected-ground-transition');break;}
      const here=locate(next);
      if(!here||!allowed(here,next.vx)||!allowed(here,command.moveX)){reject('inaccessible-support');break;}
      if(air){
       if(here.supportId===i.supportId){reject('first-landing-on-launch-support');break;}
       const sweptBoundsSu=[minX,minY,maxX,maxY] as const;
       const dependencies={identity:id,sweptBoundsSu,sha256:await digest({identity:id,sweptBoundsSu,initial,input,frames})};
       edges.push({key:await digest({initial,input,to:here.key,kind}),kind,status:'verified reachable with replay witness',fromInterval:i.key,toInterval:here.key,initial,terminal:next,input,frames,costTicks:frames.length,dependencies});break;
      }
      if(kind!=='fall'){reject('action-refused');break;}
      if(here.key!==i.key){reject('ground-transfer-before-fall');break;}
      if(next.x===s.x){reject('no-departure');break;}
     }
     s=next;
     if(tick+1===options.maxTicks)throw Error('action-tick-budget');
    }
   }
  }
 }
 // Deterministic de-duplication preserves a single exact input witness per action key.
 const unique=[...new Map(edges.map(e=>[e.key,e])).values()].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 if(cancelled())return result('cancelled',['cancelled']);
 return result(unique.length?'candidate':'no route found within declared search/sampling budget',jump?[]:['no jump ability'],intervals,unique);
 }catch(e){if(e instanceof Error&&(e.message==='cancelled'||e.message.endsWith('-budget')))return result(e.message==='cancelled'?'cancelled':'budget',[e.message]);throw e;}
}
