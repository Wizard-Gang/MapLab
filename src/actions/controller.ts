import type {MapDocument,MovementDocument,JsonValue,Call} from '../contracts';
import {validateDocumentSchema} from '../contracts';
import {createWorld,overlaps,step,type State,type Contact} from '../physics-reference';
import {resolveStance} from '../physics-reference/controller';
import {own,covered,type Rect} from '../flight/controller';
import {ropeClear,squared} from '../grapple/geometry';
import {applyModifier,ageModifiers,effectiveProfile,validModifiers,keys,type ActiveModifier} from './modifiers';
export const ACTION_SOLVER={key:'maplab.reference-actions',version:1} as const;
export interface ActionState {readonly x:number;readonly y:number;readonly vx:number;readonly vy:number;readonly mode:'ground'|'air';readonly supportId:string|null;readonly planeId:string|null;readonly facing:-1|1;readonly tick:number;readonly cooldownTicks:number;readonly launched:boolean;readonly modifiers:readonly ActiveModifier[]}
export type ActionInput={readonly kind:'coast';readonly moveX:-1|0|1}|{readonly kind:'teleport';readonly target:readonly [number,number];readonly anchorId:string|null}|{readonly kind:'launch';readonly impulse:readonly [number,number];readonly mode:'set'|'add'}|{readonly kind:'modifier';readonly id:string;readonly definition:Call};
export interface ActionFrame {readonly status:'ok'|'blocked'|'invalidState'|'unsupported';readonly state:ActionState;readonly input:ActionInput;readonly contacts:readonly Contact[];readonly reason:string}
export const coast=(moveX:-1|0|1=0):ActionInput=>({kind:'coast',moveX});
const integers=(v:unknown):v is readonly [number,number]=>Array.isArray(v)&&v.length===2&&v.every(Number.isSafeInteger);
export class ActionWorld {
 readonly map:MapDocument;readonly profile:MovementDocument;readonly collision:ReturnType<typeof createWorld>;
 constructor(source:MapDocument,p:MovementDocument){
  if(validateDocumentSchema(source as unknown as JsonValue).some(d=>d.severity==='error'))throw Error('Invalid action map');
  this.map=own(source);this.profile=own(p);this.collision=createWorld(this.map as never,this.profile);
  if(!p.abilities.length||p.abilities.some(a=>!['teleport','launch','modifier'].includes(a.kind)))throw Error('Unsupported action capability combination');
  if(source.bodies.length>128||source.bodies.reduce((n,b)=>n+b.shapes.length,0)>128||source.bodies.some(b=>b.mobility!=='static'||b.motion||b.shapes.some(s=>s.kind!=='rect'))||source.footholds.some(f=>f.enabled&&f.mode==='oneWay'))throw Error('Unsupported action geometry');
  if(source.environment.zones.some(z=>z.kind==='movementModifier'||z.kind==='launch')||source.navigation.links.length||source.navigation.overrides.some(o=>o.profileIds.includes(p.id))||source.materials.some(m=>m.tags.some(t=>p.forbiddenMaterialTags.includes(t))))throw Error('Unsupported action intent/material policy');
  if([...Object.values(p.air),p.ground.walkSpeed,p.ground.runSpeed,p.ground.acceleration,p.ground.braking].some(n=>n<0||n>8192))throw Error('Unsupported action coefficient budget');
  for(const a of p.abilities){if(a.kind==='modifier'&&a.allowed.some(r=>r.key!=='maplab.modifier.kinematic'||r.version!==1))throw Error('Unsupported modifier solver');if(a.kind==='launch'&&(a.maxImpulse>32768||a.airControl.num>16||a.airControl.den>16))throw Error('Unsupported launch budget');}
 }
 safe(x:number,y:number):boolean {const w=this.collision;return covered([x-w.half,y-w.height,w.half*2,w.height],[this.map.bounds.map(n=>n*256) as unknown as Rect])&&!overlaps(w,x,y);}
 valid(s:ActionState):boolean {
  if(!s||keys(s)!=='cooldownTicks,facing,launched,mode,modifiers,planeId,supportId,tick,vx,vy,x,y'||![s.x,s.y,s.vx,s.vy,s.tick,s.cooldownTicks].every(Number.isSafeInteger)||s.tick<0||s.tick>=Number.MAX_SAFE_INTEGER-1||Math.abs(s.vx)+Math.abs(s.vy)>65536||Math.abs(s.x)>131072*256||Math.abs(s.y)>131072*256||s.cooldownTicks<0||s.cooldownTicks>(this.profile.abilities.find(a=>a.kind==='teleport')?.cooldownTicks??0)||![-1,1].includes(s.facing)||typeof s.launched!=='boolean'||!validModifiers(s.modifiers)||!this.safe(s.x,s.y))return false;
  try{effectiveProfile(this.profile,s.modifiers);}catch{return false;}
  if(s.launched&&!this.profile.abilities.some(a=>a.kind==='launch')||s.mode==='ground'&&s.launched)return false;
  if(s.planeId!==null&&!this.map.layers.some(l=>l.id===s.planeId&&l.kind==='actors'))return false;
  if(s.mode==='air')return s.supportId===null;
  return s.mode==='ground'&&s.vy===0&&resolveStance(this.collision,s.x,s.supportId??'').some(v=>v.y===s.y&&(v.face.planeId??this.collision.defaultPlane)===s.planeId);
 }
 step(state:ActionState,input:ActionInput):ActionFrame {
  const old=own(state),u=own(input);let contacts:readonly Contact[]=[];
  const frame=(status:ActionFrame['status'],reason:string,next=old):ActionFrame=>own({status,state:next,input:u,contacts,reason});
  try{
   if(!this.valid(old))return frame('invalidState','Invalid action state');
   let next:ActionState={...old,tick:old.tick+1,cooldownTicks:Math.max(0,old.cooldownTicks-1),modifiers:ageModifiers(old.modifiers)};
   if(!u||typeof u!=='object')return frame('invalidState','Invalid action input');
   if(u.kind==='modifier'){
    if(keys(u)!=='definition,id,kind')return frame('invalidState','Invalid modifier input');
    next={...next,modifiers:applyModifier(this.profile,next.modifiers,u.id,u.definition)};
   }else if(u.kind==='teleport'){
    if(keys(u)!=='anchorId,kind,target'||!integers(u.target)||!(u.anchorId===null||typeof u.anchorId==='string'))return frame('invalidState','Invalid teleport input');
    const a=this.profile.abilities.find(a=>a.kind==='teleport');if(!a)return frame('unsupported','Teleport unavailable');
    if(old.cooldownTicks)return frame('blocked','Teleport cooldown');const [x,y]=u.target;
    if(squared(x-old.x,y-old.y)>squared(a.range*256,0)||!this.safe(x,y))return frame('blocked','Teleport range or full-body destination clearance');
    if(a.target==='anchor'){
     const anchor=this.map.waypoints.find(w=>w.id===u.anchorId)?.anchor;
     if(!anchor||anchor.kind!=='world'||anchor.point[0]*256!==x||anchor.point[1]*256!==y)return frame('unsupported','Teleport requires exact authored world waypoint');
    }else{
     if(u.anchorId!==null)return frame('invalidState','Line-of-sight teleport has no anchor ID');
     const h=this.collision.height/2,start=[old.x,old.y-h] as const,end=[x,y-h] as const;
     if(!ropeClear(start,end,end,this.collision.faces))return frame('blocked','Teleport line of sight occluded');
    }
    const stance=resolveStance(this.collision,x).find(v=>v.y===y);
    next={...next,x,y,vx:0,vy:0,mode:stance?'ground':'air',supportId:stance?.face.supportId??null,planeId:stance?(stance.face.planeId??this.collision.defaultPlane):old.planeId,launched:false,cooldownTicks:a.cooldownTicks};
   }else if(u.kind==='coast'||u.kind==='launch'){
    let moveX:-1|0|1=0,s:State={x:old.x,y:old.y,vx:old.vx,vy:old.vy,mode:old.mode,supportId:old.supportId,planeId:old.planeId,facing:old.facing,tick:old.tick},launched=old.launched;
    const launch=this.profile.abilities.find(a=>a.kind==='launch');
    if(u.kind==='launch'){
     if(keys(u)!=='impulse,kind,mode'||!integers(u.impulse)||!['set','add'].includes(u.mode))return frame('invalidState','Invalid launch input');
     if(!launch)return frame('unsupported','Launch unavailable');
     if(Math.abs(u.impulse[0])+Math.abs(u.impulse[1])>launch.maxImpulse)return frame('blocked','Launch impulse budget');
     const vx=u.impulse[0]+(u.mode==='add'?s.vx:0),vy=u.impulse[1]+(u.mode==='add'?s.vy:0);if(Math.abs(vx)+Math.abs(vy)>65536)return frame('blocked','Launch velocity budget');
     s={...s,vx,vy,mode:'air',supportId:null};launched=true;
    }else{if(keys(u)!=='kind,moveX'||![-1,0,1].includes(u.moveX))return frame('invalidState','Invalid coast input');moveX=u.moveX;}
    let effective=effectiveProfile(this.profile,old.modifiers);
    if(launched&&launch){const acceleration=launch.canRecover?Number(BigInt(effective.air.acceleration)*BigInt(launch.airControl.num)/BigInt(launch.airControl.den)):0;effective={...effective,air:{...effective.air,acceleration}};if(!launch.canRecover)moveX=0;}
    // Use the airborne contact subset so an upward launch cannot snap straight
    // back onto its departure floor during the horizontal phase.
    const motor={...s,jumpHeldPrev:false,jumpReleased:false,ticksSinceJump:0,dropSuppression:null,resources:{airJumps:0,dashCharges:0,cooldowns:{}}};
    const actual=step({...this.collision,profile:{...effective,abilities:[]}},motor,{moveX,run:true,jump:false,drop:false});contacts=actual.contacts;
    if(actual.status!=='ok')return frame('unsupported',actual.reason??actual.status);
    const v=actual.state;next={...next,x:v.x,y:v.y,vx:v.vx,vy:v.vy,mode:v.mode as 'ground'|'air',supportId:v.supportId,planeId:v.planeId,facing:v.facing,launched:launched&&v.mode==='air'};
   }else return frame('unsupported','Unknown action kind');
   if(!this.valid(next))return frame('blocked','Result outside body bounds or invalid state');return frame('ok','',next);
  }catch(e){return frame('unsupported',String(e));}
 }
}
