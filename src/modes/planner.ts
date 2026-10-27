import type {MapDocument,MovementDocument} from '../contracts';
import {digest} from '../physics-reference';
import {augmentedSearch,type Move} from '../navigation/search';
import {flightIdentity,FLIGHT_DEFAULTS} from '../flight/planner';
import {own} from '../flight/controller';
import {ModeWorld,type ModeState,type ModeFrame,type ModeControl} from './controller';
import {MODE_MOTOR_SHA256,MODE_SOLVER_SHA256} from './identity';
export interface ModeSettings {readonly maxExpanded:number;readonly maxReplayTicks:number;readonly maxRouteTicks:number;readonly actionTicks:number;readonly maxTransitionTicks:number}
export const MODE_DEFAULTS:ModeSettings={maxExpanded:8192,maxReplayTicks:200000,maxRouteTicks:600,actionTicks:4,maxTransitionTicks:128};
export interface ModeQuery {readonly initial:ModeState;readonly goal:Readonly<{x:number;y:number;mode:'ground'|'swim'|'fly'}>;readonly algorithm:'astar'|'dijkstra'}
export type ModeStatus='verified reachable with replay witness'|'no route found within declared search/sampling budget'|'budget'|'unsupported'|'cancelled';
export interface ModeIdentity {readonly key:'maplab.reference-modes';readonly version:1;readonly worldSha256:string;readonly profileSha256:string;readonly controllerSha256:string;readonly settingsSha256:string;readonly cacheKey:string}
export interface ModeProof {readonly format:'maplab.mode-proof';readonly version:1;readonly revision:number;readonly identity:ModeIdentity;readonly querySha256:string;readonly settings:ModeSettings;readonly status:ModeStatus;readonly canCertify:false;readonly complete:false;readonly initial:ModeState;readonly terminal:ModeState|null;readonly frames:readonly ModeFrame[];readonly costTicks:number;readonly expanded:number;readonly replayTicks:number;readonly diagnostics:readonly string[];readonly assumptions:readonly string[]}
export async function modeIdentity(map:MapDocument,p:MovementDocument,settings:ModeSettings):Promise<ModeIdentity>{
 const base=await flightIdentity(map,p,FLIGHT_DEFAULTS);
 const identity={key:'maplab.reference-modes' as const,version:1 as const,worldSha256:base.worldSha256,profileSha256:base.profileSha256,controllerSha256:await digest({flight:base.controllerSha256,motor:MODE_MOTOR_SHA256}),settingsSha256:await digest({solver:MODE_SOLVER_SHA256,settings,semantics:'bounded-volume-velocity-state@1'})};
 return {...identity,cacheKey:await digest(identity)};
}
interface Edge extends Move<ModeState> {readonly frames:readonly ModeFrame[]}
export const modeStateKey=(s:ModeState)=>[s.x,s.y,s.vx,s.vy,s.mode,s.supportId].join(':');
/** Finite input sampling over exact velocity states, with explicit rest-state mode joins. */
export async function planModes(source:MapDocument,profile:MovementDocument,query:ModeQuery,revision=0,settings:ModeSettings=MODE_DEFAULTS,cancelled:()=>boolean=()=>false,yieldTask:()=>Promise<void>=()=>new Promise(r=>setTimeout(r,0))):Promise<ModeProof>{
 const map=own(source),p=own(profile),q=own(query),o=own(settings);
 if(!Number.isSafeInteger(revision)||revision<0||Object.keys(o).sort().join(',')!==Object.keys(MODE_DEFAULTS).sort().join(',')||Object.values(o).some(v=>!Number.isSafeInteger(v)||v<1)||o.maxExpanded>20000||o.maxReplayTicks>1000000||o.maxRouteTicks>3600||o.actionTicks>32||o.maxTransitionTicks>600||!['astar','dijkstra'].includes(q.algorithm))throw Error('Invalid mode settings');
 const identity=await modeIdentity(map,p,o),querySha256=await digest(q);let expanded=0,replayTicks=0;
 const result=(status:ModeStatus,frames:readonly ModeFrame[]=[],reason=''):ModeProof=>own({format:'maplab.mode-proof',version:1,revision,identity,querySha256,settings:o,status,canCertify:false,complete:false,initial:q.initial,terminal:frames.at(-1)?.state??(status==='verified reachable with replay witness'?q.initial:null),frames,costTicks:frames.length,expanded,replayTicks,diagnostics:reason?[reason]:[],assumptions:['Static rectangular bodies; reciprocal masks; full-body volume unions and continuous X/Y sweeps.','Swim integrates gravity minus buoyancy before bounded motor acceleration; compensation drift must fit acceleration. No fluid simulation.','Flight search retains exact position and velocity; finite cardinal/stop input schedules, no continuous completeness claim.','Mode links use core.mode.transition@1 cardinal rest-to-rest anchors. Dry domains are standing footprints, never collision exemptions. Swim shoreline transitions require neutral buoyancy; vertical water entry is unsupported.']});
 try{
  if(cancelled())return result('cancelled');const world=new ModeWorld(map,p);
  if(!world.valid(q.initial)||!['ground','swim','fly'].includes(q.goal.mode)||![q.goal.x,q.goal.y].every(Number.isSafeInteger))return result('unsupported',[],'Invalid mode initial state/goal');
  const end={...q.initial,...q.goal,vx:0,vy:0,supportId:q.goal.mode==='ground'?world.ground(q.goal.x,q.goal.y):null};
  if(!world.valid(end))return result('no route found within declared search/sampling budget',[],'Goal body outside its mode domain or blocked');
  const goal=(s:ModeState)=>s.x===q.goal.x&&s.y===q.goal.y&&s.mode===q.goal.mode&&s.vx===0&&s.vy===0;
  const spend=(n:number)=>{replayTicks+=n;if(replayTicks>o.maxReplayTicks)throw Error('budget');if(cancelled())throw Error('cancelled');};
  // Exact rest connectors refine terminal/anchor poses without filling the search
  // with every one-tick sub-speed permutation. Braking is real displacement.
  const connector=(start:ModeState,target:{x:number;y:number},order:readonly ('x'|'y')[]):readonly ModeFrame[]|null=>{
   if(start.mode!=='swim'&&start.mode!=='fly')return null;
   const m=world.motors.get(start.mode)!,swim=p.abilities.find(a=>a.kind==='swim');
   if(start.mode==='swim'&&swim?.kind==='swim'&&swim.buoyancy!==p.air.gravity)return null;
   let state=start;const frames:ModeFrame[]=[];
   const tick=(u:ModeControl)=>{if(state.tick-q.initial.tick>=o.maxRouteTicks)return false;spend(1);const next=world.step(state,u);if(!next)return false;frames.push({state:next,input:u,action:null});state=next;return true;};
   while(state.vx||state.vy)if(!tick({targetVx:0,targetVy:0}))return null;
   for(const axis of order){
    while(state[axis]!==target[axis]||state.vx||state.vy){
     const delta=target[axis]-state[axis],remaining=Math.abs(delta),sign=Math.sign(delta),stop=(v:number)=>{const k=Math.max(0,Math.floor((v-1)/m.acceleration));return k*v-m.acceleration*k*(k+1)/2;};
     let lo=0,hi=Math.min(m.speed,remaining);while(lo<hi){const v=Math.ceil((lo+hi)/2);if(v+stop(v)<=remaining)lo=v;else hi=v-1;}
     if(!tick({targetVx:axis==='x'?(sign*lo||0):0,targetVy:axis==='y'?(sign*lo||0):0})||(target[axis]-state[axis])*sign<0)return null;
    }
   }return frames;
  };
  const edges=async(s:ModeState):Promise<Edge[]>=>{
   expanded++;if(expanded%16===0){await yieldTask();if(cancelled())throw Error('cancelled');}
   const out:Edge[]=[],push=(frames:readonly ModeFrame[],key:string)=>{const to=frames.at(-1)?.state;if(to&&world.valid(to)&&to.tick-q.initial.tick<=o.maxRouteTicks)out.push({key,to,cost:frames.length,frames});};
   for(const t of world.transitions){
    if(t.from!==s.mode||s.x!==t.a[0]||s.y!==t.a[1]||s.vx||s.vy)continue;
    spend(o.maxTransitionTicks);const frames=world.transition(s,t,Math.min(o.maxTransitionTicks,o.maxRouteTicks-(s.tick-q.initial.tick)));if(frames)push(frames,'transition:'+t.id);
   }
   if(s.mode!=='swim'&&s.mode!=='fly')return out;
   const motor=world.motors.get(s.mode)!,speed=motor.speed;
   const controls:ModeControl[]=[{targetVx:0,targetVy:0},{targetVx:-speed,targetVy:0},{targetVx:speed,targetVy:0},{targetVx:0,targetVy:-speed},{targetVx:0,targetVy:speed}];
   // Refine around the goal and authored transition anchors, including sub-speed commands.
   const targets=[q.goal,...world.transitions.filter(t=>t.from===s.mode).map(t=>({x:t.a[0],y:t.a[1]}))];
   const connectors=[...(q.goal.mode===s.mode?[q.goal]:[]),...world.transitions.filter(t=>t.from===s.mode).map(t=>({x:t.a[0],y:t.a[1]}))];
   for(const t of connectors)for(const order of [['x','y'],['y','x']] as const){const frames=connector(s,t,order);if(frames?.length)push(frames,'connector:'+t.x+':'+t.y+':'+order.join(''));}
   for(const t of targets){const dx=t.x-s.x,dy=t.y-s.y;for(const [x,y] of [[dx,0],[0,dy]])if(Math.abs(x!)+Math.abs(y!)<=speed)controls.push({targetVx:x!||0,targetVy:y!||0});}
   const seen=new Set<string>();
   for(const u of controls){const k=JSON.stringify(u);if(seen.has(k))continue;seen.add(k);let state=s;const frames:ModeFrame[]=[];
    for(let n=0;n<o.actionTicks&&state.tick-q.initial.tick<o.maxRouteTicks;n++){
     spend(1);const next=world.step(state,u);if(!next)break;frames.push({state:next,input:u,action:null});state=next;
     if(n===o.actionTicks-1||goal(state)||world.transitions.some(t=>t.from===state.mode&&t.a[0]===state.x&&t.a[1]===state.y&&!state.vx&&!state.vy))push([...frames],'control:'+k+':'+n);
    }
   }
   return out;
  };
  const maxSpeed=Math.max(...[...world.motors.values()].map(m=>m.speed));
  // Every tick, including transitions, moves at most maxSpeed in L1 distance.
  const found=await augmentedSearch<ModeState,Edge>(q.initial,modeStateKey,goal,edges,s=>q.algorithm==='dijkstra'?0:Math.ceil((Math.abs(s.x-q.goal.x)+Math.abs(s.y-q.goal.y))/maxSpeed),o.maxExpanded,cancelled);
  if(found.status!=='candidate')return result(found.status==='no route'?'no route found within declared search/sampling budget':found.status,[],'Finite mode search '+found.status);
  const frames=found.path.flatMap(e=>e.frames);return result('verified reachable with replay witness',frames);
 }catch(e){const reason=e instanceof Error?e.message:String(e);return result(reason==='budget'?'budget':reason==='cancelled'?'cancelled':'unsupported',[],reason);}
}
