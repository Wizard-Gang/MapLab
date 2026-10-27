// core.ledge.climb@1: finite-body grab, vertical lift, then horizontal transfer.
import {step as baseStep,supportedJumpProfile as baseSupported,wallContact,type WallState,type DashState,type DashInput} from '../wall/runtime';
import {resolveStance,overlaps,replayBytes,type World,type State,type Step} from '../physics-reference';
import {sweep} from '../physics-reference/controller';
import type {MovementDocument,MapDocument} from '../contracts';
export {airJumpCount,hasWall,hasDash,dashStarts,initialWall,initialDash,initialResources} from '../wall/runtime';
export type {WallState,WallAction,DashInput,DashRunInput,DashState} from '../wall/runtime';
type Definition=Extract<MovementDocument['abilities'][number],{kind:'ledge'}>;
export interface Attachment {readonly traversalId:string;readonly startY:number;readonly elapsed:number;readonly side:-1|1}
export interface LedgeProgress {readonly attachment:Attachment|null;readonly action:'ledgeGrab'|'ledgeClimb'|null;readonly actionRef:Definition['action']|null}
export type LedgeState=State&{readonly ledge?:LedgeProgress};
export const ledgeDefinition=(p:MovementDocument)=>p.abilities.find((a):a is Definition=>a.kind==='ledge');
export const hasLedge=(p:MovementDocument)=>!!ledgeDefinition(p);
export const initialLedge=(p:MovementDocument):{ledge?:LedgeProgress}=>hasLedge(p)?{ledge:{attachment:null,action:null,actionRef:null}}:{};
export function supportedJumpProfile(p:MovementDocument):boolean {
 const a=ledgeDefinition(p);return baseSupported({...p,abilities:p.abilities.filter(a=>a.kind!=='ledge')})&&(!a||p.abilities.filter(a=>a.kind==='ledge').length===1&&a.action.key==='core.ledge.climb'&&a.action.version===1&&a.climbTicks>=2&&a.climbTicks<=3600);
}
interface Grip {id:string;x:number;y:number;side:-1|1;supportId:string;region:readonly number[]}
const keys=(v:object)=>Object.keys(v).sort().join(',');
/** Only authored local grip points on the upper endpoint of a static vertical
 * solid face with an adjacent registered horizontal top are supported. */
