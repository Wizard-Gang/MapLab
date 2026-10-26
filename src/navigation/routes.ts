import {step,airJumpCount,supportedJumpProfile,hasDash,initialDash,initialResources,type DashInput} from '../dash/runtime';
import {buildDashActions} from './dash';
import {buildAirJumpActions} from './air-jumps';
import {groundMotionAllowed} from './intent';
// Static reference-route proofs. Authored links never become physical exemptions.
import type { MapDocument } from '../contracts/document-types';
import type { MovementDocument } from '../contracts/movement-types';
import type { Anchor, RegionShape } from '../contracts/common-types';
import { createWorld, resolveStance, overlaps, digest, replayBytes, type ClimbState, type Step, type Input, type RunInput, type ContactMap, type World } from '../physics-reference';
import { buildSurfaceGraph, identity as surfaceIdentity, type Interval, type Identity } from './surface';
import { buildAirborneActions, airborneIdentity, AIR_DEFAULTS, type AirOptions } from './airborne';
import { augmentedSearch, type Move } from './search';

function frozen<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}

export interface RouteSettings {readonly maxExpanded:number;readonly maxReplayTicks:number;readonly maxActionTicks:number;readonly maxRouteTicks:number;readonly maxDepth:number;readonly maxTargets:number;readonly toleranceSu:number;readonly penaltyTicks:number;readonly air:AirOptions}
export const ROUTE_DEFAULTS:RouteSettings=frozen({maxExpanded:512,maxReplayTicks:200000,maxActionTicks:240,maxRouteTicks:3600,maxDepth:16,maxTargets:16,toleranceSu:128,penaltyTicks:0,air:{...AIR_DEFAULTS}});
/** The owned slow ground-only patrol needs 360 movement ticks for one authored leg. */
export function defaultRouteSettings(profile:MovementDocument):RouteSettings {return profile.abilities.length===0&&profile.ground.walkSpeed>0&&profile.ground.walkSpeed<=256?frozen({...ROUTE_DEFAULTS,maxActionTicks:512}):ROUTE_DEFAULTS;}
export interface Goal {readonly supportId:string;readonly x:number;readonly toleranceSu:number;readonly vx:number}
export type RouteStatus='verified reachable with replay witness'|'no route found within declared search/sampling budget'|'proven unreachable'|'budget'|'unsupported'|'cancelled';
export interface RouteAction {readonly key:string;readonly kind:string;readonly initial:ClimbState;readonly terminal:ClimbState;readonly input:readonly RunInput[];readonly frames:readonly Step[];readonly durationTicks:number;readonly penaltyTicks:number;readonly refinedFrom:string|null}
export interface RouteProof {
 readonly format:'maplab.route-proof';readonly version:1;readonly revision:number;readonly status:RouteStatus;readonly canCertify:false;readonly complete:false;
 readonly identity:Identity;readonly querySha256:string;readonly settings:RouteSettings;readonly algorithm:'astar'|'dijkstra';readonly heuristic:'horizontal tick lower bound'|'zero';
 readonly assumptions:readonly string[];readonly diagnostics:readonly string[];readonly initial:ClimbState|null;readonly terminal:ClimbState|null;readonly goals:readonly Goal[];
 readonly actions:readonly RouteAction[];readonly input:readonly RunInput[];readonly frames:readonly Step[];readonly costTicks:number;readonly durationTicks:number;
 readonly expanded:number;readonly replayTicks:number;readonly clearanceSamples:number;readonly refinements:number;readonly rejectedTransitions:number;
 readonly targetRegionId?:string;
 readonly dependencies:{readonly sweptBoundsSu:readonly [number,number,number,number]|null;readonly sha256:string};
}
interface Template {key:string;kind:string;initial:ClimbState;input:readonly RunInput[];ticks:number}
interface Node {state:ClimbState;depth:number}
interface Transition extends Move<Node> {action:RouteAction}
class Exhausted extends Error {}
const neutral:Input={moveX:0,moveY:0,run:false,jump:false,drop:false};
const controls=(direction:-1|0|1,run=false):Input=>({...neutral,moveX:direction,run});
const sign=(n:number)=>Math.sign(n) as -1|0|1;
/** Tick is the only omitted field: worlds are static and time-dependent abilities are unsupported.
 * Depth remains in the search key, so a cheaper/deeper arrival cannot erase a shallower one. */
