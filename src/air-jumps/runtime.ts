// RC4 airborne-jump adapter over the frozen contact/jump controller.
// Authored profiles and worlds stay unchanged; the base receives its supported zero-charge view.
import {step as baseStep,type World,type State,type Input,type Step} from '../physics-reference';
import {climbTick} from '../physics-reference/climb';
import type {MovementDocument} from '../contracts/movement-types';
export const MAX_ADDITIONAL_AIR_JUMPS=16;
export const airJumpCount=(p:MovementDocument):number=>p.abilities.find(a=>a.kind==='jump')?.airJumps??0;
export const supportedJumpProfile=(p:MovementDocument):boolean=>Number.isSafeInteger(airJumpCount(p))&&airJumpCount(p)>=0&&airJumpCount(p)<=MAX_ADDITIONAL_AIR_JUMPS&&p.abilities.every(a=>a.kind==='jump'||a.kind==='climb');
function baseProfile(p:MovementDocument):MovementDocument {
 return {...p,abilities:p.abilities.map(a=>a.kind==='jump'?{...a,airJumps:0}:a)};
}
/** Additional jumps consume one charge on a rising input edge. Holding cannot repeat.
 * Ground contact refills; ground departure, climbing, ceilings and apexes do not.
 * Failed steps return the original state atomically, including its resource object.
 */
export function step(world:World,old:State,input:Input):Step {
 const maximum=airJumpCount(world.profile);if(maximum===0)return baseStep(world,old,input);
 const fail=(status:Step['status'],reason:string):Step=>({status,state:old,contacts:[],reason});
 if(!supportedJumpProfile(world.profile))return fail('unsupported','airborne-jump adapter capability budget');
 const r=old.resources;
 if(!r||!Number.isSafeInteger(r.airJumps)||r.airJumps<0||r.airJumps>maximum)return fail('invalidState','air-jump charges outside profile bounds');
 const base={...world,profile:baseProfile(world.profile)},sanitized={...old,resources:{...r,airJumps:0}};
 const jump=world.profile.abilities.find(a=>a.kind==='jump')!;
 let remaining=old.mode==='ground'?maximum:r.airJumps;
 const pressed=old.mode==='air'&&input.jump&&!old.jumpHeldPrev&&remaining>0;
 // Only these old fields are replaced. Validate them without running the discarded fall trajectory.
 if(pressed&&!Number.isSafeInteger(old.vy))return fail('unsafeInteger','non-integer original velocity');
 if(pressed&&(!Number.isSafeInteger(old.ticksSinceJump)||old.ticksSinceJump!<0||typeof old.jumpReleased!=='boolean'))return fail('invalidState','locomotion state/input');
 const selected=pressed?{...sanitized,vy:-jump.airborneImpulse,ticksSinceJump:0,jumpReleased:false}:sanitized;
 const frame=baseStep(base,selected,input);if(frame.status!=='ok')return {...frame,state:old};
 if(pressed){
  // The base validates first and gives climb attachment/detachment RC4 priority.
  // A handled climb transition keeps its charge and its own impulse.
  const climbed=climbTick(base,selected,input,(s,i)=>baseStep(base,s,i));
  if(!climbed)remaining--;
 }
 return {...frame,state:{...frame.state,resources:{...r,airJumps:frame.state.mode==='ground'?maximum:remaining}}};
}
