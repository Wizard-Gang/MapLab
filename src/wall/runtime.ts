// Qualified vertical-face wall module over the frozen dash/jump/contact adapters.
import {step as dashStep,supportedJumpProfile as dashSupported,dashStarts,type DashState} from '../dash/runtime';
import {climbTick} from '../physics-reference/climb';
import type {MovementDocument} from '../contracts/movement-types';
import {replayBytes,type World,type State,type Step} from '../physics-reference';
import type {DashInput} from '../dash/runtime';
export {airJumpCount,hasDash,dashStarts,initialDash,initialResources} from '../dash/runtime';
export type {DashInput,DashRunInput,DashState} from '../dash/runtime';
type Definition=Extract<MovementDocument['abilities'][number],{kind:'wall'}>;
export type WallAction='wallSlide'|'wallJump'|'wallClimb';
export interface WallContact {readonly bodyId:string;readonly shapeId:string;readonly edgeIndex:number;readonly side:-1|1}
export interface WallProgress {readonly staminaTicks:number;readonly launched:boolean;readonly contact:WallContact|null;readonly action:WallAction|null}
export type WallState=State&{readonly wall?:WallProgress};
export const wallDefinition=(p:MovementDocument):Definition|undefined=>p.abilities.find((a):a is Definition=>a.kind==='wall');
export const hasWall=(p:MovementDocument)=>!!wallDefinition(p);
export function supportedJumpProfile(p:MovementDocument):boolean {
 const a=wallDefinition(p);
 return dashSupported({...p,abilities:p.abilities.filter(a=>a.kind!=='wall')})&&(!a||p.abilities.filter(a=>a.kind==='wall').length===1&&a.staminaTicks<=36000&&a.jumpImpulse[0]>=0&&a.jumpImpulse[1]<=0);
}
export const initialWall=(p:MovementDocument):{wall?:WallProgress}=>{const a=wallDefinition(p);return a?{wall:{staminaTicks:a.staminaTicks,launched:false,contact:null,action:null}}:{};};
/** Only actual, mask-compatible blocking vertical faces qualify. One-way supports and
 * decorative/traversal artwork never become walls. Stable world face order breaks ties.
 */
export function wallContact(w:World,s:State):WallContact|null {
 if(s.mode!=='air')return null;
 for(const f of w.faces){
  if(!f.bodyId||f.support||f.a[0]!==f.b[0]||s.y<=Math.min(f.a[1],f.b[1])||s.y-w.height>=Math.max(f.a[1],f.b[1]))continue;
  if(w.source.materials.find(m=>m.id===f.materialId)?.tags.some(t=>w.profile.forbiddenMaterialTags.includes(t)))continue;
  const side=s.x+w.half===f.a[0]?1:s.x-w.half===f.a[0]?-1:0;
  if(side&&(f.twoSided||f.normal[0]*side<0))return {bodyId:f.bodyId,shapeId:f.shapeId,edgeIndex:f.edgeIndex,side};
 }
 return null;
}
const keys=(v:object)=>Object.keys(v).sort().join(',');
/** Push into a wall to slide; push + vertical input to climb; a rising jump edge
 * launches outward. Each wall-action tick consumes one stamina tick, including
 * a jump. Only ground contact resets stamina. Releasing or swapping walls does not.
 * Climb-path attachment and an active/new dash take precedence over wall actions.
 */
