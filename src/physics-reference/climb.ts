// Kinematic climb paths only. No source writes, gameplay condition evaluator or swing solver.
import type { AccessPoint, Traversal } from '../contracts/geometry-types';
import type { Condition } from '../contracts/common-types';
import { compare, floorDiv, fractionOrder, integer, mul } from './integer';
import { blockingContact, groundY, overlaps, resolveStance, sweep } from './controller';
import type { Input, State, Step, World } from './types';
export type ClimbPath = Extract<Traversal, {kind:'ladder'|'rope'}>;
const paths=(w:World):ClimbPath[]=>w.source.traversals.filter((t):t is ClimbPath=>'access' in t).sort((a,b)=>compare(a.id,b.id));
const ability=(w:World)=>w.profile.abilities.find(a=>a.kind==='climb');
const allowed=(w:World,p:ClimbPath):boolean=>{const a=ability(w);return !!a&&a[p.kind]&&p.requiredAbilities.every(t=>w.profile.abilityTags.includes(t));};
const yAt=(p:ClimbPath,a:AccessPoint):number=>integer(p.points[0]![1]*256+floorDiv(mul((p.points.at(-1)![1]-p.points[0]![1])*256,integer(a.pathU*65536)),65536));
function condition(w:World,c:Condition):boolean|null {
  if(c.kind==='ability')return w.profile.abilityTags.includes(c.tag);
  if(c.kind==='not'){const v=condition(w,c.term);return v===null?null:!v;}
  if(c.kind==='all'||c.kind==='any'){const v=c.terms.map(t=>condition(w,t));return v.includes(null)?null:c.kind==='all'?v.every(Boolean):v.some(Boolean);}
  return null; // Flag/entity-state runtime belongs to later tasks. Never assume true.
}
const conditions=(w:World,a:AccessPoint):boolean|null=>{const v=a.conditions.map(c=>condition(w,c));return v.includes(null)?null:v.every(Boolean);};
const materialAllowed=(w:World,id:string):boolean=>!w.source.materials.find(m=>m.id===id)?.tags.some(t=>w.profile.forbiddenMaterialTags.includes(t));
function grounded(w:World,p:ClimbPath,a:AccessPoint){
  const x=integer(p.points[0]![0]*256),y=yAt(p,a);
  // Surface anchors retain their source identity. World/body/entity anchors still need real support.
  return resolveStance(w,x,a.anchor.kind==='surface'?a.anchor.footholdId:undefined).find(v=>groundY(v.face,x)===y&&materialAllowed(w,v.face.materialId)&&!overlaps(w,x,v.y));
}
export interface ClimbDiagnostic {readonly code:string;readonly traversalId:string;readonly accessId:string|null;readonly profileId:string;readonly controller:string}
/** Profile-dependent support/clearance validation, separate from source geometry validation. */
export function validateClimbs(w:World):ClimbDiagnostic[] {
  const out:ClimbDiagnostic[]=[];
  const report=(code:string,p:ClimbPath,a?:AccessPoint):void=>{out.push({code,traversalId:p.id,accessId:a?.id??null,profileId:w.profile.id,controller:'maplab.reference-controller@1'});};
  for(const p of paths(w)){
    if(!allowed(w,p))report('missingClimbPermission',p);
    for(const a of p.access){
      const c=conditions(w,a);if(c===null)report('unsupportedCondition',p,a);else if(!c)report('conditionDenied',p,a);
      if(a.entry==='grounded'||a.exit==='grounded')if(!grounded(w,p,a))report('invalidGroundedAccess',p,a);
      if((a.entry==='airborne'||a.exit==='airborne'||a.entry==='either'||a.exit==='either')&&overlaps(w,integer(p.points[0]![0]*256),yAt(p,a)))report('blockedAirborneAccess',p,a);
    }
  }
  return out;
}
/** Both axis sweeps and destination overlap must be clear; a clear endpoint alone is insufficient. */
function clear(w:World,s:State,x:number,y:number):boolean {
  return !overlaps(w,x,y)&&!sweep(w,s,0,integer(x-s.x),true).some(h=>h.coordinate!==x)&&!sweep(w,{...s,x},1,integer(y-s.y),true).some(h=>h.coordinate!==y);
}
const matches=(mode:'ground'|'air',entry:AccessPoint['entry']):boolean=>entry==='either'||entry===(mode==='ground'?'grounded':'airborne');
/** Returns null for ordinary locomotion; attached ticks fully precede ground transitions. */
export function climbTick(w:World,old:State,input:Input,advance:(s:State,i:Input)=>Step):Step|null {
  if(old.traversalId===undefined)return null;
  const fail=(status:Step['status'],reason:string):Step=>({status,state:old,contacts:[],reason});
  const a=ability(w),dy=input.moveY!;
  let p=old.mode==='climb'?paths(w).find(p=>p.id===old.traversalId):undefined;
  if(old.mode==='climb'){
    if(old.dropSuppression!==null)return fail('invalidState','climb drop suppression');
    if(!p||!allowed(w,p)||old.supportId!==null||old.x!==integer(p.points[0]![0]*256)||old.vx!==0||old.y<Math.min(...p.points.map(v=>v[1]*256))||old.y>Math.max(...p.points.map(v=>v[1]*256)))return fail('invalidState','stale climb attachment');
    if(old.vy!==0&&old.vy!==a!.speed&&old.vy!==-a!.speed)return fail('invalidState','climb velocity');
  }else {
    if(old.traversalId!==null)return fail('invalidState','detached traversal');
    if(dy===0||!old.climbReady)return null;
    const grab=integer(old.y-w.profile.grabHeight*256);
    const candidates=paths(w).filter(t=>Math.abs(old.x-t.points[0]![0]*256)<=t.grabRadius*256&&((grab>=Math.min(...t.points.map(v=>v[1]*256))&&grab<=Math.max(...t.points.map(v=>v[1]*256)))||(old.mode==='ground'&&t.access.some(v=>matches('ground',v.entry)&&Math.abs(old.y-yAt(t,v))<=t.grabRadius*256))));
    for(const t of candidates){
      if(!allowed(w,t))continue;
      const access=t.access.filter(v=>matches(old.mode as 'ground'|'air',v.entry)&&(old.mode==='air'||Math.abs(old.y-yAt(t,v))<=t.grabRadius*256));
      if(access.some(v=>conditions(w,v)===null))return fail('unsupported','climb access condition');
      if(!access.some(v=>conditions(w,v)===true&&(old.mode!=='ground'||grounded(w,t,v)?.face.supportId===old.supportId)))continue;
      const y=Math.max(Math.min(...t.points.map(v=>v[1]*256)),Math.min(Math.max(...t.points.map(v=>v[1]*256)),old.y));
      if(!clear(w,old,integer(t.points[0]![0]*256),y))continue;
      p=t;break;
    }
    if(!p)return null;
  }
  if(!a||!p)return fail('invalidState','missing climb ability');
  const attachY=Math.max(Math.min(...p.points.map(v=>v[1]*256)),Math.min(Math.max(...p.points.map(v=>v[1]*256)),old.y));
  let s:State={...old,y:attachY,x:integer(p.points[0]![0]*256),vx:0,vy:0,mode:'climb',supportId:null,traversalId:p.id,planeId:p.planeId??w.defaultPlane,dropSuppression:null};
  if(input.jump&&!old.jumpHeldPrev){
    const detached={...s,mode:'air' as const,traversalId:null,vx:integer(mul(a.jumpOff[0],s.facing)),vy:a.jumpOff[1],jumpReleased:false,ticksSinceJump:0};
    const result=advance(detached,{...input,moveY:0});
    return result.status==='ok'?{...result,state:{...result.state,climbReady:false}}:fail(result.status,result.reason??'climb detach');
  }
  const permitted=(dy===-1&&p.direction!=='down')||(dy===1&&p.direction!=='up');
  const velocity=permitted?mul(dy,a.speed):0,lo=Math.min(...p.points.map(v=>v[1]*256)),hi=Math.max(...p.points.map(v=>v[1]*256));
  const next=Math.max(lo,Math.min(hi,integer(s.y+velocity)));
  // Access points are crossed in motion order. A blocked exit never teleports the body.
  const exits=p.access.filter(v=>v.exit!=='none'&&velocity!==0&&(velocity<0?yAt(p!,v)<=s.y&&yAt(p!,v)>=next:yAt(p!,v)>=s.y&&yAt(p!,v)<=next))
    .sort((a,b)=>(velocity<0?yAt(p!,b)-yAt(p!,a):yAt(p!,a)-yAt(p!,b))||compare(a.id,b.id));
  for(const exit of exits){
    // Do not immediately dismount from the mount point when moving into the path.
    if(old.mode!=='climb'&&yAt(p,exit)===old.y)continue;
    const c=conditions(w,exit);if(c===null)return fail('unsupported','climb exit condition');if(!c)continue;
    const ground=exit.exit==='grounded'||exit.exit==='either'?grounded(w,p,exit):undefined;
    if(exit.exit==='grounded'&&!ground)continue;
    const y=ground?.y??yAt(p,exit);
    if(!clear(w,s,s.x,y))continue;
    s={...s,y,mode:ground?'ground':'air',supportId:ground?.face.supportId??null,traversalId:null,climbReady:false,vy:0,planeId:ground?(ground.face.planeId??w.defaultPlane):s.planeId};
    return {status:'ok',state:{...s,tick:integer(old.tick+1),jumpHeldPrev:input.jump!,ticksSinceJump:0},contacts:ground?[{axis:'y',bodyId:ground.face.bodyId,shapeId:ground.face.shapeId,edgeIndex:ground.face.edgeIndex,supportId:ground.face.supportId,normal:ground.face.normal,point:ground.point,pose:{x:s.x,y:s.y},kind:ground.face.registered?'support':'unregisteredSupport'}]:[]};
  }
  const hits=sweep(w,s,1,next-s.y,true),hit=hits[0];
  if(hits.filter(h=>hit&&fractionOrder(h.at,hit.at)===0).length>8)return fail('contactBudget','climb y');
  const y=hit?.coordinate??next;
  if(overlaps(w,s.x,y))return fail('invalidState','blocked climb');
  return {status:'ok',state:{...s,y,vy:hit||y===s.y||y===lo||y===hi?0:velocity,tick:integer(old.tick+1),jumpHeldPrev:input.jump!,ticksSinceJump:0},contacts:hit?hits.filter(h=>fractionOrder(h.at,hit.at)===0).map(h=>blockingContact(w,h.face,'y',{...s,y,vy:velocity})):[],...(hit?{reason:'blocked climb motion'}:{})};
}
