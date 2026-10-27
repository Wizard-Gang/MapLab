import type {MapDocument,MovementDocument} from '../contracts';
import {digest} from '../physics-reference';
import {own} from '../flight/controller';
import {flightIdentity,FLIGHT_DEFAULTS} from '../flight/planner';
import {augmentedSearch,type Move} from '../navigation/search';
import {ActionWorld,ACTION_SOLVER,coast,type ActionState,type ActionInput,type ActionFrame} from './controller';
import {effectiveProfileHash,keys} from './modifiers';
import {ACTION_MOTOR_SHA256,ACTION_MODIFIERS_SHA256,ACTION_PLANNER_SHA256} from './identity';
import {GRAPPLE_GEOMETRY_SHA256} from '../grapple/identity';
export interface ActionSettings {readonly maxExpanded:number;readonly maxSamples:number;readonly maxReplayTicks:number;readonly maxRouteTicks:number}
export const ACTION_DEFAULTS:ActionSettings={maxExpanded:4096,maxSamples:40000,maxReplayTicks:50000,maxRouteTicks:120};
export interface ActionQuery {readonly initial:ActionState;readonly goal:Readonly<{x:number;y:number;toleranceSu:number;mode:'ground'|'air';rest:boolean}>;readonly actions:readonly ActionInput[];readonly algorithm:'astar'|'dijkstra'}
export interface ActionIdentity {readonly key:'maplab.reference-actions';readonly version:1;readonly worldSha256:string;readonly profileSha256:string;readonly stateSha256:string;readonly controllerSha256:string;readonly settingsSha256:string;readonly cacheKey:string}
export type ActionStatus='verified reachable with replay witness'|'no route found within declared search/sampling budget'|'budget'|'unsupported'|'cancelled';
export interface ActionProof {readonly format:'maplab.action-proof';readonly version:1;readonly revision:number;readonly solver:typeof ACTION_SOLVER;readonly identity:ActionIdentity;readonly querySha256:string;readonly settings:ActionSettings;readonly initial:ActionState;readonly terminal:ActionState|null;readonly frames:readonly ActionFrame[];readonly effectiveProfileHashes:readonly string[];readonly status:ActionStatus;readonly canCertify:false;readonly complete:false;readonly heuristic:'zero';readonly costTicks:number;readonly expanded:number;readonly samples:number;readonly replayTicks:number;readonly assumptions:readonly string[];readonly diagnostics:readonly string[]}
export async function actionIdentity(map:MapDocument,p:MovementDocument,state:ActionState,settings:ActionSettings):Promise<ActionIdentity>{
 const base=await flightIdentity(map,p,FLIGHT_DEFAULTS),id={...ACTION_SOLVER,worldSha256:base.worldSha256,profileSha256:base.profileSha256,stateSha256:await digest(state),controllerSha256:await digest({base:base.controllerSha256,motor:ACTION_MOTOR_SHA256,modifiers:ACTION_MODIFIERS_SHA256,visibility:GRAPPLE_GEOMETRY_SHA256}),settingsSha256:await digest({planner:ACTION_PLANNER_SHA256,settings,semantics:'teleport-launch-multiply-once-clamp@1'})};return {...id,cacheKey:await digest(id)};
}
/** The complete clock/resource state is retained: equal poses with different
 * expiry, cooldown, recovery or remaining horizon must never dominate each other. */
