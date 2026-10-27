import type {Call,MovementDocument} from '../contracts';
import {digest} from '../physics-reference';
import {own} from '../flight/controller';
export const MODIFIER={key:'maplab.modifier.kinematic',version:1} as const;
export const FIELDS=['ground.walkSpeed','ground.runSpeed','ground.acceleration','ground.braking','air.gravity','air.maxFall','air.acceleration','air.maxSpeed'] as const;
export type Field=typeof FIELDS[number];
export interface ActiveModifier {readonly id:string;readonly key:typeof MODIFIER.key;readonly version:1;readonly field:Field;readonly num:number;readonly den:number;readonly ticksLeft:number}
export const keys=(v:object)=>Object.keys(v).sort().join(',');
const small=(n:number,lo:number,hi:number)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
export function validModifiers(values:readonly ActiveModifier[]):boolean {
 return Array.isArray(values)&&values.length<=8&&new Set(values.map(v=>v?.id)).size===values.length&&values.every(v=>v&&keys(v)==='den,field,id,key,num,ticksLeft,version'&&/^[a-z0-9][a-z0-9._:-]{0,95}$/.test(v.id)&&v.key===MODIFIER.key&&v.version===1&&FIELDS.includes(v.field)&&small(v.num,0,16)&&small(v.den,1,16)&&small(v.ticksLeft,1,600));
}
export function applyModifier(p:MovementDocument,active:readonly ActiveModifier[],id:string,call:Call):readonly ActiveModifier[] {
 const ability=p.abilities.find(a=>a.kind==='modifier');
 if(!ability||call.key!==MODIFIER.key||call.version!==1||keys(call)!=='key,params,version'||!ability.allowed.some(r=>r.key===call.key&&r.version===call.version))throw Error('Unsupported modifier contract or permission');
 const {field,num,den,durationTicks}=call.params;
 if(keys(call.params)!=='den,durationTicks,field,num'||typeof field!=='string'||!FIELDS.includes(field as Field)||typeof num!=='number'||typeof den!=='number'||typeof durationTicks!=='number')throw Error('Invalid modifier parameters');
 const next:ActiveModifier={id,key:MODIFIER.key,version:1,field:field as Field,num,den,ticksLeft:durationTicks};
 const remaining=active.filter(v=>v.id!==id&&(ability.stacking!=='replace'||v.field!==field));
 const result=[...remaining,next].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 if(!validModifiers(result))throw Error('Invalid modifier state/budget');return own(result);
}
export const ageModifiers=(active:readonly ActiveModifier[])=>active.filter(v=>v.ticksLeft>1).map(v=>({...v,ticksLeft:v.ticksLeft-1}));
/** Multiply exact rationals, truncate once, then clamp to [0,8192] su. Collider,
 * abilities and geometry never change. Expiry is runtime state, not authored data. */
export function effectiveProfile(p:MovementDocument,active:readonly ActiveModifier[]):MovementDocument {
 if(!validModifiers(active))throw Error('Invalid active modifiers');
 const ability=p.abilities.find(a=>a.kind==='modifier');
 if(active.length&&(!ability||!ability.allowed.some(r=>r.key===MODIFIER.key&&r.version===1)))throw Error('Unsupported active modifier');
 if(ability?.stacking==='replace'&&new Set(active.map(v=>v.field)).size!==active.length)throw Error('Invalid replacement stack');
 const ground={...p.ground},air={...p.air};
 for(const field of FIELDS){const [group,name]=field.split('.') as ['ground'|'air',string],base=(p[group] as unknown as Record<string,number>)[name]!;let n=BigInt(base),d=1n;
  for(const v of active.filter(v=>v.field===field)){n*=BigInt(v.num);d*=BigInt(v.den);}
  const value=Number(n/d>8192n?8192n:n/d);((group==='ground'?ground:air) as unknown as Record<string,number>)[name]=value;
 }
 return own({...p,ground,air});
}
export async function effectiveProfileHash(p:MovementDocument,active:readonly ActiveModifier[]):Promise<string>{
 const sorted=[...active].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);return digest({profile:effectiveProfile(p,sorted),active:sorted});
}
