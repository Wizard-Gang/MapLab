import type {MapDocument,MovementDocument} from '../contracts';
import {digest} from '../physics-reference';
import {own} from '../flight/controller';
import {flightIdentity,FLIGHT_DEFAULTS} from '../flight/planner';
import {augmentedSearch,type Move} from '../navigation/search';
import {GrappleWorld,GRAPPLE_SOLVER,coast,type GrappleState,type GrappleInput,type GrappleFrame} from './controller';
import {GRAPPLE_MOTOR_SHA256,GRAPPLE_GEOMETRY_SHA256,GRAPPLE_PLANNER_SHA256} from './identity';
export interface GrappleSettings {readonly maxExpanded:number;readonly maxSamples:number;readonly maxReplayTicks:number;readonly maxRouteTicks:number;readonly actionTicks:number}
export const GRAPPLE_DEFAULTS:GrappleSettings={maxExpanded:4096,maxSamples:50000,maxReplayTicks:200000,maxRouteTicks:120,actionTicks:4};
export interface GrappleQuery {readonly initial:GrappleState;readonly goal:Readonly<{x:number;y:number;toleranceSu:number;mode:'attached'|'free'}>}
export interface GrappleIdentity {readonly key:'maplab.reference-grapple';readonly version:1;readonly worldSha256:string;readonly profileSha256:string;readonly controllerSha256:string;readonly settingsSha256:string;readonly cacheKey:string}
export type GrappleStatus='verified reachable with replay witness'|'no route found within declared search/sampling budget'|'budget'|'unsupported'|'cancelled';
export interface GrappleProof {readonly format:'maplab.grapple-proof';readonly version:1;readonly revision:number;readonly solver:typeof GRAPPLE_SOLVER;readonly identity:GrappleIdentity;readonly querySha256:string;readonly settings:GrappleSettings;readonly initial:GrappleState;readonly terminal:GrappleState|null;readonly frames:readonly GrappleFrame[];readonly status:GrappleStatus;readonly canCertify:false;readonly complete:false;readonly costTicks:number;readonly expanded:number;readonly samples:number;readonly replayTicks:number;readonly assumptions:readonly string[];readonly diagnostics:readonly string[]}
export async function grappleIdentity(map:MapDocument,p:MovementDocument,o:GrappleSettings):Promise<GrappleIdentity>{
 const base=await flightIdentity(map,p,FLIGHT_DEFAULTS),id={...GRAPPLE_SOLVER,worldSha256:base.worldSha256,profileSha256:base.profileSha256,controllerSha256:await digest({base:base.controllerSha256,motor:GRAPPLE_MOTOR_SHA256,geometry:GRAPPLE_GEOMETRY_SHA256}),settingsSha256:await digest({planner:GRAPPLE_PLANNER_SHA256,settings:o,semantics:'integer-straight-rope-project@1'})};return {...id,cacheKey:await digest(id)};
}
export const grappleStateKey=(s:GrappleState)=>JSON.stringify([s.x,s.y,s.vx,s.vy,s.attachment?[s.attachment.anchorId,s.attachment.pointIndex,s.attachment.length]:null]);
interface Edge extends Move<GrappleState> {readonly frames:readonly GrappleFrame[]}
class Stop extends Error {constructor(readonly status:GrappleStatus,message:string){super(message);}}
/** Uniform-cost search of exact body/velocity/anchor/rope-length states. Sampled
 * controls are finite; failed search establishes no arbitrary-rope completeness. */
