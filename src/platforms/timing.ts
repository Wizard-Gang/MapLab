import type {MapDocument,MovementDocument,Motion} from '../contracts';
import {resolveStance,overlaps,step,type ContactMap,type State,type Input,type World} from '../physics-reference';
import {platformWorld} from './world';
import {motionOffset} from './motion';
export const WAIT:Input=Object.freeze({moveX:0,moveY:0,run:false,jump:false,drop:false});
export interface Phase {readonly bodyId:string;readonly phaseTicks:number;readonly periodTicks:number;readonly offsetSu:readonly[number,number]}
export interface SafeInterval {readonly supportId:string;readonly localXSu:number;readonly fromTick:number;readonly throughTick:number}
export function period(m:Motion):number {
 const duration=m.legTicks.reduce((a,b)=>a+b,0),n=duration*(m.mode==='pingPong'?2:1);
 if(!Number.isSafeInteger(n)||n<1||!['loop','pingPong'].includes(m.mode))throw Error('Only periodic loop/pingPong schedules are supported');
 return n;
}
export function phases(map:MapDocument,tick:number):readonly Phase[]{
 return map.bodies.filter(b=>b.enabled&&b.mobility==='kinematic').map(b=>{
  if(!b.motion)throw Error('Missing platform schedule');const n=period(b.motion);
  return {bodyId:b.id,phaseTicks:Number((BigInt(tick)+BigInt(b.motion.initialPhaseTicks))%BigInt(n)),periodTicks:n,offsetSu:motionOffset(b.motion,tick)};
 }).sort((a,b)=>a.bodyId<b.bodyId?-1:a.bodyId>b.bodyId?1:0);
}
export function supportBody(map:MapDocument,s:State):string|null {
 const id=map.footholds.find(f=>f.id===s.supportId)?.ownerBodyId;
 return map.bodies.find(b=>b.id===id&&b.enabled&&b.mobility==='kinematic')?.id??null;
}
export function safe(w:World,s:Pick<State,'x'|'y'|'mode'|'supportId'>):boolean {
 const b=w.source.bounds;
 return s.x-w.half>=b[0]*256&&s.x+w.half<=(b[0]+b[2])*256&&s.y-w.height>=b[1]*256&&s.y<=(b[1]+b[3])*256&&!overlaps(w,s.x,s.y)
  &&(s.mode!=='ground'||resolveStance(w,s.x,s.supportId??undefined).some(v=>v.y===s.y&&v.face.supportId===s.supportId));
}
/** These are standing samples in support-local coordinates at explicit ticks, never static links.
 * Only a complete platformStep sweep can establish a transition between two samples. */
export async function safeIntervals(map:MapDocument,p:MovementDocument,from:number,ticks:number,budget:number,check:()=>void,yieldTask:()=>Promise<void>):Promise<{intervals:SafeInterval[];samples:number}> {
 const first=platformWorld(map as unknown as ContactMap,p,from),seeds=first.faces.filter(f=>f.support&&f.registered).flatMap(f=>{
  const owner=map.footholds.find(v=>v.id===f.supportId)?.ownerBodyId,b=map.bodies.find(b=>b.id===owner),dx=b?.motion?motionOffset(b.motion,from)[0]:0;
  const lo=f.a[0]+first.half,hi=f.b[0]-first.half;
  return lo>hi?[]:[...new Set([lo,Math.floor((lo+hi)/2),hi])].map(x=>({supportId:f.supportId!,localXSu:x-dx,owner:b?.id??null}));
 });
 const intervals:SafeInterval[]=[],open=new Map<number,SafeInterval>();let samples=0;
 for(let dt=0;dt<=ticks;dt++){
  check();const tick=from+dt,w=platformWorld(map as unknown as ContactMap,p,tick);
  for(let i=0;i<seeds.length;i++){
   if(++samples>budget)throw Error('Safe interval sample budget');
   const seed=seeds[i]!,body=map.bodies.find(b=>b.id===seed.owner),x=seed.localXSu+(body?.motion?motionOffset(body.motion,tick)[0]:0);
   const stance=resolveStance(w,x,seed.supportId).find(v=>v.face.supportId===seed.supportId);
   const valid=stance&&safe(w,{x,y:stance.y,mode:'ground',supportId:seed.supportId}),previous=open.get(i);
   if(valid)open.set(i,{supportId:seed.supportId,localXSu:seed.localXSu,fromTick:previous?.fromTick??tick,throughTick:tick});
   else if(previous){intervals.push(previous);open.delete(i);}
  }
  if(dt%16===0){await yieldTask();check();}
 }
 intervals.push(...open.values());return {intervals:intervals.sort((a,b)=>a.supportId.localeCompare(b.supportId)||a.localXSu-b.localXSu||a.fromTick-b.fromTick),samples};
}
export function validateTimedWorld(map:MapDocument,p:MovementDocument,initial:State):World {
 if(!map.bodies.some(b=>b.enabled&&b.mobility==='kinematic'))throw Error('No enabled periodic platform');
 if(map.bodies.some(b=>b.enabled&&b.mobility==='kinematic'&&(!b.motion||b.motion.mode==='once')))throw Error('Aperiodic/once motion requires engine prediction; timed navigation unsupported');
 if(p.abilities.some(a=>a.kind!=='jump'||a.airJumps!==0)||map.traversals.length||map.navigation.links.length||map.navigation.modeVolumes.length||map.navigation.overrides.length||map.footholds.some(f=>f.enabled&&f.direction!=='both'))throw Error('Unsupported timed capability or navigation intent');
 const w=platformWorld(map as unknown as ContactMap,p,initial.tick);phases(map,initial.tick);
 if(w.faces.some(f=>map.materials.find(m=>m.id===f.materialId)?.tags.some(t=>p.forbiddenMaterialTags.includes(t))))throw Error('Forbidden material in timed world');
 if(!safe(w,initial)||step(w,initial,WAIT).status!=='ok')throw Error('Invalid timed initial state');
 return w;
}
