import type {MapDocument,MovementDocument} from '../contracts';
import {digest,replayBytes,type State,type Input} from '../physics-reference';
import {identity as physicalIdentity,type Identity} from '../navigation/surface';
import {augmentedSearch,type Move} from '../navigation/search';
import {validateTimedWorld,safeIntervals,WAIT,type SafeInterval} from './timing';
import {timedStep,type TimedFrame} from './replay';
import {TIMED_SOURCES} from './identity';
export interface TimedSettings {readonly maxExpanded:number;readonly maxSamples:number;readonly maxReplayTicks:number;readonly maxRouteTicks:number;readonly maxIntervalSamples:number}
export const TIMED_DEFAULTS:TimedSettings=Object.freeze({maxExpanded:4096,maxSamples:40000,maxReplayTicks:50000,maxRouteTicks:120,maxIntervalSamples:200000});
export const TIMED_CONTROLS:readonly Input[]=Object.freeze([WAIT,...([-1,1] as const).flatMap(moveX=>[{...WAIT,moveX},{...WAIT,moveX,jump:true}]),{...WAIT,jump:true}]);
export interface TimedQuery {readonly initial:State;readonly goal:{readonly supportId:string;readonly x:number;readonly toleranceSu:number;readonly rest:boolean;readonly notBeforeTick:number;readonly notAfterTick:number};readonly controls:readonly Input[];readonly algorithm:'astar'|'dijkstra'}
export type TimedStatus='verified reachable with replay witness'|'no route found within declared search/sampling budget'|'budget'|'unsupported'|'cancelled';
export interface TimedProof {
 readonly format:'maplab.timed-platform-proof';readonly version:1;readonly revision:number;readonly identity:Identity;readonly querySha256:string;readonly settings:TimedSettings;
 readonly status:TimedStatus;readonly canCertify:false;readonly complete:false;readonly heuristic:'zero';readonly initial:State;readonly terminal:State|null;
 readonly frames:readonly TimedFrame[];readonly safeIntervals:readonly SafeInterval[];readonly costTicks:number;readonly expanded:number;readonly samples:number;readonly replayTicks:number;readonly intervalSamples:number;
 readonly assumptions:readonly string[];readonly diagnostics:readonly string[];
}
/** Absolute tick is deliberately retained, including the remaining query horizon.
 * Equal positions at different phases or on different trips are different search states. */