export const physicalStateKey=(state:ClimbState)=>{const {tick:_,...rest}=state;return replayBytes(rest);};
export async function routingIdentity(map:MapDocument,p:MovementDocument,settings:RouteSettings):Promise<Identity>{
 const [base,air]=await Promise.all([surfaceIdentity(map,p,{maxSamples:settings.air.maxClearanceSamples,maxTicks:3600}),airborneIdentity(map,p,settings.air)]);
 const sorted=<T extends {id:string}>(values:readonly T[])=>[...values].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const settingsSha256=await digest({solver:'augmented-reference-routes@1',surfaceSolver:base.settingsSha256,airborneSolver:air.settingsSha256,settings,routeIntent:{waypoints:sorted(map.waypoints),routes:sorted(map.routes),entities:sorted(map.entities).map(({id,enabled,anchor,facing,...e})=>({id,enabled,anchor,facing,...('movementId' in e?{movementId:e.movementId}:{}),...('ai' in e?{ai:e.ai}:{})}))}});
 const value={worldSha256:base.worldSha256,profileSha256:base.profileSha256,controllerSha256:base.controllerSha256,settingsSha256};return {...value,cacheKey:await digest(value)};
}
const matches=(s:ClimbState,g:Goal)=>s.mode==='ground'&&s.supportId===g.supportId&&Math.abs(s.x-g.x)<=g.toleranceSu&&s.vx===g.vx&&s.vy===0;
/** Inclusive foot-point membership in authored WU shapes, with exact integer-su products. */
export function regionContains(shape:RegionShape,x:number,y:number):boolean{
 const px=BigInt(x),py=BigInt(y),su=(n:number)=>BigInt(n*256);
 if(shape.kind==='rect'){const [a,b,w,h]=shape.rect.map(su) as [bigint,bigint,bigint,bigint];return px>=a&&px<=a+w&&py>=b&&py<=b+h;}
 if(shape.kind==='circle'){const dx=px-su(shape.center[0]),dy=py-su(shape.center[1]),r=su(shape.radius);return dx*dx+dy*dy<=r*r;}
 let inside=false;
 for(let n=0;n<shape.points.length;n++){
  const a=shape.points[n]!,b=shape.points[(n+1)%shape.points.length]!,ax=su(a[0]),ay=su(a[1]),bx=su(b[0]),by=su(b[1]),cross=(bx-ax)*(py-ay)-(by-ay)*(px-ax);
  if(cross===0n&&px>=(ax<bx?ax:bx)&&px<=(ax>bx?ax:bx)&&py>=(ay<by?ay:by)&&py<=(ay>by?ay:by))return true;
  if((ay>py)!==(by>py)&&((cross>0n&&by>ay)||(cross<0n&&by<ay)))inside=!inside;
 }return inside;
}
export function anchorState(w:World,anchor:Anchor,facing:1|-1=1):ClimbState{
 let x:number,y:number;
 if(anchor.kind==='world'){x=anchor.point[0]*256;y=anchor.point[1]*256;}
 else if(anchor.kind==='body'){const b=w.source.bodies.find(b=>b.id===anchor.bodyId&&b.enabled&&b.mobility==='static');if(!b)throw Error('unsupported body anchor');x=(b.position[0]+anchor.point[0])*256;y=(b.position[1]+anchor.point[1])*256;}
 else if(anchor.kind==='surface'){
  const f=w.faces.find(f=>f.supportId===anchor.footholdId);if(!f||anchor.normalOffset!==0)throw Error('unsupported surface anchor');
  x=f.a[0]+Math.floor((f.b[0]-f.a[0])*Math.round(anchor.u*65536)/65536);const stance=resolveStance(w,x,anchor.footholdId)[0];if(!stance)throw Error('anchor has no full-footprint stance');y=stance.y;
 }else throw Error('unsupported entity-relative anchor');
 const stance=resolveStance(w,x,anchor.kind==='surface'?anchor.footholdId:undefined).find(v=>v.y===y);
 return {x,y,vx:0,vy:0,mode:stance?'ground':'air',supportId:stance?.face.supportId??null,planeId:stance?.face.planeId??w.defaultPlane,facing,tick:0,jumpHeldPrev:false,jumpReleased:false,ticksSinceJump:0,dropSuppression:null,resources:initialResources(w.profile),...initialDash(w.profile),traversalId:null,climbReady:true};
}
function validateSettings(s:RouteSettings){
 const limits={maxExpanded:10000,maxReplayTicks:2000000,maxActionTicks:3600,maxRouteTicks:36000,maxDepth:128,maxTargets:128,toleranceSu:8192,penaltyTicks:100000};
 for(const [key,max] of Object.entries(limits)){const n=s[key as keyof typeof limits];if(!Number.isSafeInteger(n)||n<(key==='penaltyTicks'||key==='toleranceSu'?0:1)||n>max)throw Error('invalid route settings: '+key);}
}
/** Complete chained replay never resets velocity, resources, contacts or input-edge flags. */
export function replayRouteActions(w:World,initial:ClimbState,actions:readonly RouteAction[]):{frames:Step[];input:RunInput[];terminal:ClimbState}|null{
 let s=initial;const frames:Step[]=[],input:RunInput[]=[];
 for(const action of actions){
  let airJumpUsed=false,dashUsed=false;
  if(replayBytes(s)!==replayBytes(action.initial)||action.frames.length!==action.durationTicks||!action.input.length||action.input[0]!.fromTick!==s.tick)return null;
  if(action.input.some((c,i)=>!Number.isSafeInteger(c.fromTick)||c.fromTick>=s.tick+action.durationTicks||(i>0&&c.fromTick<=action.input[i-1]!.fromTick)))return null;
  let at=0;
  for(let n=0;n<action.frames.length;n++){
   while(action.input[at+1]&&action.input[at+1]!.fromTick<=s.tick)at++;
   const c=action.input[at]!;if(c.fromTick>s.tick)return null;
   const {fromTick:_,...control}=c,f=step(w,s,control);airJumpUsed ||= (f.state.resources?.airJumps??0)<s.resources.airJumps;dashUsed ||= !!(control as DashInput).dash;
   if(dashUsed&&!groundMotionAllowed(w.source as unknown as MapDocument,w.profile,'dash',s,f.state))return null;
   if(f.status!=='ok'||replayBytes(f)!==replayBytes(action.frames[n]!)||!groundMotionAllowed(w.source as unknown as MapDocument,w.profile,action.kind,s,f.state)||(control.jump||airJumpUsed)&&!groundMotionAllowed(w.source as unknown as MapDocument,w.profile,'jump',s,f.state)||control.drop&&!groundMotionAllowed(w.source as unknown as MapDocument,w.profile,'drop',s,f.state))return null;
   input.push({...control,fromTick:s.tick});frames.push(f);s=f.state as ClimbState;
  }
  if(replayBytes(s)!==replayBytes(action.terminal))return null;
 }
 return {frames,input:compress(input),terminal:s};
}
function compress(input:readonly RunInput[]):RunInput[]{const out:RunInput[]=[];let previous='';for(const c of input){const {fromTick:_,...control}=c,bytes=replayBytes(control);if(bytes!==previous){out.push(c);previous=bytes;}}return out;}

