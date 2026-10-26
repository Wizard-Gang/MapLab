import {step} from '../wall/runtime';
import {resolveStance,overlaps,type ContactMap,type Input,type State,type Step,type World} from '../physics-reference';
import {sweep,groundY} from '../physics-reference/controller';
import {integer} from '../physics-reference/integer';
import type {MovementDocument} from '../contracts/movement-types';
import type {Motion} from '../contracts/geometry-types';
import {motionOffset,type Pair} from './motion';
import {platformWorld} from './world';
export interface PlatformEvent {readonly kind:'carry'|'push'|'departure'|'disabled'|'crushed';readonly bodyId:string;readonly deltaSu:Pair;readonly action?:Motion['crushAction']}
export interface PlatformStep extends Step {readonly platforms:{readonly tick:number;readonly status:'ok'|'crushed'|'unsupported';readonly events:readonly PlatformEvent[];readonly offsets:Readonly<Record<string,Pair>>}}
export const hasPlatforms=(source:ContactMap)=>source.bodies.some(b=>b.mobility==='kinematic');
// The ordinary sweep deliberately omits one-way faces; downward platform carries must still land on them.
function movementLimit(world:World,s:State,axis:0|1,delta:number):number{
 const hits=sweep(world,s,axis,delta,true),hit=hits[0];
 if(hits.filter(h=>h.coordinate===hit?.coordinate).length>8)throw Error('Platform contact budget');
 let at=hit?.coordinate??integer((axis===0?s.x:s.y)+delta);
 if(axis===1&&delta>0){
  const landings=resolveStance(world,s.x).filter(v=>v.face.bodyId===''&&v.y>=s.y&&v.y<=at);
  if(landings.filter(v=>v.y===landings[0]?.y).length>8)throw Error('Platform contact budget');
  if(landings[0])at=landings[0].y;
 }
 return at;
}
/** Move bodies in stable ID order, X then Y, push swept finite bodies, then apply the ordinary actor tick.
 * Carry is clipped by other solids; an obstructed push or upward pinch reports crush and never tunnels.
 * Departure adds the platform's last tick delta to terminal velocity once, after actor movement/gravity.
 */