export async function planGrapple(source:MapDocument,profile:MovementDocument,query:GrappleQuery,revision=0,settings:GrappleSettings=GRAPPLE_DEFAULTS,cancelled:()=>boolean=()=>false,yieldTask:()=>Promise<void>=()=>new Promise(r=>setTimeout(r,0))):Promise<GrappleProof>{
 const map=own(source),p=own(profile),q=own(query),o=own(settings);
 if(!Number.isSafeInteger(revision)||revision<0||Object.keys(o).sort().join(',')!==Object.keys(GRAPPLE_DEFAULTS).sort().join(',')||Object.values(o).some(v=>!Number.isSafeInteger(v)||v<1)||o.maxExpanded>20000||o.maxSamples>200000||o.maxReplayTicks>1000000||o.maxRouteTicks>3600||o.actionTicks>32)throw Error('Invalid grapple settings');
 const identity=await grappleIdentity(map,p,o),querySha256=await digest(q);let expanded=0,samples=0,replayTicks=0,horizon=false;
 const assumptions=['Named maplab.reference-grapple@1, fixed 60 Hz integer straight rope; no wrapping, elasticity, fluid or arbitrary rope physics completeness.','Static rectangular colliders, full rectangular actor, reciprocal masks; enabled one-way faces and other movement abilities are unsupported.','Reel changes length before projection; choose the inner axis corner, preferring X then Y, with full-body and rope-triangle sweeps. Exact runtime attachment/length/velocity join every action.','Static initial world only; no runtime blockers, conditions, sensors, modifiers or engine AI. Bounded discrete input samples; no global unreachable claim.'];
 const result=(status:GrappleStatus,diagnostics:string[],frames:readonly GrappleFrame[]=[]):GrappleProof=>own({format:'maplab.grapple-proof',version:1,revision,solver:GRAPPLE_SOLVER,identity,querySha256,settings:o,initial:q.initial,terminal:status==='verified reachable with replay witness'?(frames.at(-1)?.state??q.initial):null,frames,status,canCertify:false,complete:false,costTicks:frames.length,expanded,samples,replayTicks,assumptions,diagnostics});
 const check=()=>{if(cancelled())throw new Stop('cancelled','Cancelled grapple search');if(replayTicks>=o.maxReplayTicks)throw new Stop('budget','Grapple replay-work budget');};
 try{
  check();const world=new GrappleWorld(map,p),g=q.goal;
  if(Object.keys(q).sort().join(',')!=='goal,initial'||!g||Object.keys(g).sort().join(',')!=='mode,toleranceSu,x,y'||![g.x,g.y,g.toleranceSu].every(Number.isSafeInteger)||g.toleranceSu<0||g.toleranceSu>256||!['attached','free'].includes(g.mode)||!world.valid(q.initial)||!world.safe(g.x,g.y)||!Number.isSafeInteger(q.initial.tick+o.maxRouteTicks)||q.initial.tick+o.maxRouteTicks>=Number.MAX_SAFE_INTEGER-1)throw new Stop('unsupported','Invalid grapple query or full-body goal');
  const goal=(s:GrappleState)=>Math.abs(s.x-g.x)<=g.toleranceSu&&Math.abs(s.y-g.y)<=g.toleranceSu&&(g.mode==='attached')===(s.attachment!==null);
  const tick=(s:GrappleState,u:GrappleInput)=>{check();replayTicks++;return world.step(s,u);};
  const found=await augmentedSearch<GrappleState,Edge>(q.initial,grappleStateKey,goal,async state=>{
   expanded++;if(expanded%8===0){await yieldTask();check();}
   const controls:GrappleInput[]=state.attachment?[{...coast(),action:'release'}]:world.anchors.map(a=>({...coast(),action:'attach',anchorId:a.id,pointIndex:a.pointIndex}));
   for(const moveX of [-1,0,1] as const)for(const reel of state.attachment?[-1,0,1] as const:[0] as const)controls.push(coast(moveX,reel));
   const out:Edge[]=[];
   for(const u of controls){if(samples>=o.maxSamples)throw new Stop('budget','Grapple input-sample budget');samples++;let s=state;const frames:GrappleFrame[]=[];
    for(let n=0;n<(u.action==='coast'?o.actionTicks:1);n++){
     if(s.tick-q.initial.tick>=o.maxRouteTicks){horizon=true;break;}const f=tick(s,u);if(f.status!=='ok')break;frames.push(f);s=f.state;
     out.push({key:JSON.stringify([u,n+1]),to:s,cost:frames.length,frames:[...frames]});if(goal(s))break;
    }
   }return out;
  },()=>0,o.maxExpanded,cancelled);
  expanded=found.expanded;
  if(found.status!=='candidate')return result(found.status==='no route'?(horizon?'budget':'no route found within declared search/sampling budget'):found.status,['Bounded grapple search '+found.status+'; this is not proof of physical unreachability.']);
  const frames=found.path.flatMap(e=>e.frames);let s=q.initial;
  for(const f of frames){const actual=tick(s,f.input);if(JSON.stringify(actual)!==JSON.stringify(f))throw new Stop('unsupported','Whole-route grapple replay disagreed');s=actual.state;}
  if(!goal(s))throw new Stop('unsupported','Grapple terminal state does not satisfy goal');return result('verified reachable with replay witness',[],frames);
 }catch(e){return e instanceof Stop?result(e.status,[e.message]):result('unsupported',[String(e)]);}
}