export function ledgeGrips(w:World):{grips:Grip[];unsupported:string[]} {
 const map=w.source as unknown as MapDocument,grips:Grip[]=[],unsupported:string[]=[];
 for(const t of map.traversals.filter(t=>t.kind==='ledge')){
  if(t.kind!=='ledge')continue;
  const body=map.bodies.find(b=>b.id===t.edge.bodyId),region=map.regions.find(r=>r.id===t.approachRegionId);
  const f=w.faces.find(f=>f.bodyId===t.edge.bodyId&&f.shapeId===t.edge.shapeId&&f.edgeIndex===t.edge.edgeIndex);
  // Disabled, masked and forbidden materials never create grips.
  if(!body?.enabled||!f)continue;
  if(w.profile.forbiddenMaterialTags.some(tag=>map.materials.find(m=>m.id===f.materialId)?.tags.includes(tag)))continue;
  if(t.requiredAbilities.some(tag=>!w.profile.abilityTags.includes(tag)))continue;
  const x=f.a[0],y=Math.min(f.a[1],f.b[1]),side=f.normal[0]<0?1:-1;
  const top=w.faces.find(v=>v.bodyId===f.bodyId&&v.shapeId===f.shapeId&&v.support&&v.registered&&v.a[1]===y&&v.b[1]===y&&(side===1?v.a[0]===x:v.b[0]===x));
  if(body.mobility!=='static'||f.support||f.twoSided||f.a[0]!==f.b[0]||!top||t.points.length!==1||!region||region.shape.kind!=='rect'||t.points[0]![0]*256+body.position[0]*256!==x||t.points[0]![1]*256+body.position[1]*256!==y){unsupported.push(t.id+': requires one top-endpoint grip, vertical solid face, registered horizontal top and rectangular approach');continue;}
  grips.push({id:t.id,x,y,side,supportId:top.supportId!,region:region.shape.rect});
 }
 return {grips,unsupported};
}
function safe(w:World,x:number,y:number):boolean {const b=w.source.bounds;return [x,y].every(Number.isSafeInteger)&&x-w.half>=b[0]*256&&x+w.half<=(b[0]+b[2])*256&&y-w.height>=b[1]*256&&y<=(b[1]+b[3])*256&&!overlaps(w,x,y);}
function clear(w:World,s:State,x:number,y:number):boolean {
 if(!safe(w,x,y))return false;
 return !sweep(w,s,0,x-s.x,true).some(h=>h.coordinate!==x)&&!sweep(w,{...s,x},1,y-s.y,true).some(h=>h.coordinate!==y);
}
export function step(w:World,old:State,input:DashInput):Step {
 const a=ledgeDefinition(w.profile),s=old as LedgeState;
 const fail=(status:Step['status'],reason:string):Step=>({status,state:old,contacts:[],reason});
 if(!a){if(s.ledge!==undefined)return fail('invalidState','ledge state without capability');return baseStep(w,old,input);}
 if((w as World&{dynamicSnapshot?:true}).dynamicSnapshot)return fail('unsupported','ledge runtime supports static worlds only');
 if(!supportedJumpProfile(w.profile))return fail('unsupported','ledge action key/version or bounded duration unsupported');
 const l=s.ledge;
 if(!l||keys(l)!=='action,actionRef,attachment'||![null,'ledgeGrab','ledgeClimb'].includes(l.action)||replayBytes(l.actionRef)!==replayBytes(l.action===null?null:a.action))return fail('invalidState','complete ledge state/action metadata required');
 const {ledge:_,...plain}=s,profile={...w.profile,abilities:w.profile.abilities.filter(a=>a.kind!=='ledge')},base={...w,profile};
 if(Object.keys(input).some(k=>!['moveX','moveY','run','jump','drop','dash'].includes(k)))return fail('unsupported','ledge input subset');
 if(![-1,0,1].includes(input.moveX)||![-1,0,1].includes(input.moveY??0)||typeof input.run!=='boolean'||typeof input.jump!=='boolean'||typeof input.drop!=='boolean'||input.dash!==undefined&&typeof input.dash!=='boolean')return fail('invalidState','ledge controls');
 if(![old.x,old.y,old.vx,old.vy,old.tick].every(Number.isSafeInteger))return fail('unsafeInteger','ledge integer state');
 const active=l.attachment,geometry=ledgeGrips(w);let grip:Grip|undefined;
 if(active){
  if(keys(active)!=='elapsed,side,startY,traversalId'||!Number.isSafeInteger(active.startY)||!Number.isSafeInteger(active.elapsed)||active.elapsed<0||active.elapsed>=a.climbTicks||![-1,1].includes(active.side))return fail('invalidState','ledge attachment fields');
  grip=geometry.grips.find(g=>g.id===active.traversalId&&g.side===active.side);
  if(!grip)return fail('unsupported','stale or unsupported ledge attachment');
  const expected=active.startY+Number(BigInt(grip.y-active.startY)*BigInt(active.elapsed)/BigInt(a.climbTicks-1));
  if(old.mode!=='air'||old.supportId!==null||old.x!==grip.x-grip.side*w.half||old.y!==expected||active.startY<=grip.y||active.startY-w.profile.grabHeight*256<grip.y-a.grabReach*256||active.startY-w.profile.grabHeight*256>grip.y+a.grabReach*256)return fail('invalidState','ledge attachment pose/reach');
 }
 if(!active&&old.mode==='air'&&old.vy>=0&&!input.jump&&!input.drop&&!input.dash&&!(old as DashState).dash?.active&&(input.moveY??0)===-1){
  grip=geometry.grips.find(g=>input.moveX===g.side&&old.x===g.x-g.side*w.half&&old.y>g.y&&Math.abs(old.y-w.profile.grabHeight*256-g.y)<=a.grabReach*256&&old.x>=g.region[0]!*256&&old.x<=(g.region[0]!+g.region[2]!)*256&&old.y>=g.region[1]!*256&&old.y<=(g.region[1]!+g.region[3]!)*256);
 }
 const ordinary=()=>{const f=baseStep(base,plain,input);return f.status==='ok'?{...f,state:{...f.state,...initialLedge(w.profile)}}:{...f,state:old};};
 if(!grip)return ordinary();
 // A stationary core tick validates all lower adapter resources and input-edge state.
 const still={...base,profile:{...profile,ground:{...profile.ground,acceleration:0,braking:0},air:{...profile.air,acceleration:0,gravity:0}}};
 const valid=baseStep(still,{...plain,vx:0,vy:0},{moveX:0,moveY:0,run:false,jump:false,drop:false,dash:false});
 if(valid.status!=='ok')return {...valid,state:old};
 const stamina=(old as WallState).wall?.staminaTicks;
 if(stamina!==undefined&&stamina<1)return ordinary();
 if(active&&((input.moveY??0)!==-1||input.drop||input.jump||input.dash||input.moveX!==active.side))return {...valid,state:{...valid.state,...initialLedge(w.profile)}};
 const elapsed=active?active.elapsed+1:0,startY=active?.startY??old.y,done=elapsed===a.climbTicks;
 const x=done?grip.x+grip.side*w.half:old.x,y=done?grip.y:startY+Number(BigInt(grip.y-startY)*BigInt(elapsed)/BigInt(a.climbTicks-1));
 if(!clear(w,old,x,y))return fail('unsupported','ledge lift/transfer full-body clearance blocked');
 const stance=done?resolveStance(w,x,grip.supportId).find(v=>v.y===y):undefined;
 if(done&&!stance)return fail('unsupported','ledge landing lacks full-footprint support');
 let next:State={...valid.state,x,y,vx:done?0:x-old.x,vy:done?0:y-old.y,mode:done?'ground':'air',supportId:done?grip.supportId:null,planeId:stance?.face.planeId??old.planeId,facing:grip.side,jumpHeldPrev:input.jump};
 if(done){const grounded=baseStep(still,{...plain,...next,tick:old.tick,vx:0,vy:0},input);if(grounded.status!=='ok')return {...grounded,state:old};next=grounded.state;}
 const wall=(next as WallState).wall;if(wall)next={...next,wall:{...wall,staminaTicks:done?wall.staminaTicks:stamina!-1,contact:wallContact(w,next),action:null}} as WallState;
 return {status:'ok',state:{...next,ledge:{attachment:done?null:{traversalId:grip.id,startY,elapsed,side:grip.side},action:active?'ledgeClimb':'ledgeGrab',actionRef:a.action}} as LedgeState,contacts:[]};
}
