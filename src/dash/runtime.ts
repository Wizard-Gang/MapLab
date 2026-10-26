// Qualified horizontal dash module. Source geometry and the frozen RC4 core stay authoritative.
import {step as jumpStep,airJumpCount,supportedJumpProfile as jumpSupported} from '../air-jumps/runtime';
import type {Ability,MovementDocument} from '../contracts/movement-types';
import type {World,State,Input,Step} from '../physics-reference';
export {airJumpCount};
export type DashInput=Input&{readonly dash?:boolean};
export type DashRunInput=DashInput&{readonly fromTick:number};
type Mode='ground'|'air';
type Definition=Extract<Ability,{kind:'dash'}>;
export interface DashProgress {readonly held:boolean;readonly remaining:Readonly<Record<Mode,number>>;readonly active:{readonly mode:Mode;readonly direction:-1|1;readonly ticksLeft:number}|null}
export type DashState=State&{readonly dash?:DashProgress};
export const dashDefinitions=(p:MovementDocument)=>p.abilities.filter((a):a is Definition=>a.kind==='dash');
export const hasDash=(p:MovementDocument)=>dashDefinitions(p).length>0;
export function supportedJumpProfile(p:MovementDocument):boolean {
 const definitions=dashDefinitions(p);
 return jumpSupported({...p,abilities:p.abilities.filter(a=>a.kind!=='dash')})&&definitions.every(a=>a.charges<=16&&a.durationTicks<=3600&&a.cooldownTicks<=36000)&&new Set(definitions.map(a=>a.mode)).size===definitions.length;
}
export function initialDash(p:MovementDocument):{dash?:DashProgress} {
 if(!hasDash(p))return {};
 return {dash:{held:false,active:null,remaining:{ground:dashDefinitions(p).find(a=>a.mode==='ground')?.charges??0,air:dashDefinitions(p).find(a=>a.mode==='air')?.charges??0}}};
}
export function initialResources(p:MovementDocument):NonNullable<State['resources']> {
 const d=initialDash(p).dash;
 return {airJumps:airJumpCount(p),dashCharges:d?d.remaining.ground+d.remaining.air:0,cooldowns:Object.fromEntries(dashDefinitions(p).map(a=>['dash.'+a.mode,0]))};
}
const keys=(v:object)=>Object.keys(v).sort().join(',');
const count=(n:unknown,max:number)=>Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=max;
/** Call only with a validated complete runtime state. Detection precedes same-tick reset. */
export function dashStarts(p:MovementDocument,s:State,input:DashInput):boolean {
 const d=(s as DashState).dash,a=dashDefinitions(p).find(a=>a.mode===s.mode);
 return !!(d&&a&&!d.active&&!d.held&&input.dash&&(input.moveY??0)===0&&s.resources!.cooldowns['dash.'+a.mode]!<=1&&(d.remaining[a.mode]>0||a.reset==='timer'));
}
/** Dash has a rising input edge, horizontal direction (moveX, otherwise facing), and
 * exactly durationTicks swept movement ticks unless a blocking contact stops it.
 * Dash gravity scales acceleration, preserving incoming vertical velocity. Jump/drop
 * do not interrupt an active dash; climb requests have priority before dash starts.
 * Each mode owns its charges/cooldown; dashCharges is their checked aggregate.
 */