export class Navigation {
 private constructor(private readonly map:MapDocument,private readonly profile:MovementDocument,private readonly world:World,readonly identity:Identity,readonly revision:number,readonly settings:RouteSettings,readonly status:'candidate'|'budget'|'unsupported'|'cancelled',readonly diagnostics:readonly string[],private readonly intervals:readonly Interval[],private readonly templates:readonly Template[]){frozen(map);frozen(profile);frozen(world);frozen(identity);frozen(settings);frozen(diagnostics);frozen(intervals);frozen(templates);}
 static async build(source:MapDocument,profile:MovementDocument,revision:number,settings:RouteSettings=defaultRouteSettings(profile),cancelled:()=>boolean=()=>false,yieldTask:()=>Promise<void>=()=>new Promise(r=>setTimeout(r,0))):Promise<Navigation>{
  validateSettings(settings);const map=structuredClone(source),p=structuredClone(profile),options=structuredClone(settings);
  const surface=await buildSurfaceGraph(map,p,revision,{maxSamples:options.air.maxClearanceSamples,maxTicks:3600},cancelled,yieldTask);
  const id=await routingIdentity(map,p,options);
  let world:World;try{world=createWorld(map as unknown as ContactMap,p);}catch(e){return new Navigation(map,p,{} as World,id,revision,options,'unsupported',[String(e)],[],[]);}
  if(surface.status!=='candidate')return new Navigation(map,p,world,id,revision,options,surface.status,surface.diagnostics,[],[]);
  const air=await buildAirborneActions(map,p,revision,options.air,cancelled,yieldTask);
  if(air.status==='budget'||air.status==='unsupported'||air.status==='cancelled')return new Navigation(map,p,world,id,revision,options,air.status,air.diagnostics,[],[]);
  const templates:Template[]=[...surface.edges.map(e=>({key:e.key,kind:e.kind,initial:e.initial,input:[{...e.input,fromTick:0}],ticks:e.frames.length})),...air.edges.map(e=>({key:e.key,kind:e.kind,initial:e.initial,input:e.input,ticks:e.costTicks}))].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  return new Navigation(map,p,world,id,revision,options,'candidate',air.diagnostics,surface.intervals,templates);
 }
 sourceState(entityId:string):ClimbState{const entity=this.map.entities.find(e=>e.id===entityId&&e.enabled);if(!entity)throw Error('missing enabled source entity');return anchorState(this.world,entity.anchor,entity.facing==='left'?-1:1);}
 /** Reuse immutable physical preparation when only bounded search settings change.
  * Air generation/clearance settings require a new build; every variant gets its own identity. */
 async withSearchLimits(limits:Partial<Omit<RouteSettings,'air'>>):Promise<Navigation>{
  if(Object.keys(limits).some(k=>k==='air'||!(k in ROUTE_DEFAULTS)))throw Error('invalid search limit');
  const options={...this.settings,...structuredClone(limits)};validateSettings(options);
  return new Navigation(this.map,this.profile,this.world,await routingIdentity(this.map,this.profile,options),this.revision,options,this.status,this.diagnostics,this.intervals,this.templates);
 }
 unavailable(algorithm:'astar'|'dijkstra',initial:ClimbState|null=null):Promise<RouteProof>{if(this.status==='candidate')throw Error('navigation is available');return this.failure(initial,[],this.status,this.diagnostics,algorithm);}
 goal(anchor:Anchor):Goal{const s=anchorState(this.world,anchor);if(s.mode!=='ground'||!s.supportId)throw Error('goal requires a supported stance');return {supportId:s.supportId,x:s.x,toleranceSu:this.settings.toleranceSu,vx:0};}
 private locate(s:ClimbState){return this.intervals.find(i=>i.supportId===s.supportId&&s.x>=i.minX&&s.x<=i.maxX);}
 private hasCapability(tag:string):boolean{
  if(!this.profile.abilityTags.includes(tag))return false;
  if(tag==='climb.ladder'||tag==='climb.rope')return this.profile.abilities.some(a=>a.kind==='climb'&&(tag==='climb.ladder'?a.ladder:a.rope));
  const kind=tag.startsWith('locomotion.')?tag.slice(11):tag;
  return !['jump','climb','dash','wall','ledge','swim','fly','grapple','teleport','launch','modifier','registered'].includes(kind)||this.profile.abilities.some(a=>a.kind===kind);
 }
 private allowed(i:Interval,d:number){return d===0||i.direction==='both'||(d>0?i.direction==='aToB':i.direction==='bToA');}
 private safe(s:ClimbState){const w=this.world,b=this.map.bounds;return s.x-w.half>=b[0]*256&&s.x+w.half<=(b[0]+b[2])*256&&s.y-w.height>=b[1]*256&&s.y<=(b[1]+b[3])*256&&!overlaps(w,s.x,s.y);}
 async route(initial:ClimbState,goal:Goal,algorithm:'astar'|'dijkstra'='astar',cancelled:()=>boolean=()=>false,yieldTask:()=>Promise<void>=()=>new Promise(r=>setTimeout(r,0))):Promise<RouteProof>{return this.plan(initial,[{goal,wait:0}],algorithm,cancelled,yieldTask);}
 /** A region query samples a bounded supported point, then checks actual terminal
  * membership. Failure of those samples never proves the whole region unreachable. */
 async region(source:ClimbState,regionId:string,algorithm:'astar'|'dijkstra'='astar',cancelled:()=>boolean=()=>false,yieldTask:()=>Promise<void>=()=>new Promise(r=>setTimeout(r,0))):Promise<RouteProof>{
  const initial=structuredClone(source),region=this.map.regions.find(r=>r.id===regionId);
  const decorate=async(proof:RouteProof):Promise<RouteProof>=>({...proof,targetRegionId:regionId,querySha256:await digest({initial:proof.initial,goals:proof.goals,algorithm,targetRegionId:regionId}),dependencies:{...proof.dependencies,sha256:await digest(proof.status==='verified reachable with replay witness'?{identity:this.identity,initial:proof.initial,goals:proof.goals,actions:proof.actions,frames:proof.frames,targetRegionId:regionId}:{identity:this.identity,initial:proof.initial,goals:proof.goals,status:proof.status,targetRegionId:regionId})}});
  if(this.status!=='candidate')return decorate(await this.unavailable(algorithm,initial));
  if(cancelled())return decorate(await this.failure(initial,[],'cancelled',['cancelled'],algorithm));
  if(!region)return decorate(await this.failure(initial,[],'unsupported',['unknown goal region'],algorithm));
  const s=region.shape;
  const bounds=s.kind==='rect'?[s.rect[0],s.rect[0]+s.rect[2]]:s.kind==='circle'?[s.center[0]-s.radius,s.center[0]+s.radius]:[Math.min(...s.points.map(p=>p[0])),Math.max(...s.points.map(p=>p[0]))];
  const candidates=this.intervals.filter(i=>i.maxX>=bounds[0]!*256&&i.minX<=bounds[1]!*256).sort((a,b)=>Math.abs((a.minX+a.maxX)/2-initial.x)-Math.abs((b.minX+b.maxX)/2-initial.x)||(a.key<b.key?-1:a.key>b.key?1:0)).slice(0,this.settings.maxTargets);
  let goal:Goal|null=null;
  for(const interval of candidates){const low=Math.max(interval.minX,bounds[0]!*256),high=Math.min(interval.maxX,bounds[1]!*256),x=Math.floor((low+high)/2);const pose=resolveStance(this.world,x,interval.supportId).find(p=>p.face.supportId===interval.supportId&&regionContains(s,x,p.y));if(pose){goal={supportId:interval.supportId,x,toleranceSu:this.settings.toleranceSu,vx:0};break;}}
  if(!goal)return decorate(await this.failure(initial,[],'no route found within declared search/sampling budget',['No grounded region sample found within the declared candidate budget.'],algorithm));
  const proof=await this.route(initial,goal,algorithm,cancelled,yieldTask);
  if(proof.status==='proven unreachable'||proof.status==='verified reachable with replay witness'&&(!proof.terminal||!regionContains(s,proof.terminal.x,proof.terminal.y)))return decorate({...await this.failure(initial,[goal],'no route found within declared search/sampling budget',['The bounded region sample was not reached inside the region; no region-wide unreachable claim.'],algorithm),heuristic:proof.heuristic,expanded:proof.expanded,replayTicks:proof.replayTicks,clearanceSamples:proof.clearanceSamples,refinements:proof.refinements,rejectedTransitions:proof.rejectedTransitions});
  return decorate(proof);
 }
 async patrol(entityId:string,algorithm:'astar'|'dijkstra'='astar',cancelled:()=>boolean=()=>false,yieldTask:()=>Promise<void>=()=>new Promise(r=>setTimeout(r,0))):Promise<RouteProof>{
  if(this.status!=='candidate')return this.failure(null,[],this.status,this.diagnostics,algorithm);
  const entity=this.map.entities.find(e=>e.id===entityId&&e.enabled);
  if(!entity)return this.failure(null,[],'unsupported',['missing enabled patrol entity'],algorithm);
  let initial:ClimbState;try{initial=this.sourceState(entityId);}catch(e){return this.failure(null,[],'unsupported',[String(e)],algorithm);}
  if(!entity||!('ai' in entity)||entity.movementId!==this.profile.id)return this.failure(initial,[],'unsupported',['patrol requires the entity\'s own movement profile'],algorithm);
  if(!entity.ai.routeId)return this.plan(initial,[{goal:{supportId:initial.supportId??'',x:initial.x,toleranceSu:0,vx:0},wait:1}],algorithm,cancelled,yieldTask);
  const route=this.map.routes.find(r=>r.id===entity.ai.routeId);
  if(!route||!['once','loop','pingPong'].includes(route.mode)||route.conditions.length||route.requiredAbilities.some(a=>!this.hasCapability(a)))return this.failure(initial,[],'unsupported',['missing route capability or unknown route condition'],algorithm);
  if(!route.waypointIds.length||route.waypointIds.length>128)return this.failure(initial,[],'budget',['patrol waypoint budget'],algorithm);
  const points=route.waypointIds.map(id=>this.map.waypoints.find(w=>w.id===id));if(points.some(p=>!p))return this.failure(initial,[],'unsupported',['missing waypoint'],algorithm);
  let legs:{goal:Goal;wait:number}[];try{legs=points.map(p=>({goal:this.goal(p!.anchor),wait:p!.waitTicks}));}catch(e){return this.failure(initial,[],'unsupported',[String(e)],algorithm);}
  if(route.mode==='pingPong')legs=[...legs,...legs.slice(0,-1).reverse()];else if(route.mode==='loop')legs=[...legs,legs[0]!];
  // A second closed cycle must reproduce the first boundary state (excluding static time).
  const cycle=route.mode==='once'?null:legs.slice(1);
  return this.plan(initial,cycle?[...legs,...cycle]:legs,algorithm,cancelled,yieldTask,cycle?legs.length-1:null);
 }
 private async failure(initial:ClimbState|null,goals:readonly Goal[],status:RouteStatus,diagnostics:readonly string[],algorithm:'astar'|'dijkstra'):Promise<RouteProof>{
  return {format:'maplab.route-proof',version:1,revision:this.revision,status,canCertify:false,complete:false,identity:this.identity,querySha256:await digest({initial,goals,algorithm}),settings:this.settings,algorithm,heuristic:'zero',assumptions:['Static source transforms and named reference controller only.','Bounded samples; no runtime AI, dynamic blocker, engine parity or global completeness claim.','Exact initial/terminal velocity, input-edge flags and resources are retained.'],diagnostics,initial,terminal:null,goals,actions:[],input:[],frames:[],costTicks:0,durationTicks:0,expanded:0,replayTicks:0,clearanceSamples:0,refinements:0,rejectedTransitions:0,dependencies:{sweptBoundsSu:null,sha256:await digest({identity:this.identity,initial,goals,status})}};
 }
 private async plan(source:ClimbState,requestedLegs:readonly {goal:Goal;wait:number}[],algorithm:'astar'|'dijkstra',cancelled:()=>boolean,yieldTask:()=>Promise<void>,cycleBoundary:number|null=null):Promise<RouteProof>{
  const initial=structuredClone(source),legs=structuredClone(requestedLegs),goals=legs.map(l=>({...l.goal})),settings=this.settings,actions:RouteAction[]=[];
  if(algorithm!=='astar'&&algorithm!=='dijkstra')throw Error('invalid route algorithm');
  let expanded=0,replayTicks=0,clearanceSamples=0,refinements=0,rejectedTransitions=0,depth=0,cycleState:string|null=null,usedHorizontal=false;
  const finish=async(status:RouteStatus,diagnostics:string[]):Promise<RouteProof>=>({...await this.failure(initial,goals,status,diagnostics,algorithm),heuristic:usedHorizontal?'horizontal tick lower bound':'zero',expanded,replayTicks,clearanceSamples,refinements,rejectedTransitions});
  if(this.status!=='candidate')return finish(this.status,[...this.diagnostics]);
  for(const l of legs)if(!l||!Number.isSafeInteger(l.wait)||l.wait<0||l.wait>3600||![l.goal.x,l.goal.vx,l.goal.toleranceSu].every(Number.isSafeInteger)||l.goal.toleranceSu<0||l.goal.toleranceSu>8192)throw Error('invalid route goal/wait');
  const take=async()=>{if(cancelled())throw new Exhausted('cancelled');if(replayTicks>=settings.maxReplayTicks)throw new Exhausted('budget');replayTicks++;if(replayTicks%256===0)await yieldTask();};
  const scan=async()=>{if(++clearanceSamples>settings.air.maxClearanceSamples)throw new Exhausted('budget');if(clearanceSamples%1024===0){await yieldTask();if(cancelled())throw new Exhausted('cancelled');}};
  const advance=async(s:ClimbState,c:Input)=>{await take();const f=step(this.world,s,c);if(f.status==='contactBudget')throw new Exhausted('budget');return f;};
  const permitted=(s:ClimbState,c:Input)=>{const i=this.locate(s);return s.mode!=='ground'||!!i&&this.allowed(i,s.vx)&&this.allowed(i,c.moveX);};
  const action=async(kind:string,start:ClimbState,frames:Step[],input:RunInput[],refinedFrom:string|null):Promise<RouteAction>=>{const schedule=compress(input);return {key:await digest({start,input:schedule,kind,refinedFrom}),kind,initial:start,terminal:(frames.at(-1)?.state??start) as ClimbState,input:schedule,frames,durationTicks:frames.length,penaltyTicks:settings.penaltyTicks,refinedFrom};};
  const align=async(start:ClimbState,target:Goal):Promise<RouteAction|null>=>{
   const interval=this.locate(start);if(!interval||interval.supportId!==target.supportId||target.x<interval.minX||target.x>interval.maxX)return null;
   let s=start;const frames:Step[]=[],input:RunInput[]=[];
   for(let n=0;n<settings.maxActionTicks;n++){
    if(matches(s,target)&&!s.jumpHeldPrev&&s.climbReady)return action('align',start,frames,input,null);
    const material=this.map.materials.find(m=>m.id===interval.materialId),brake=Math.floor(this.profile.ground.braking*(material?.traction??256)/256);
    const ticks=brake?Math.min(settings.maxActionTicks,Math.max(0,Math.ceil(Math.abs(s.vx)/brake)-1)):0;
    const stopping=sign(s.vx)*(ticks*Math.abs(s.vx)-brake*ticks*(ticks+1)/2)+(material?.conveyorSu??0)*ticks;
    const delta=target.x-s.x-(target.vx===0?stopping:0),d=Math.abs(delta)<=target.toleranceSu&&target.vx===0?0:sign(delta);
    const c=controls(d,Math.abs(target.vx)>this.profile.ground.walkSpeed);if(!permitted(s,c))return null;const f=await advance(s,c),next=f.state as ClimbState;
    if(f.status!=='ok'||next.mode!=='ground'||this.locate(next)?.key!==interval.key||!this.safe(next)||!permitted(next,c))return null;
    input.push({...c,fromTick:s.tick});frames.push(f);if(replayBytes(next)===replayBytes(s))return null;s=next;
   }return matches(s,target)&&!s.jumpHeldPrev&&s.climbReady?action('align',start,frames,input,null):null;
  };
  const replayTemplate=async(start:ClimbState,t:Template):Promise<RouteAction|null>=>{
   let s=start,index=0,air=s.mode==='air',attached=s.mode==='climb',airJumpUsed=false,dashUsed=false;const frames:Step[]=[],input:RunInput[]=[];
   for(let n=0;n<Math.min(t.ticks,settings.maxActionTicks);n++){
    while(t.input[index+1]&&t.input[index+1]!.fromTick<=n)index++;
    const {fromTick:_,...c}=t.input[index]!;if(!permitted(s,c))return null;const f=await advance(s,c),next=f.state as ClimbState;
    airJumpUsed ||= next.resources.airJumps<s.resources.airJumps;dashUsed ||= !!(c as DashInput).dash;
    if(dashUsed&&!groundMotionAllowed(this.map,this.profile,'dash',s,next))return null;
    if(f.status!=='ok'||!this.safe(next)||!permitted(next,c)||!groundMotionAllowed(this.map,this.profile,t.kind,s,next)||(c.jump||airJumpUsed)&&!groundMotionAllowed(this.map,this.profile,'jump',s,next)||c.drop&&!groundMotionAllowed(this.map,this.profile,'drop',s,next))return null;
    if(['jump','drop','fall','land'].includes(t.kind)&&f.contacts.some(c=>c.kind==='blocking'&&!(t.kind==='fall'&&c.axis==='y'&&c.normal[1]<0&&c.supportId===start.supportId&&next.y===start.y)))return null;
    if(t.kind==='walk'&&next.mode!=='ground')return null;
    if(s.mode==='ground'&&next.mode==='ground'){
     for(let x=Math.min(s.x,next.x);x<=Math.max(s.x,next.x);x++){
      await scan();
      if(!resolveStance(this.world,x).some(p=>{const pose={...next,x,y:p.y,supportId:p.face.supportId};return (p.face.supportId===s.supportId||p.face.supportId===next.supportId)&&this.safe(pose)&&permitted(pose,c);}))return null;
     }
    }
    input.push({...c,fromTick:s.tick});frames.push(f);if(next.mode==='air')air=true;if(next.mode==='climb')attached=true;
    if(air&&next.mode==='ground')break;s=next;
   }
   const terminal=frames.at(-1)?.state as ClimbState|undefined;if(!terminal||terminal.mode!=='ground'||!this.locate(terminal)||t.kind==='climb'&&!attached||(['jump','drop','fall','land'].includes(t.kind)&&!air))return null;
   const refined=physicalStateKey(start)!==physicalStateKey(t.initial)?t.key:null;if(refined)refinements++;
   return action(t.kind,start,frames,input,refined);
  };
  let current=initial;
  try{
   const probe=await advance(initial,neutral);if(probe.status!=='ok')return finish('unsupported',['invalid actual source state: '+(probe.reason??probe.status)]);
   if(!this.safe(initial)||!permitted(initial,neutral))return finish('unsupported',['actual source violates body bounds, clearance or support permissions']);
   for(let leg=0;leg<legs.length;leg++){
    const goal=legs[leg]!.goal;
    if(!this.world.faces.some(f=>f.registered&&f.supportId===goal.supportId))return finish('unsupported',['unknown target support']);
    if(!this.intervals.some(i=>i.supportId===goal.supportId&&i.maxX>=goal.x-goal.toleranceSu&&i.minX<=goal.x+goal.toleranceSu)){
     // Accessible intervals also subtract direction/material permissions. Their absence
     // alone cannot prove a physical stance impossible. Exhaust the finite integer
     // goal window against controller geometry, independently of those permissions.
     const min=(a:bigint,b:bigint)=>a<b?a:b,max=(a:bigint,b:bigint)=>a>b?a:b;
     const low=max(BigInt(this.map.bounds[0]*256+this.world.half),BigInt(goal.x)-BigInt(goal.toleranceSu));
     const high=min(BigInt((this.map.bounds[0]+this.map.bounds[2])*256-this.world.half),BigInt(goal.x)+BigInt(goal.toleranceSu));
     let stance=false;
     for(let x=Number(low);x<=Number(high);x++){await scan();if(resolveStance(this.world,x,goal.supportId).some(p=>p.face.supportId===goal.supportId&&this.safe({...initial,x,y:p.y}))){stance=true;break;}}
     if(!stance)return finish('proven unreachable',['No legal full-footprint grounded stance exists in the declared goal window.']);
     return finish('no route found within declared search/sampling budget',['A geometric stance exists, but no accessible action interval satisfies the goal; no physical unreachable claim.']);
    }
    const groundMax=BigInt(Math.max(this.profile.ground.walkSpeed,this.profile.ground.runSpeed)),ratios=[this.profile.ground.uphill,this.profile.ground.downhill];
    const bound=[BigInt(Math.abs(initial.vx)),BigInt(this.profile.air.maxSpeed),groundMax,...ratios.map(r=>(groundMax*BigInt(r.num)+BigInt(r.den)-1n)/BigInt(r.den))].reduce((a,b)=>a>b?a:b)+BigInt(Math.max(0,...this.map.materials.map(m=>Math.abs(m.conveyorSu))));
    const zero=algorithm==='dijkstra'||this.profile.abilities.some(a=>a.kind==='climb'||a.kind==='dash')||bound===0n;usedHorizontal=!zero;
    let depthLimit=false,durationLimit=false;
    const neighbors=async(node:Node):Promise<Transition[]>=>{
     if(node.depth>=settings.maxDepth){depthLimit=true;return [];}
     const s=node.state,out:Transition[]=[];
     const add=(a:RouteAction)=>{if(!a.durationTicks)return;if(a.durationTicks>settings.maxActionTicks||a.terminal.tick-initial.tick>settings.maxRouteTicks){durationLimit=true;return;}out.push({key:a.key,to:{state:a.terminal,depth:node.depth+1},cost:a.durationTicks+a.penaltyTicks,action:a});};
     const direct=await align(s,goal);if(direct)add(direct);
     if(s.mode!=='ground'){
      if(s.mode==='air'&&(airJumpCount(this.profile)>0||hasDash(this.profile))){
       const generated=await (hasDash(this.profile)?buildDashActions:buildAirJumpActions)(this.map,this.profile,this.world,this.revision,{...settings.air,maxReplayTicks:Math.max(1,Math.min(settings.air.maxReplayTicks,settings.maxReplayTicks-replayTicks))},this.identity,this.intervals,cancelled,yieldTask,undefined,s);
       replayTicks+=generated.replayTicks;
       if(replayTicks>settings.maxReplayTicks||generated.status==='budget'||generated.status==='cancelled')throw new Exhausted(generated.status==='cancelled'?'cancelled':'budget');
       for(const e of generated.edges){const t:Template={key:e.key,kind:e.kind,initial:s,input:e.input.map(c=>({...c,fromTick:c.fromTick-s.tick})),ticks:e.costTicks};const a=await replayTemplate(s,t);if(a)add(a);}
      }
      for(const d of [-1,0,1] as const){const t:Template={key:'source-land-'+d,kind:'land',initial:s,input:[{...controls(d),moveY:s.mode==='climb'?1:0,fromTick:0}],ticks:settings.maxActionTicks};const a=await replayTemplate(s,t);if(a)add(a);}return out;
     }
     const interval=this.locate(s);if(!interval)return out;
     const candidates=this.templates.filter(t=>this.locate(t.initial)?.key===interval.key).sort((a,b)=>Math.abs(a.initial.x-s.x)-Math.abs(b.initial.x-s.x)||(a.key<b.key?-1:a.key>b.key?1:0)).slice(0,settings.maxTargets);
     for(const t of candidates){
      // Up to one launch-velocity tick refines a lattice position. The resulting
      // launch is a NEW reference replay, never an assumed match to the template.
      const before=await align(s,{supportId:t.initial.supportId!,x:t.initial.x,toleranceSu:Math.max(settings.toleranceSu,Math.min(8192,Math.abs(t.initial.vx))),vx:t.initial.vx});if(!before){rejectedTransitions++;continue;}
      const a=await replayTemplate(before.terminal,t);if(!a){rejectedTransitions++;continue;}
      // Alignment and motion form one exact stateful transition, without resetting at its join.
      if(before.durationTicks+a.durationTicks>settings.maxActionTicks){add(before);continue;}
      if(before.durationTicks){const frames=[...before.frames,...a.frames],input=[...before.input,...a.input];add(await action(a.kind,s,frames,input,a.refinedFrom));}else add(a);
     }return out;
    };
    const searched=await augmentedSearch<Node,Transition>({state:current,depth},n=>physicalStateKey(n.state)+'/'+n.depth,n=>matches(n.state,goal),neighbors,n=>{if(zero)return 0;let distance=BigInt(n.state.x)-BigInt(goal.x);if(distance<0n)distance=-distance;distance-=BigInt(goal.toleranceSu);if(distance<=0n)return 0;const ticks=(distance+bound-1n)/bound;return Number(ticks>BigInt(settings.maxRouteTicks)?BigInt(settings.maxRouteTicks):ticks);},Math.max(0,settings.maxExpanded-expanded),cancelled);
    expanded+=searched.expanded;
    if(searched.status!=='candidate')return finish(searched.status==='cancelled'?'cancelled':searched.status==='budget'||depthLimit||durationLimit?'budget':'no route found within declared search/sampling budget',[...this.diagnostics,'Finite action-state sampling exhausted; no global unreachable claim.']);
    for(const m of searched.path){actions.push(m.action);current=m.action.terminal;depth=m.to.depth;}
    const wait=legs[leg]!.wait;if(wait){const start=current,frames:Step[]=[],input:RunInput[]=[];for(let n=0;n<wait;n++){const f=await advance(current,neutral);if(f.status!=='ok'||!matches(f.state as ClimbState,goal)||!this.safe(f.state as ClimbState))return finish('no route found within declared search/sampling budget',['Waypoint wait cannot retain its declared stance.']);input.push({...neutral,fromTick:current.tick});frames.push(f);current=f.state as ClimbState;}actions.push(await action('wait',start,frames,input,null));}
    if(current.tick-initial.tick>settings.maxRouteTicks)return finish('budget',['route duration budget']);
    if(leg===cycleBoundary)cycleState=physicalStateKey(current);
   }
   if(cycleState!==null&&physicalStateKey(current)!==cycleState)return finish('no route found within declared search/sampling budget',['Closed patrol resource/velocity/input-state boundary is incompatible.']);
   for(const a of actions)for(const _ of a.frames)await take();
   const complete=replayRouteActions(this.world,initial,actions);if(!complete)return finish('no route found within declared search/sampling budget',['Complete chained replay failed; incompatible transition rejected.']);
   if(cancelled())return finish('cancelled',['cancelled']);
   const all=[initial,...complete.frames.map(f=>f.state)],w=this.world,bounds=[Math.min(...all.map(s=>s.x-w.half)),Math.min(...all.map(s=>s.y-w.height)),Math.max(...all.map(s=>s.x+w.half)),Math.max(...all.map(s=>s.y))] as const;
   const proof=await finish('verified reachable with replay witness',[]);
   return {...proof,heuristic:usedHorizontal?'horizontal tick lower bound':'zero',terminal:complete.terminal,actions,input:complete.input,frames:complete.frames,durationTicks:complete.frames.length,costTicks:actions.reduce((n,a)=>n+a.durationTicks+a.penaltyTicks,0),dependencies:{sweptBoundsSu:bounds,sha256:await digest({identity:this.identity,initial,goals,actions,frames:complete.frames})}};
  }catch(e){if(e instanceof Exhausted)return finish(e.message==='cancelled'?'cancelled':'budget',[e.message]);throw e;}
 }
}