export function platformStep(source:ContactMap,p:MovementDocument,old:State,input:Input):PlatformStep{
 const events:PlatformEvent[]=[],offsets=new Map<string,Pair>();let s={...old};
 const wrap=(frame:Step,status:PlatformStep['platforms']['status']='ok'):PlatformStep=>({...frame,platforms:{tick:old.tick+1,status,events,offsets:Object.fromEntries(offsets)}});
 const failed=(reason:string,status:Step['status']='unsupported')=>wrap({status,state:old,contacts:[],reason},'unsupported');
 try{
  const start=platformWorld(source,p,old.tick),owner=source.footholds.find(f=>f.id===old.supportId)?.ownerBodyId??source.bodies.find(b=>b.shapes.some(sh=>old.supportId?.startsWith(`unregistered:${b.id}/${sh.id}/`)))?.id;
  const supportBody=source.bodies.find(b=>b.id===owner),lastDelta:Pair=supportBody?.enabled&&supportBody.motion?motionOffset(supportBody.motion,old.tick+1).map((n,i)=>n-motionOffset(supportBody.motion!,old.tick)[i]!) as unknown as Pair:[0,0];
  if(s.mode==='ground'&&supportBody&&!supportBody.enabled){events.push({kind:'disabled',bodyId:supportBody.id,deltaSu:[0,0]});s={...s,mode:'air',supportId:null,vy:0};}
  // Reject malformed states before translating anything, using the unchanged controller validator.
  const valid=step(start,s,input);if(valid.status!=='ok')return wrap(valid,'unsupported');
  for(const b of source.bodies)offsets.set(b.id,b.motion?motionOffset(b.motion,old.tick):[0,0]);
  const active=source.bodies.filter(b=>b.enabled&&b.mobility==='kinematic'&&start.faces.some(f=>f.bodyId===b.id||source.footholds.some(v=>v.id===f.supportId&&v.ownerBodyId===b.id))).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  for(const body of active){
   const next=motionOffset(body.motion!,old.tick+1);
   for(const axis of [0,1] as const){
    const previous=offsets.get(body.id)!,delta=integer(next[axis]-previous[axis]);if(!delta)continue;
    const before=platformWorld(source,p,old.tick,offsets),belongs=(f:{bodyId:string;supportId:string|null})=>f.bodyId===body.id||source.footholds.some(v=>v.id===f.supportId&&v.ownerBodyId===body.id);
    const suppressed=(f:{bodyId:string;supportId:string|null})=>f.bodyId===''&&s.dropSuppression&&source.footholds.some(v=>v.id===f.supportId&&v.dropGroupId===s.dropSuppression!.group);
    const rider=s.mode==='ground'&&before.faces.some(f=>f.supportId===s.supportId&&belongs(f));
    const only={...before,faces:before.faces.filter(f=>belongs(f)&&!suppressed(f)),solids:[]};
    // Sweep relative to the moving face. A one-way may push only from its outward support side;
    // its normal also admits horizontal approach on slopes, while flat tops never push laterally.
    const pushing={...only,faces:only.faces.flatMap(f=>f.bodyId!==''?[f]:s.y<=Math.min(groundY(f,s.x-before.half),groundY(f,s.x+before.half))?[{...f,bodyId:body.id}]:[])};
    const hits=sweep(pushing,s,axis,-delta,true).filter(h=>!only.faces.some(f=>f.bodyId===''&&f.supportId===h.face.supportId)||resolveStance(only,axis===0?h.coordinate:s.x,h.face.supportId!).length>0),hit=hits[0];
    if(hits.filter(h=>h.coordinate===hit?.coordinate).length>8)return failed('Platform contact budget','contactBudget');
    const required=rider?delta:hit?integer(delta+hit.coordinate-(axis===0?s.x:s.y)):0;
    const moved=[...previous] as [number,number];moved[axis]=next[axis];offsets.set(body.id,moved);
    const after=platformWorld(source,p,old.tick,offsets);
    if(required){
     const other=platformWorld(source,p,old.tick,offsets,new Set([body.id]));
     const at=movementLimit({...other,faces:other.faces.filter(f=>!suppressed(f))},s,axis,required),actual=at-(axis===0?s.x:s.y);
     s=axis===0?{...s,x:at}:{...s,y:at};events.push({kind:rider?'carry':'push',bodyId:body.id,deltaSu:axis===0?[actual,0]:[0,actual]});
     if((!rider&&actual!==required)||overlaps(after,s.x,s.y)||(rider&&axis===1&&delta<0&&actual!==required)){
      events.push({kind:'crushed',bodyId:body.id,deltaSu:axis===0?[delta,0]:[0,delta],action:body.motion!.crushAction});
      return wrap({status:'unsupported',state:old,contacts:[],reason:'crushed by moving platform '+body.id},'crushed');
     }
    }
    const stance=resolveStance(after,s.x).find(v=>v.y===s.y);
    if(s.mode==='ground'||required&&axis===1&&delta<0)s=stance?{...s,mode:'ground',supportId:stance.face.supportId,vy:0,planeId:stance.face.planeId??after.defaultPlane}:{...s,mode:'air',supportId:null,vy:s.mode==='ground'?0:s.vy};
   }
  }
  const final=platformWorld(source,p,old.tick+1),frame=step(final,s,input);
  if(frame.status!=='ok')return wrap(frame,'unsupported');
  for(const b of source.bodies)offsets.set(b.id,b.motion?motionOffset(b.motion,old.tick+1):[0,0]);
  if(old.mode==='ground'&&frame.state.mode==='air'&&supportBody?.enabled&&supportBody.motion?.departure==='addPlatformVelocity'){
   events.push({kind:'departure',bodyId:supportBody.id,deltaSu:lastDelta});
   return wrap({...frame,state:{...frame.state,vx:integer(frame.state.vx+lastDelta[0]),vy:integer(frame.state.vy+lastDelta[1])}});
  }
  return wrap(frame);
 }catch(e){return failed(e instanceof Error?e.message:String(e),e instanceof RangeError?'unsafeInteger':e instanceof Error&&e.message==='Platform contact budget'?'contactBudget':'unsupported');}
}