export function step(w:World,old:State,input:DashInput):Step {
 const a=wallDefinition(w.profile),s=old as WallState;
 const fail=(status:Step['status'],reason:string):Step=>({status,state:old,contacts:[],reason});
 if(!a){if(s.wall!==undefined)return fail('invalidState','wall state without capability');return dashStep(w,old,input);}
 if(!supportedJumpProfile(w.profile))return fail('unsupported','wall module capability budget or launch convention');
 const wall=s.wall;
 if(!wall||keys(wall)!=='action,contact,launched,staminaTicks'||typeof wall.launched!=='boolean'||!Number.isSafeInteger(wall.staminaTicks)||wall.staminaTicks<0||wall.staminaTicks>a.staminaTicks||![null,'wallSlide','wallJump','wallClimb'].includes(wall.action))return fail('invalidState','complete wall resources required');
 const contact=wallContact(w,old);
 if(wall.contact!==null&&(!wall.contact||keys(wall.contact)!=='bodyId,edgeIndex,shapeId,side'||replayBytes(wall.contact)!==replayBytes(contact)))return fail('invalidState','stale wall side/contact');
 const {wall:_,...plain}=s,profile={...w.profile,abilities:w.profile.abilities.filter(a=>a.kind!=='wall')},base={...w,profile};
 let stamina=old.mode==='ground'?a.staminaTicks:wall.staminaTicks,action:WallAction|null=null;
 const d=(old as DashState).dash;
 if(contact&&stamina>0&&old.mode==='air'&&!d?.active&&!dashStarts(profile,old,input)){
  const into=input.moveX===contact.side;
  if(input.jump&&!old.jumpHeldPrev&&a.permissions.includes('jump'))action='wallJump';
  else if(into&&(input.moveY??0)!==0&&a.permissions.includes('climb'))action='wallClimb';
  else if(into&&old.vy>=0&&a.permissions.includes('slide'))action='wallSlide';
 }
 let frame:Step;
 if(action){
  // A stationary validation tick checks the original structural/contact state;
  // the discarded ordinary falling trajectory must not gate a wall launch.
  if(![old.vx,old.vy].every(Number.isSafeInteger))return fail('unsafeInteger','original wall velocity');
  if(![-1,0,1].includes(input.moveX)||![-1,0,1].includes(input.moveY??0)||typeof input.run!=='boolean'||typeof input.jump!=='boolean'||typeof input.drop!=='boolean'||input.dash!==undefined&&typeof input.dash!=='boolean')return fail('invalidState','original wall controls');
  if(Object.keys(input).some(k=>!['moveX','moveY','run','jump','drop','dash'].includes(k)))return fail('unsupported','wall input subset');
  const stationaryProfile={...profile,ground:{...profile.ground,acceleration:0,braking:0},air:{...profile.air,acceleration:0,gravity:0}};
  const valid=dashStep({...base,profile:stationaryProfile},{...plain,vx:0,vy:0},{moveX:0,...(old.traversalId!==undefined?{moveY:0 as const}:{}),run:false,jump:false,drop:false});
  if(valid.status!=='ok')return {...valid,state:old};
  const climbed=climbTick(base,plain,input,(s,i)=>dashStep(base,s,i));
  if(climbed){frame=dashStep(base,plain,input);action=null;}
  else{
   stamina--;
   const jump=action==='wallJump',vx=jump?-contact!.side*a.jumpImpulse[0]:0,vy=jump?a.jumpImpulse[1]:action==='wallClimb'?(input.moveY??0)*a.climbSpeed:Math.min(old.vy,a.slideMaxSpeed);
   const selected={...plain,vx,vy,jumpHeldPrev:true,jumpReleased:jump?false:old.jumpReleased!,ticksSinceJump:jump?0:old.ticksSinceJump!};
   const temporary:MovementDocument={...profile,ground:{...profile.ground,acceleration:0,braking:0},air:{...profile.air,acceleration:0,...(!jump?{gravity:0}:{})},abilities:profile.abilities.map(b=>b.kind==='jump'?{...b,holdTicks:0,release:{num:1,den:1}}:b)};
   frame=dashStep({...base,profile:temporary},selected,{...input,moveX:jump?(contact!.side===1?-1:1):0,moveY:0,jump:false,drop:false});
   if(frame.status==='ok')frame={...frame,state:{...frame.state,jumpHeldPrev:input.jump,...(jump?{jumpReleased:false}:{})}};
  }
 }else frame=dashStep(base,plain,input);
 if(frame.status!=='ok')return {...frame,state:old};
 const next:WallState={...frame.state,wall:{launched:frame.state.mode!=='ground'&&(wall.launched||action==='wallJump'),staminaTicks:frame.state.mode==='ground'?a.staminaTicks:stamina,contact:wallContact(w,frame.state),action}};
 return {...frame,state:next};
}