export const timedStateKey=(s:State)=>replayBytes(s);
export async function timedIdentity(map:MapDocument,p:MovementDocument,settings:TimedSettings):Promise<Identity>{
 const base=await physicalIdentity(map,p,{maxSamples:settings.maxIntervalSamples,maxTicks:settings.maxRouteTicks});
 const value={worldSha256:base.worldSha256,profileSha256:base.profileSha256,controllerSha256:await digest({base:base.controllerSha256,timed:TIMED_SOURCES}),settingsSha256:await digest({solver:'periodic-platform-search@1',settings,standingSamples:'endpoints-and-midpoint',fullBody:true,absoluteTicks:true})};
 return {...value,cacheKey:await digest(value)};
}
interface Edge extends Move<State> {readonly frame:TimedFrame}
class Stop extends Error {constructor(readonly status:TimedStatus,message:string){super(message);}}
function own<T>(v:T):T {const out=structuredClone(v);const freeze=(o:unknown)=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}};freeze(out);return out;}
export async function planTimedPlatforms(source:MapDocument,profile:MovementDocument,query:TimedQuery,revision=0,settings:TimedSettings=TIMED_DEFAULTS,cancelled:()=>boolean=()=>false,yieldTask:()=>Promise<void>=()=>new Promise(r=>setTimeout(r,0))):Promise<TimedProof>{
 const map=own(source),p=own(profile),q=own(query),o=own(settings);
 const maxima:TimedSettings={maxExpanded:20000,maxSamples:200000,maxReplayTicks:1000000,maxRouteTicks:600,maxIntervalSamples:2000000};
 if(!Number.isSafeInteger(revision)||revision<0||Object.keys(o).sort().join()!==Object.keys(maxima).sort().join()||Object.entries(maxima).some(([key,max])=>{const v=o[key as keyof TimedSettings];return !Number.isSafeInteger(v)||v<1||v>max;}))throw Error('Invalid timed settings/revision');
 const identity=await timedIdentity(map,p,o),querySha256=await digest(q);let expanded=0,samples=0,replayTicks=0,intervalSamples=0;let intervals:SafeInterval[]=[];
 const assumptions=['Periodic linear translation only, named integer reference controller at 60 Hz and full rectangular body.','Absolute clock, support, velocity, input edges and resources join every transition; static caches certify no rendezvous.','Standing safe intervals sample support-local endpoints and midpoint at each tick. They do not authorize an unswept transition.','Bounded sampled controls and horizon; failures do not prove physical unreachability. A* and Dijkstra both use zero heuristic.','The engine must supply current phase and actor feedback before following each tick; drift requires replanning.'];
 const result=(status:TimedStatus,diagnostics:string[],frames:readonly TimedFrame[]=[]):TimedProof=>own({format:'maplab.timed-platform-proof',version:1,revision,identity,querySha256,settings:o,status,canCertify:false,complete:false,heuristic:'zero',initial:q.initial,terminal:status==='verified reachable with replay witness'?(frames.at(-1)?.frame.state??q.initial):null,frames,safeIntervals:status==='verified reachable with replay witness'?intervals:[],costTicks:frames.length,expanded,samples,replayTicks,intervalSamples,assumptions,diagnostics});
 const check=()=>{if(cancelled())throw new Stop('cancelled','Cancelled timed search');};
 try{
  check();validateTimedWorld(map,p,q.initial);const g=q.goal;
  if(!g||!map.footholds.some(f=>f.enabled&&f.id===g.supportId)||![g.x,g.toleranceSu,g.notBeforeTick,g.notAfterTick].every(Number.isSafeInteger)||g.toleranceSu<0||g.toleranceSu>256||typeof g.rest!=='boolean'||g.notBeforeTick<q.initial.tick||g.notAfterTick<g.notBeforeTick||!Number.isSafeInteger(q.initial.tick+o.maxRouteTicks)||!['astar','dijkstra'].includes(q.algorithm)||!Array.isArray(q.controls)||q.controls.length<1||q.controls.length>12)throw new Stop('unsupported','Invalid timed query/goal/control samples');
  for(const c of q.controls)if(Object.keys(c).some(k=>!['moveX','moveY','run','jump','drop'].includes(k))||![-1,0,1].includes(c.moveX)||![0,undefined].includes(c.moveY)||typeof c.run!=='boolean'||(c.jump!==undefined&&typeof c.jump!=='boolean')||(c.drop!==undefined&&typeof c.drop!=='boolean'))throw new Stop('unsupported','Invalid timed input sample');
  const safe=await safeIntervals(map,p,q.initial.tick,o.maxRouteTicks,o.maxIntervalSamples,check,yieldTask);intervals=safe.intervals;intervalSamples=safe.samples;
  const goal=(s:State)=>s.mode==='ground'&&s.supportId===g.supportId&&Math.abs(s.x-g.x)<=g.toleranceSu&&s.tick>=g.notBeforeTick&&s.tick<=g.notAfterTick&&(!g.rest||s.vx===0&&s.vy===0);
  const tick=(s:State,u:Input)=>{check();if(replayTicks>=o.maxReplayTicks)throw new Stop('budget','Timed replay-work budget');replayTicks++;return timedStep(map,p,s,u);};
  const found=await augmentedSearch<State,Edge>(q.initial,timedStateKey,goal,async s=>{
   if(++expanded%16===0){await yieldTask();check();}
   if(s.tick-q.initial.tick>=o.maxRouteTicks||s.tick>=g.notAfterTick)return [];
   const out:Edge[]=[];
   for(const u of q.controls){if(samples>=o.maxSamples)throw new Stop('budget','Timed control-sample budget');samples++;const f=tick(s,u);if(f)out.push({key:replayBytes(u),to:f.frame.state,cost:1,frame:f});}
   return out;
  },()=>0,o.maxExpanded,cancelled);expanded=found.expanded;
  if(found.status!=='candidate')return result(found.status==='no route'?'no route found within declared search/sampling budget':found.status,['Timed search '+found.status+' in the declared control lattice and horizon']);
  const frames=found.path.map(e=>e.frame);let s=q.initial;
  for(const expected of frames){const f=tick(s,expected.input);if(!f||replayBytes(f)!==replayBytes(expected))throw new Stop('unsupported','Whole timed-route replay disagreed');s=f.frame.state;}
  if(!goal(s))throw new Stop('unsupported','Timed terminal state misses the goal');check();return result('verified reachable with replay witness',[],frames);
 }catch(e){return e instanceof Stop?result(e.status,[e.message]):result(e instanceof Error&&e.message==='Safe interval sample budget'?'budget':'unsupported',[String(e)]);}
}