export function step(world:World,old:State,input:DashInput):Step {
 const {dash:button=false,...control}=input,definitions=dashDefinitions(world.profile),state=old as DashState;
 const fail=(status:Step['status'],reason:string):Step=>({status,state:old,contacts:[],reason});
 if(typeof button!=='boolean')return fail('invalidState','dash input');
 if(!definitions.length){if(state.dash!==undefined)return fail('invalidState','dash state without capability');return jumpStep(world,old,control);}
 if(!supportedJumpProfile(world.profile))return fail('unsupported','dash adapter capability budget');
 if(![-1,0,1].includes(control.moveX)||typeof control.run!=='boolean'||old.traversalId!==undefined&&![-1,0,1].includes(control.moveY!)||old.jumpHeldPrev!==undefined&&(typeof control.jump!=='boolean'||typeof control.drop!=='boolean'))return fail('invalidState','original dash controls');
 const d=state.dash,r=old.resources;
 if(!d||keys(d)!=='active,held,remaining'||typeof d.held!=='boolean'||!d.remaining||keys(d.remaining)!=='air,ground'||!r||keys(r)!=='airJumps,cooldowns,dashCharges'||!r.cooldowns||Array.isArray(r.cooldowns)||keys(r.cooldowns)!==definitions.map(a=>'dash.'+a.mode).sort().join(','))return fail('invalidState','complete dash resources required');
 for(const mode of ['ground','air'] as const){const a=definitions.find(a=>a.mode===mode);if(!count(d.remaining[mode],a?.charges??0)||a&&!count(r.cooldowns['dash.'+mode],a.cooldownTicks))return fail('invalidState','dash resource bounds');}
 if(r.dashCharges!==d.remaining.ground+d.remaining.air)return fail('invalidState','dash charge aggregate');
 const active=d.active;
 if(active!==null&&(!active||keys(active)!=='direction,mode,ticksLeft'||![-1,1].includes(active.direction)||!definitions.some(a=>a.mode===active.mode&&count(active.ticksLeft,a.durationTicks-1)&&active.ticksLeft>0)))return fail('invalidState','dash duration/state');
 if(active&&old.mode==='climb')return fail('invalidState','dash while attached');
 if(![old.vx,old.vy,old.x,old.y,old.tick].every(Number.isSafeInteger))return fail('unsafeInteger','non-integer original dash state');
 const remaining={...d.remaining},cooldowns={...r.cooldowns};
 for(const a of definitions){const key='dash.'+a.mode;cooldowns[key]=Math.max(0,cooldowns[key]!-1);if(a.reset==='timer'&&cooldowns[key]===0)remaining[a.mode]=a.charges;}
 const candidate=definitions.find(a=>a.mode===old.mode);
 const starting=dashStarts(world.profile,old,input)&&candidate;
 let action=active;
 if(starting){remaining[candidate.mode]--;cooldowns['dash.'+candidate.mode]=candidate.cooldownTicks;action={mode:candidate.mode,direction:control.moveX||old.facing,ticksLeft:candidate.durationTicks};}
 const {dash:_,...plain}=state;
 let profile:MovementDocument={...world.profile,abilities:world.profile.abilities.filter(a=>a.kind!=='dash')};
 let selected:State={...plain,resources:{...r,dashCharges:0,cooldowns:{}}},chosen:Input=control;
 if(action){
  const a=definitions.find(a=>a.mode===action!.mode)!;
  const gravity=Number(BigInt(profile.air.gravity)*BigInt(a.gravity.num)/BigInt(a.gravity.den));
  if(!Number.isSafeInteger(gravity))return fail('unsafeInteger','dash gravity');
  profile={...profile,ground:{...profile.ground,acceleration:0,braking:0},air:{...profile.air,acceleration:0,gravity},abilities:profile.abilities.map(b=>b.kind==='jump'?{...b,holdTicks:0,release:{num:1,den:1}}:b)};
  selected={...selected,vx:action.direction*a.speed};
  chosen={...control,moveX:action.direction,moveY:0,jump:false,drop:false};
 }
 const frame=jumpStep({...world,profile},selected,chosen);if(frame.status!=='ok')return {...frame,state:old};
 for(const a of definitions)if(a.reset==='ground'&&frame.state.mode==='ground')remaining[a.mode]=a.charges;
 const stopped=action&&(frame.contacts.some(c=>c.kind==='blocking')||action.ticksLeft===1);
 const next:DashState={...frame.state,...(action?{jumpHeldPrev:control.jump}:{}),resources:{...frame.state.resources!,dashCharges:remaining.ground+remaining.air,cooldowns},dash:{held:button,remaining,active:action&&!stopped?{...action,ticksLeft:action.ticksLeft-1}:null}};
 return {...frame,state:next};
}
