import type {MapDocument,MovementDocument,Anchor} from '../contracts';
import {digest} from '../physics-reference';import {CONTROLLER_SHA256} from '../navigation/identity';
import {augmentedSearch,type Move} from '../navigation/search';
import {FlightWorld,own,type FlightState,type FlightInput} from './controller';
import {FLIGHT_MOTOR_SHA256,FLIGHT_SOLVER_SHA256} from './identity';
export interface FlightSettings {readonly gridSu:number;readonly maxNodes:number;readonly maxExpanded:number;readonly maxEdgeTicks:number;readonly maxReplayTicks:number;readonly maxRouteTicks:number}
export const FLIGHT_DEFAULTS:FlightSettings={gridSu:4096,maxNodes:4096,maxExpanded:4096,maxEdgeTicks:512,maxReplayTicks:250000,maxRouteTicks:3600};
export type FlightQuery={readonly kind:'patrol';readonly entityId:string;readonly algorithm:'astar'|'dijkstra'}|{readonly kind:'route';readonly initial:FlightState;readonly goal:readonly [number,number];readonly algorithm:'astar'|'dijkstra'};
export type FlightStatus='verified reachable with replay witness'|'no route found within declared search/sampling budget'|'budget'|'unsupported'|'cancelled';
export interface FlightIdentity {readonly worldSha256:string;readonly profileSha256:string;readonly controllerSha256:string;readonly settingsSha256:string;readonly cacheKey:string;readonly key:'maplab.reference-flight';readonly version:1}
export interface FlightRun extends FlightInput {readonly fromTick:number}
export interface FlightLeg {readonly target:readonly [number,number];readonly waitTicks:number;readonly startTick:number;readonly endTick:number}
export interface FlightProof {
 readonly format:'maplab.flight-proof';readonly version:1;readonly revision:number;readonly status:FlightStatus;readonly canCertify:false;readonly complete:false;
 readonly representation:'flight free-space rect-union lattice';readonly identity:FlightIdentity;readonly querySha256:string;readonly settings:FlightSettings;
 readonly algorithm:'astar'|'dijkstra';readonly assumptions:readonly string[];readonly diagnostics:readonly string[];readonly initial:FlightState|null;readonly terminal:FlightState|null;
 readonly input:readonly FlightRun[];readonly frames:readonly FlightState[];readonly legs:readonly FlightLeg[];readonly durationTicks:number;readonly costTicks:number;readonly expanded:number;readonly replayTicks:number;
 readonly fallback:Readonly<{kind:string;definition:unknown;status:'configured, not executed'}>|null;
 readonly dependencies:Readonly<{sweptBoundsSu:readonly [number,number,number,number]|null;sha256:string}>;
}
const sorted=<T extends {id:string}>(a:readonly T[])=>[...a].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
export async function flightIdentity(map:MapDocument,profile:MovementDocument,settings:FlightSettings):Promise<FlightIdentity>{
 const entities=sorted(map.entities).map(e=>({id:e.id,enabled:e.enabled,anchor:e.anchor,...('movementId'in e?{movementId:e.movementId}:{}),...('ai'in e?{ai:e.ai}:{})}));
 const worldSha256=await digest({id:map.id,bounds:map.bounds,collisionContract:map.collisionContract,bodies:sorted(map.bodies),footholds:sorted(map.footholds),materials:sorted(map.materials),traversals:sorted(map.traversals),regions:sorted(map.regions),navigation:{...map.navigation,modeVolumes:sorted(map.navigation.modeVolumes)},environment:map.environment.zones.filter(z=>z.kind==='movementModifier'||z.kind==='launch'),entities,waypoints:sorted(map.waypoints),routes:sorted(map.routes)}),profileSha256=await digest(profile),controllerSha256=await digest({collision:CONTROLLER_SHA256,flight:FLIGHT_MOTOR_SHA256}),settingsSha256=await digest({solver:'rect-union-rest-lattice@1',implementationSha256:FLIGHT_SOLVER_SHA256,settings});
 const id={key:'maplab.reference-flight' as const,version:1 as const,worldSha256,profileSha256,controllerSha256,settingsSha256};return {...id,cacheKey:await digest(id)};
}
export function flightAnchor(map:MapDocument,anchor:Anchor,seen:readonly string[]=[]):readonly [number,number]{
 if(seen.length>16)throw Error('Flight anchor budget/cycle');let x:number,y:number;
 if(anchor.kind==='world'){[x,y]=anchor.point;}
 else if(anchor.kind==='body'){const b=map.bodies.find(b=>b.id===anchor.bodyId&&b.enabled);if(!b||b.mobility!=='static'||b.motion)throw Error('Unsupported flight body anchor');x=b.position[0]+anchor.point[0];y=b.position[1]+anchor.point[1];}
 else if(anchor.kind==='entity'){if(seen.includes(anchor.entityId))throw Error('Flight anchor cycle');const e=map.entities.find(e=>e.id===anchor.entityId&&e.enabled);if(!e)throw Error('Missing flight entity anchor');const p=flightAnchor(map,e.anchor,[...seen,anchor.entityId]);return [p[0]+anchor.point[0]*256,p[1]+anchor.point[1]*256];}
 else{const f=map.footholds.find(f=>f.id===anchor.footholdId&&f.enabled),b=f?.ownerBodyId?map.bodies.find(b=>b.id===f.ownerBodyId&&b.enabled):null;if(!f||anchor.normalOffset!==0||f.ownerBodyId&&(!b||b.mobility!=='static'||b.motion))throw Error('Unsupported flight surface anchor');x=f.a[0]+(f.b[0]-f.a[0])*anchor.u+(b?.position[0]??0);y=f.a[1]+(f.b[1]-f.a[1])*anchor.u+(b?.position[1]??0);}
 const q=(v:number)=>Math.sign(v)*Math.floor(Math.abs(v)*256+.5);return [q(x),q(y)];
}
interface Motion {readonly frames:readonly FlightState[];readonly input:readonly FlightInput[]}
interface Node {readonly i:number;readonly j:number}
interface Edge extends Move<Node> {readonly motion:Motion}
class Refusal extends Error {constructor(readonly status:FlightStatus,reason:string){super(reason);}}
/** Bounded rest-to-rest cardinal lattice search, replayed through the separate finite-body motor. */
export async function planFlight(source:MapDocument,profile:MovementDocument,query:FlightQuery,revision=0,settings:FlightSettings=FLIGHT_DEFAULTS,cancelled:()=>boolean=()=>false,yieldTask:()=>Promise<void>=()=>new Promise(r=>setTimeout(r,0))):Promise<FlightProof>{
 const map=own(source),p=own(profile),q=own(query),options=own(settings);
 if(!Number.isSafeInteger(revision)||revision<0||Object.keys(options).sort().join(',')!==Object.keys(FLIGHT_DEFAULTS).sort().join(',')||Object.values(options).some(n=>!Number.isSafeInteger(n)||n<1)||options.gridSu<16||options.gridSu>65536||options.maxNodes>8192||options.maxExpanded>8192||options.maxEdgeTicks>3600||options.maxReplayTicks>1000000||options.maxRouteTicks>3600||!['astar','dijkstra'].includes(q.algorithm))throw Error('Invalid flight settings/query/revision');
 const identity=await flightIdentity(map,p,options),querySha256=await digest(q);let initial:FlightState|null=null,terminal:FlightState|null=null,expanded=0,replayTicks=0,fallback:FlightProof['fallback']=null;
 const frames:FlightState[]=[],input:FlightRun[]=[],legs:FlightLeg[]=[];
 const assumptions=['Static initial enabled colliders with reciprocal category/mask filtering. No runtime occupancy, effects, conditions, or engine AI.','Separate rectangular hover/fly motor: integer L1 speed/acceleration bounds, X then Y continuous finite-body sweeps.','Matching rectangular flight-volume union contains the entire swept body; no matching binding means world bounds. Authored one-way supports are conservative two-sided flight barriers; no directional traversal or mode transition is inferred.','Rest-to-rest cardinal lattice with exact source/goal connectors, waits and bounded search. No mode entry/exit, non-hover, swim/grapple or general kinodynamic completeness.'];
 const result=async(status:FlightStatus,diagnostics:string[]):Promise<FlightProof>=>{
  const ok=status==='verified reachable with replay witness',states=ok&&initial?[initial,...frames]:[],half=p.collider.kind==='rect'?p.collider.width*128:0,height=p.collider.height*256;
  const swept=states.length?[Math.min(...states.map(s=>s.x))-half,Math.min(...states.map(s=>s.y))-height,Math.max(...states.map(s=>s.x))-Math.min(...states.map(s=>s.x))+half*2,Math.max(...states.map(s=>s.y))-Math.min(...states.map(s=>s.y))+height] as const:null;
  return own({format:'maplab.flight-proof',version:1,revision,status,canCertify:false,complete:false,representation:'flight free-space rect-union lattice',identity,querySha256,settings:options,algorithm:q.algorithm,assumptions,diagnostics,initial,terminal:ok?terminal:null,input:ok?input:[],frames:ok?frames:[],legs:ok?legs:[],durationTicks:ok?frames.length:0,costTicks:ok?frames.length:0,expanded,replayTicks,fallback,dependencies:{sweptBoundsSu:swept,sha256:await digest({identity,querySha256,status,frames:ok?frames:[],input:ok?input:[]})}});
 };
 const checkpoint=async()=>{if(cancelled())throw new Refusal('cancelled','Cancelled flight search');await yieldTask();if(cancelled())throw new Refusal('cancelled','Cancelled flight search');};
 try{
  if(cancelled())throw new Refusal('cancelled','Cancelled flight search');const world=new FlightWorld(map,p),targets:{point:readonly [number,number];wait:number}[]=[];
  if(q.kind==='patrol'){
   const e=map.entities.find(e=>e.id===q.entityId&&e.enabled);if(!e||!('ai'in e)||e.movementId!==p.id)throw new Refusal('unsupported','Flying patrol requires the enabled entity’s own profile');
   fallback={kind:e.ai.invalidRoute,definition:e.ai.fallback,status:'configured, not executed'};const pos=flightAnchor(map,e.anchor);initial={x:pos[0],y:pos[1],vx:0,vy:0,tick:0,mode:'fly'};
   if(!e.ai.routeId)targets.push({point:pos,wait:1});else{
    const route=map.routes.find(r=>r.id===e.ai.routeId);if(!route||route.conditions.length||route.requiredAbilities.some(a=>a!=='fly'&&(a!=='locomotion.fly'||!p.abilityTags.includes(a))))throw new Refusal('unsupported','Missing flight route/capability or unsupported route conditions');
    if(!route.waypointIds.length||route.waypointIds.length>64)throw new Refusal('budget','Flight patrol waypoint budget');
    const points=route.waypointIds.map(id=>{const w=map.waypoints.find(w=>w.id===id);if(!w)throw new Refusal('unsupported','Missing flight waypoint');return {point:flightAnchor(map,w.anchor),wait:w.waitTicks};});
    targets.push(...points);
    if(route.mode!=='once'){
     if(pos[0]!==points[0]!.point[0]||pos[1]!==points[0]!.point[1])throw new Refusal('unsupported','Cyclic flight patrol requires source at first waypoint; no inferred staging transition');
     if(route.mode==='pingPong')targets.push(...points.slice(0,-1).reverse());else targets.push(points[0]!);
    }
   }
  }else{initial=own(q.initial);if(!Array.isArray(q.goal)||q.goal.length!==2||!q.goal.every(Number.isSafeInteger))throw new Refusal('unsupported','Invalid flight goal');targets.push({point:q.goal,wait:0});}
  if(!initial||!world.valid(initial)||!world.safe(initial.x,initial.y))throw new Refusal('unsupported','Invalid/outside/overlapping flight initial body; ground states are not mode-entry witnesses');
  let state=initial;
  const tick=(s:FlightState,u:FlightInput):FlightState=>{
   if(cancelled())throw new Refusal('cancelled','Cancelled flight search');if(++replayTicks>options.maxReplayTicks)throw new Refusal('budget','Flight replay-work budget');const f=world.step(s,u);if(f.status==='unsupported')throw new Refusal('unsupported',f.reason);if(f.status!=='ok')throw new Refusal('no route found within declared search/sampling budget',f.reason);return f.state;
  };
  const record=(s:FlightState,u:FlightInput)=>{if(frames.length>=options.maxRouteTicks)throw new Refusal('budget','Flight route duration budget');const next=tick(s,u);if(!input.length||input.at(-1)!.targetVx!==u.targetVx||input.at(-1)!.targetVy!==u.targetVy)input.push({...u,fromTick:s.tick});frames.push(next);return next;};
  for(let t=0;state.vx||state.vy;t++){if(t>=options.maxEdgeTicks)throw new Refusal('budget','Initial flight braking budget');state=record(state,{targetVx:0,targetVy:0});}
  for(const target of targets){
   await checkpoint();if(!target.point.every(n=>Number.isSafeInteger(n)&&Math.abs(n)<=131072*256)||!world.safe(...target.point))throw new Refusal('no route found within declared search/sampling budget','Target full body outside volume/bounds or in solid');
   const minX=Math.max(world.bound[0],Math.min(...world.volumes.map(r=>r[0])))+world.world.half,maxX=Math.min(world.bound[0]+world.bound[2],Math.max(...world.volumes.map(r=>r[0]+r[2])))-world.world.half;
   const minY=Math.max(world.bound[1],Math.min(...world.volumes.map(r=>r[1])))+world.world.height,maxY=Math.min(world.bound[1]+world.bound[3],Math.max(...world.volumes.map(r=>r[1]+r[3])));
   const axis=(lo:number,hi:number,a:number,b:number)=>{if(Math.floor((hi-lo)/options.gridSu)+3>options.maxNodes)throw new Refusal('budget','Flight lattice axis budget');const v=[lo,hi,a,b];for(let n=lo;n<=hi;n+=options.gridSu)v.push(n);return [...new Set(v)].sort((a,b)=>a-b);};
   const xs=axis(minX,maxX,state.x,target.point[0]),ys=axis(minY,maxY,state.y,target.point[1]);if(xs.length*ys.length>options.maxNodes)throw new Refusal('budget','Flight lattice node budget');
   const at=(n:Node)=>[xs[n.i]!,ys[n.j]!] as const,start={i:xs.indexOf(state.x),j:ys.indexOf(state.y)},goal={i:xs.indexOf(target.point[0]),j:ys.indexOf(target.point[1])},key=(n:Node)=>n.i+':'+n.j;
   const stop=(v:number)=>{const n=Math.max(0,Math.floor((v-1)/world.acceleration));return n*v-world.acceleration*n*(n+1)/2;};
   const motion=(from:readonly [number,number],to:readonly [number,number]):Motion|null=>{
    let s:FlightState={x:from[0],y:from[1],vx:0,vy:0,tick:0,mode:'fly'};const f:FlightState[]=[],u:FlightInput[]=[];const horizontal=from[0]!==to[0],sign=Math.sign(horizontal?to[0]-from[0]:to[1]-from[1]);
    for(let t=0;t<options.maxEdgeTicks;t++){
     const remaining=Math.abs(horizontal?to[0]-s.x:to[1]-s.y);if(!remaining&&!s.vx&&!s.vy)return {frames:f,input:u};
     let lo=0,hi=Math.min(world.speed,remaining);while(lo<hi){const v=Math.ceil((lo+hi)/2);if(v+stop(v)<=remaining)lo=v;else hi=v-1;}
     const cmd={targetVx:horizontal?(sign*lo||0):0,targetVy:horizontal?0:(sign*lo||0)};
     try{const next=tick(s,cmd);if(horizontal?(to[0]-next.x)*sign<0:(to[1]-next.y)*sign<0)return null;f.push(next);u.push(cmd);s=next;}catch(e){if(e instanceof Refusal&&e.status==='no route found within declared search/sampling budget')return null;throw e;}
    }return null;
   };
   const found=await augmentedSearch<Node,Edge>(start,key,n=>n.i===goal.i&&n.j===goal.j,async n=>{
    if(expanded>=options.maxExpanded)throw new Refusal('budget','Aggregate flight expansion budget');expanded++;if(expanded%16===0)await checkpoint();const from=at(n),out:Edge[]=[];
    for(const [di,dj] of [[-1,0],[0,-1],[0,1],[1,0]]){const to={i:n.i+di!,j:n.j+dj!};if(to.i<0||to.j<0||to.i>=xs.length||to.j>=ys.length||!world.safe(...at(to)))continue;const m=motion(from,at(to));if(m)out.push({key:key(n)+'>'+key(to),to,cost:m.frames.length,motion:m});}return out;
   },n=>q.algorithm==='dijkstra'?0:Math.ceil((Math.abs(at(n)[0]-target.point[0])+Math.abs(at(n)[1]-target.point[1]))/world.speed),options.maxExpanded,cancelled);
   if(found.status!=='candidate')throw new Refusal(found.status==='no route'?'no route found within declared search/sampling budget':found.status,'Flight lattice search '+found.status+'; no global unreachable claim');
   const startTick=state.tick;for(const edge of found.path)for(const u of edge.motion.input)state=record(state,u);
   if(state.x!==target.point[0]||state.y!==target.point[1]||state.vx||state.vy)throw new Refusal('unsupported','Chained flight replay disagreed with rest-state witness');
   for(let i=0;i<target.wait;i++)state=record(state,{targetVx:0,targetVy:0});legs.push({target:target.point,waitTicks:target.wait,startTick,endTick:state.tick});
  }
  terminal=state;return result('verified reachable with replay witness',[]);
 }catch(e){return result(e instanceof Refusal?e.status:'unsupported',[String(e)]);}
}