export const actionStateKey=(s:ActionState)=>JSON.stringify(s);
interface Edge extends Move<ActionState> {readonly frame:ActionFrame}
class Stop extends Error {constructor(readonly status:ActionStatus,message:string){super(message);}}
export async function planActions(source:MapDocument,profile:MovementDocument,query:ActionQuery,revision=0,settings:ActionSettings=ACTION_DEFAULTS,cancelled:()=>boolean=()=>false,yieldTask:()=>Promise<void>=()=>new Promise(r=>setTimeout(r,0))):Promise<ActionProof>{
 const map=own(source),p=own(profile),q=own(query),o=own(settings);
 if(!Number.isSafeInteger(revision)||revision<0||keys(o)!==keys(ACTION_DEFAULTS)||Object.values(o).some(v=>!Number.isSafeInteger(v)||v<1)||o.maxExpanded>20000||o.maxSamples>200000||o.maxReplayTicks>1000000||o.maxRouteTicks>600)throw Error('Invalid action settings');
 const identity=await actionIdentity(map,p,q.initial,o),querySha256=await digest(q);let expanded=0,samples=0,replayTicks=0,horizon=false;
 const assumptions=['Named maplab.reference-actions@1, fixed 60 Hz integer contact motor; bounded static rectangles and full rectangular body.','Explicit sampled runtime controls; no automatic gameplay event execution, combat damage, moving bodies or general ability composition.','Teleport costs one tick, clears velocity and checks full destination body; anchor mode binds an exact world waypoint, lineOfSight mode checks torso visibility.','Launch sets/adds a bounded impulse before contact motion; recovery scales air acceleration or locks control until grounded.','Modifier application costs one stationary tick; old entries age, new entry becomes active next tick. Multiply exact rationals then truncate once and clamp each allowed coefficient to [0,8192].','All search heuristics are zero; cooldown, clock, recovery and modifiers join each transition. Failure is not a global unreachability proof.'];
 const result=(status:ActionStatus,diagnostics:string[],frames:readonly ActionFrame[]=[],hashes:readonly string[]=[]):ActionProof=>own({format:'maplab.action-proof',version:1,revision,solver:ACTION_SOLVER,identity,querySha256,settings:o,initial:q.initial,terminal:status==='verified reachable with replay witness'?(frames.at(-1)?.state??q.initial):null,frames,effectiveProfileHashes:hashes,status,canCertify:false,complete:false,heuristic:'zero',costTicks:frames.length,expanded,samples,replayTicks,assumptions,diagnostics});
 const check=()=>{if(cancelled())throw new Stop('cancelled','Cancelled action search');if(replayTicks>=o.maxReplayTicks)throw new Stop('budget','Action replay-work budget');};
 try{
  check();const world=new ActionWorld(map,p),g=q.goal;
  if(keys(q)!=='actions,algorithm,goal,initial'||!g||keys(g)!=='mode,rest,toleranceSu,x,y'||![g.x,g.y,g.toleranceSu].every(Number.isSafeInteger)||g.toleranceSu<0||g.toleranceSu>256||!['ground','air'].includes(g.mode)||typeof g.rest!=='boolean'||!['astar','dijkstra'].includes(q.algorithm)||!Array.isArray(q.actions)||q.actions.length>24||!world.valid(q.initial)||!world.safe(g.x,g.y)||!Number.isSafeInteger(q.initial.tick+o.maxRouteTicks)||q.initial.tick+o.maxRouteTicks>=Number.MAX_SAFE_INTEGER-1)throw new Stop('unsupported','Invalid action query or destination body');
  const goal=(s:ActionState)=>Math.abs(s.x-g.x)<=g.toleranceSu&&Math.abs(s.y-g.y)<=g.toleranceSu&&s.mode===g.mode&&(!g.rest||s.vx===0&&s.vy===0);
  const tick=(s:ActionState,u:ActionInput)=>{check();replayTicks++;return world.step(s,u);};
  const controls=[coast(-1),coast(),coast(1),...q.actions];
  const found=await augmentedSearch<ActionState,Edge>(q.initial,actionStateKey,goal,async state=>{
   expanded++;if(expanded%16===0){await yieldTask();check();}
   if(state.tick-q.initial.tick>=o.maxRouteTicks){horizon=true;return [];}
   const out:Edge[]=[];
   for(const u of controls){if(samples>=o.maxSamples)throw new Stop('budget','Action sample budget');samples++;const f=tick(state,u);if(f.status==='ok')out.push({key:JSON.stringify(u),to:f.state,cost:1,frame:f});}
   return out;
  },()=>0,o.maxExpanded,cancelled);expanded=found.expanded;
  if(found.status!=='candidate')return result(found.status==='no route'?(horizon?'budget':'no route found within declared search/sampling budget'):found.status,['Bounded action search '+found.status]);
  const frames=found.path.map(e=>e.frame);let s=q.initial;
  for(const f of frames){const actual=tick(s,f.input);if(JSON.stringify(actual)!==JSON.stringify(f))throw new Stop('unsupported','Whole-route action replay disagreed');s=actual.state;}
  if(!goal(s))throw new Stop('unsupported','Action terminal state misses goal');
  const hashes=await Promise.all([q.initial,...frames.map(f=>f.state)].map(s=>effectiveProfileHash(p,s.modifiers)));check();return result('verified reachable with replay witness',[],frames,hashes);
 }catch(e){return e instanceof Stop?result(e.status,[e.message]):result('unsupported',[String(e)]);}
}
