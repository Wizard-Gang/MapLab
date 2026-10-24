// Rebuildable, bounded foundational graph. No route search or airborne solver.
import type { ContactMap, ClimbState, Input, Step, World } from '../physics-reference/types';
import type { MapDocument } from '../contracts/document-types';
import type { MovementDocument } from '../contracts/movement-types';
import { createWorld, resolveStance, overlaps, step, digest } from '../physics-reference';
import { movementProfileDigest } from '../contracts/movement';
import { CONTROLLER_SHA256, INTENT_SHA256 } from './identity';
import {groundIntentSupported} from './intent';
export interface Settings { readonly maxSamples:number; readonly maxTicks:number }
export const DEFAULT_SETTINGS:Settings={maxSamples:2_000_000,maxTicks:3600};
export interface Interval {readonly key:string;readonly supportId:string;readonly materialId:string;readonly direction:'both'|'aToB'|'bToA';readonly minX:number;readonly maxX:number}
export interface Node {readonly key:string;readonly intervalKey:string;readonly state:ClimbState}
export interface Edge {readonly key:string;readonly from:string;readonly to:string;readonly kind:'walk'|'climb';readonly costTicks:number;readonly initial:ClimbState;readonly input:Input;readonly frames:readonly Step[]}
export interface Identity {readonly worldSha256:string;readonly profileSha256:string;readonly controllerSha256:string;readonly settingsSha256:string;readonly cacheKey:string}
export interface Graph {readonly format:'maplab.surface-graph';readonly version:1;readonly status:'candidate'|'unsupported'|'cancelled'|'budget';readonly canCertify:false;readonly revision:number;readonly identity:Identity;readonly assumptions:readonly string[];readonly diagnostics:readonly string[];readonly intervals:readonly Interval[];readonly nodes:readonly Node[];readonly edges:readonly Edge[]}
const order=(a:{id:string},b:{id:string})=>a.id<b.id?-1:a.id>b.id?1:0;
/** Names, art and render layers do not affect physical identity; actor planes do. */
export async function identity(map:MapDocument,p:MovementDocument,settings:Settings):Promise<Identity>{
 const sorted=<T extends {id:string}>(a:readonly T[])=>[...a].sort(order);
 const worldSha256=await digest({mapId:map.id,version:map.version,bounds:map.bounds,collision:map.collisionContract,bodies:sorted(map.bodies),footholds:sorted(map.footholds),materials:sorted(map.materials),traversals:sorted(map.traversals),regions:sorted(map.regions as unknown as {id:string}[]),navigation:map.navigation,planes:map.layers.filter(l=>l.kind==='actors').map(l=>l.id)});
 const profileSha256=await movementProfileDigest(p),settingsSha256=await digest({solver:'surface-climb@3',...(map.navigation.modeVolumes.length||map.navigation.overrides.length?{intentSha256:INTENT_SHA256}:{}),latticeSu:1,fullBody:true,...settings});
 const value={worldSha256,profileSha256,controllerSha256:CONTROLLER_SHA256,settingsSha256};return {...value,cacheKey:await digest(value)};
}
const initial=(w:World,x:number,y:number,supportId:string):ClimbState=>({x,y,vx:0,vy:0,mode:'ground',supportId,planeId:w.source.footholds.find(f=>f.id===supportId)?.planeId??w.defaultPlane,facing:1,tick:0,jumpHeldPrev:false,jumpReleased:false,ticksSinceJump:0,dropSuppression:null,resources:{airJumps:0,dashCharges:0,cooldowns:{}},traversalId:null,climbReady:true});
const controls=(moveX:-1|0|1,moveY:-1|0|1=0):Input=>({moveX,moveY,run:false,jump:false,drop:false});
/** All integer center positions are tested, including true slope stance, never endpoint shrink alone.
 * Budget/cancellation return no partial graph. Each motion edge retains its full finite-body replay.
 * Intervals describe standing clearance only; they are not interchangeable motion/resource states. */
export async function buildSurfaceGraph(source:MapDocument,profile:MovementDocument,revision:number,settings:Settings=DEFAULT_SETTINGS,cancelled:()=>boolean=()=>false,yieldTask:()=>Promise<void>=()=>new Promise(r=>setTimeout(r,0))):Promise<Graph>{
 if(!Number.isSafeInteger(revision)||revision<0||!Number.isSafeInteger(settings.maxSamples)||settings.maxSamples<1||settings.maxSamples>2_000_000||!Number.isSafeInteger(settings.maxTicks)||settings.maxTicks<1||settings.maxTicks>3600)throw new Error('invalid graph settings/revision');
 const map=structuredClone(source),p=structuredClone(profile),options={...settings},id=await identity(map,p,options);
 const assumptions=['Static initial transforms; no dynamic occupancy or runtime flag evaluation.','Candidate surface/climb graph only; no jump, fall, drop, search or route certificate.','Integer-su full-footprint standing intervals; edges apply only to their exact initial state.'];
 const result=(status:Graph['status'],diagnostics:string[],intervals:Interval[]=[],nodes:Node[]=[],edges:Edge[]=[]):Graph=>({format:'maplab.surface-graph',version:1,status,canCertify:false,revision,identity:id,assumptions,diagnostics,intervals,nodes,edges});
 if(cancelled())return result('cancelled',['cancelled']);
 let w:World;try{w=createWorld(map as unknown as ContactMap,p);}catch(e){return result('unsupported',[String(e)]);}
 if(p.abilities.some(a=>a.kind==='jump'?a.airJumps!==0:a.kind!=='climb')||!groundIntentSupported(map,p))return result('unsupported',['unsupported capability or navigation intent; no inferred permissions']);
 const intervals:Interval[]=[],nodes:Node[]=[],edges:Edge[]=[];
 let samples=0;
 const checkpoint=async()=>{if(++samples%1024===0)await yieldTask();if(cancelled())throw new Error('cancelled');if(samples>options.maxSamples)throw new Error('budget');};
 const forbidden=(materialId:string)=>map.materials.find(m=>m.id===materialId)?.tags.some(t=>p.forbiddenMaterialTags.includes(t));
 const safe=(x:number,y:number)=>x-w.half>=map.bounds[0]*256&&x+w.half<=(map.bounds[0]+map.bounds[2])*256&&y-w.height>=map.bounds[1]*256&&y<=(map.bounds[1]+map.bounds[3])*256&&!overlaps(w,x,y);
 // Match the controller's reciprocal, endpoint-touching coverage, including nonadjacent pieces.
 const coverage=new Map(w.faces.map(seed=>{
  const found=new Set([seed]),queue=[seed];
  for(const f of queue)for(const next of w.faces){
   if(!next.support||found.has(next))continue;
   const welded=f.links.includes(next.supportId!)&&next.links.includes(f.supportId!);
   const sameBody=!f.registered&&!next.registered&&f.bodyId!==''&&f.bodyId===next.bodyId&&f.shapeId===next.shapeId;
   const touches=(f.a[0]===next.b[0]&&f.a[1]===next.b[1])||(f.b[0]===next.a[0]&&f.b[1]===next.a[1]);
   if(touches&&(welded||sameBody)){found.add(next);queue.push(next);}
  }
  return [seed.supportId,queue] as const;
 }));
 const permitted=(s:ClimbState,dir:-1|1)=>{
  const touched=(coverage.get(s.supportId)??[]).filter(f=>f.a[0]<s.x+w.half&&f.b[0]>s.x-w.half);
  return touched.length>0&&touched.every(f=>!forbidden(f.materialId)&&map.footholds.find(v=>v.id===f.supportId)?.direction!==(dir===1?'bToA':'aToB'));
 };
 try{
 for(const face of w.faces.filter(f=>f.support&&f.registered).sort((a,b)=>order({id:a.supportId!},{id:b.supportId!}))){
  if(forbidden(face.materialId))continue;
  const foothold=map.footholds.find(f=>f.id===face.supportId)!;
  let start:number|null=null,last=0,direction=foothold.direction;
  const append=()=>{if(start===null)return;intervals.push({key:JSON.stringify([map.id,face.supportId,start,last]),supportId:face.supportId!,materialId:face.materialId,direction,minX:start,maxX:last});start=null;};
  for(let x=face.a[0]-w.half;x<=face.b[0]+w.half;x++){
   await checkpoint();const stance=resolveStance(w,x,face.supportId!).find(s=>s.face.supportId===face.supportId);
   const s=stance?initial(w,x,stance.y,face.supportId!):null;
   const right=s&&permitted(s,1),left=s&&permitted(s,-1);
   if(s&&safe(x,s.y)&&(right||left)){const nextDirection=right?(left?'both':'aToB'):'bToA';if(nextDirection!==direction)append();direction=nextDirection;if(start===null)start=x;last=x;}else append();
  }append();
 }
 // Split at traversal entries, so an access position has its own exact motion state.
 for(const interval of intervals){
  const positions=new Set([interval.minX,interval.maxX]);
  for(const t of map.traversals)if('access' in t){const x=t.points[0]![0]*256;if(x>=interval.minX&&x<=interval.maxX)positions.add(x);}
  for(const x of [...positions].sort((a,b)=>a-b)){
   const s=resolveStance(w,x,interval.supportId).find(s=>s.face.supportId===interval.supportId)!;
   nodes.push({key:JSON.stringify([interval.key,x]),intervalKey:interval.key,state:initial(w,x,s.y,interval.supportId)});
  }
 }
 const locate=(s:ClimbState)=>intervals.find(i=>i.supportId===s.supportId&&s.x>=i.minX&&s.x<=i.maxX);
 const record=(from:Node,to:Node,kind:Edge['kind'],input:Input,frames:Step[])=>edges.push({key:JSON.stringify([from.key,to.key,kind]),from:from.key,to:to.key,kind,costTicks:frames.length,initial:from.state,input,frames});
 // Only adjacent anchors on a support, plus reciprocal authored endpoint neighbours.
 const pairs: [Node,Node][]=[];
 for(const i of intervals){const ns=nodes.filter(n=>n.intervalKey===i.key);for(let n=1;n<ns.length;n++)pairs.push([ns[n-1]!,ns[n]!],[ns[n]!,ns[n-1]!]);}
 // Permission changes split standing intervals, not the physical support. Replay each
 // adjacent lattice boundary in both directions; full-footprint permissions decide admission.
 const bySupport=new Map<string,Interval[]>();
 for(const i of intervals){const list=bySupport.get(i.supportId)??[];list.push(i);bySupport.set(i.supportId,list);}
 for(const list of bySupport.values())for(let i=1;i<list.length;i++){
  const left=list[i-1]!,right=list[i]!;
  if(left.maxX+1!==right.minX)continue;
  const a=nodes.find(n=>n.intervalKey===left.key&&n.state.x===left.maxX)!;
  const b=nodes.find(n=>n.intervalKey===right.key&&n.state.x===right.minX)!;
  pairs.push([a,b],[b,a]);
 }
 for(const from of nodes)for(const link of map.footholds.find(f=>f.id===from.state.supportId)!.connections[from.state.x<(map.footholds.find(f=>f.id===from.state.supportId)!.a[0]+map.footholds.find(f=>f.id===from.state.supportId)!.b[0])*128?'a':'b']){
  const candidates=nodes.filter(n=>n.state.supportId===link.footholdId).sort((a,b)=>Math.abs(a.state.x-from.state.x)-Math.abs(b.state.x-from.state.x));if(candidates[0])pairs.push([from,candidates[0]]);
 }
 for(const [from,to] of pairs){
  const dir=to.state.x>from.state.x?1:-1,input=controls(dir),frames:Step[]=[];let s=from.state;
  for(let tick=0;tick<options.maxTicks;tick++){
   await checkpoint();if(!permitted(s,dir))break;const f=step(w,s,input),next=f.state as ClimbState;
   if(f.status!=='ok'||next.mode!=='ground'||!safe(next.x,next.y)||!permitted(next,dir))break;
   const here=locate(next);if(!here)break;
   let legal=true;for(let x=Math.min(s.x,next.x);x<=Math.max(s.x,next.x);x++){await checkpoint();const poses=resolveStance(w,x).filter(v=>safe(x,v.y)&&(v.face.supportId===s.supportId||v.face.supportId===next.supportId));if(!poses.some(v=>{const pose=initial(w,x,v.y,v.face.supportId!);return locate(pose)&&permitted(pose,dir);})) {legal=false;break;}}if(!legal)break;
   frames.push(f);if(here.key===to.intervalKey&&(dir===1?next.x>=to.state.x-p.ground.walkSpeed:next.x<=to.state.x+p.ground.walkSpeed)){record(from,to,'walk',input,frames);break;}
   if(next.x===s.x)break;s=next;
   if(tick+1===options.maxTicks)throw new Error('walk-tick-budget');
  }
 }
 for(const from of nodes)for(const dir of [-1,1] as const){
  const input=controls(0,dir),frames:Step[]=[];let s=from.state,attached=false;
  for(let tick=0;tick<options.maxTicks;tick++){
   await checkpoint();const f=step(w,s,input),next=f.state as ClimbState;if(f.status!=='ok'||!safe(next.x,next.y))break;
   if(!attached&&next.mode!=='climb')break;attached=true;frames.push(f);
   if(next.mode==='ground'){
    const i=locate(next),to=i?nodes.find(n=>n.intervalKey===i.key&&n.state.x===next.x):undefined;
    if(to&&to.key!==from.key)record(from,to,'climb',input,frames);break;
   }
   if(next.mode!=='climb'||next.y===s.y&&s.mode==='climb')break;s=next;
   if(tick+1===options.maxTicks)throw new Error('climb-tick-budget');
  }
 }
 return result('candidate',[],intervals,nodes,edges);
 }catch(e){if(e instanceof Error&&(e.message==='budget'||e.message==='cancelled'||e.message.endsWith('-tick-budget')))return result(e.message==='cancelled'?'cancelled':'budget',[e.message]);throw e;}
}
