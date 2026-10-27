// Bounded static volume motor. Authored links provide anchors, never displacement.
import type {MapDocument,MovementDocument} from '../contracts';
import {FlightWorld,covered,own,type FlightState,type FlightInput,type Rect} from '../flight/controller';
import {createWorld,resolveStance,overlaps,type State} from '../physics-reference';
import {sweep} from '../physics-reference/controller';
import {flightAnchor} from '../flight/planner';
export type Mode='ground'|'swim'|'fly';
export interface ModeState {readonly x:number;readonly y:number;readonly vx:number;readonly vy:number;readonly tick:number;readonly mode:Mode|'transition';readonly supportId:string|null}
export interface ModeControl extends FlightInput {}
export interface ModeFrame {readonly state:ModeState;readonly action:string|null;readonly input:ModeControl}
export interface Transition {readonly id:string;readonly from:Mode;readonly to:Mode;readonly a:readonly [number,number];readonly b:readonly [number,number]}
export class ModeWorld {
 readonly map:MapDocument;readonly profile:MovementDocument;readonly collision:ReturnType<typeof createWorld>;
 readonly motors=new Map<'swim'|'fly',FlightWorld>();readonly transitions:readonly Transition[];
 constructor(source:MapDocument,profile:MovementDocument){
  this.map=own(source);this.profile=own(profile);this.collision=createWorld(source as never,profile);
  if(profile.abilities.some(a=>!['swim','fly'].includes(a.kind))||!profile.abilities.length)throw Error('Unsupported mode profile: swim/fly abilities only');
  if(source.bodies.some(b=>b.enabled&&(b.mobility!=='static'||b.motion)))throw Error('Static mode world required');
  if(source.materials.some(m=>m.tags.some(t=>profile.forbiddenMaterialTags.includes(t))))throw Error('Unsupported restricted mode material');
  for(const ability of profile.abilities){
   if(ability.kind!=='swim'&&ability.kind!=='fly')continue;
   if(ability.kind==='swim'&&Math.abs(profile.air.gravity-ability.buoyancy)>ability.acceleration)throw Error('Unsupported swim drift exceeds compensation acceleration');
   const volumes=source.navigation.modeVolumes.filter(v=>v.mode===ability.kind&&v.profileIds.includes(profile.id));
   if(ability.kind==='swim'&&!volumes.length)throw Error('Swimming requires a matching volume union');
   const a=ability.kind==='fly'?ability:{kind:'fly' as const,version:1 as const,speed:ability.speed,acceleration:ability.acceleration,turnAcceleration:ability.acceleration,hover:true};
   const map={...source,navigation:{...source.navigation,links:[],modeVolumes:volumes.map(v=>({...v,mode:'fly' as const}))}};
   this.motors.set(ability.kind,new FlightWorld(map,{...profile,abilities:[a]}));
  }
  const transitions:Transition[]=[];
  for(const link of source.navigation.links){
   const p=link.action.params,from=p.fromMode,to=p.toMode;
   if(link.action.key!=='core.mode.transition'||link.action.version!==1||Object.keys(p).sort().join(',')!=='fromMode,toMode'||!['ground','swim','fly'].includes(String(from))||!['ground','swim','fly'].includes(String(to))||from===to||link.conditions.length||link.extraCostTicks!==0||link.requiredAbilities.some(a=>!profile.abilityTags.includes(a)))throw Error('Unsupported mode transition action/conditions/permissions');
   const t={id:link.id,from:from as Mode,to:to as Mode,a:flightAnchor(source,link.from),b:flightAnchor(source,link.to)};
   if(t.a[0]!==t.b[0]&&t.a[1]!==t.b[1]||t.a[0]===t.b[0]&&t.a[1]===t.b[1])throw Error('Mode transitions require distinct cardinal anchors');
   transitions.push(t);if(link.bidirectional)transitions.push({id:link.id+':reverse',from:t.to,to:t.from,a:t.b,b:t.a});
  }
  if(new Set(transitions.map(t=>t.id)).size!==transitions.length)throw Error('Duplicate mode transition action identity');
  this.transitions=own(transitions.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0));
 }
 footprint(x:number,y:number):Rect {const w=this.collision;return [x-w.half,y-w.height,w.half*2,w.height];}
 ground(x:number,y:number):string|null {
  if(overlaps(this.collision,x,y))return null;
  return resolveStance(this.collision,x).find(s=>s.y===y&&s.face.registered&&s.face.a[1]===s.face.b[1])?.face.supportId??null;
 }
 valid(s:ModeState):boolean {
  if(Object.keys(s).sort().join(',')!=='mode,supportId,tick,vx,vy,x,y'||![s.x,s.y,s.vx,s.vy,s.tick].every(Number.isSafeInteger)||s.tick<0||s.tick>=Number.MAX_SAFE_INTEGER)return false;
  if(s.mode==='ground')return s.vx===0&&s.vy===0&&s.supportId!==null&&this.ground(s.x,s.y)===s.supportId&&covered(this.footprint(s.x,s.y),[this.map.bounds.map(n=>n*256) as unknown as Rect]);
  if(s.mode!=='swim'&&s.mode!=='fly')return false;
  const m=this.motors.get(s.mode);return !!m&&s.supportId===null&&m.valid({...s,mode:'fly'})&&m.safe(s.x,s.y);
 }
 step(s:ModeState,u:ModeControl):ModeState|null {
  if(!this.valid(s)||s.mode!=='swim'&&s.mode!=='fly')return null;
  const m=this.motors.get(s.mode)!,a=this.profile.abilities.find(a=>a.kind==='swim');
  const drift=s.mode==='swim'&&a?.kind==='swim'?this.profile.air.gravity-a.buoyancy:0;
  const vy=Math.max(-m.speed+Math.abs(s.vx),Math.min(m.speed-Math.abs(s.vx),s.vy+drift));
  const f=m.step({...s,vy,mode:'fly'},u);if(f.status!=='ok')return null;
  const next={...f.state,mode:s.mode,supportId:null};return this.valid(next)?own(next):null;
 }
 /** Rest-to-rest straight transition; every intermediate sweep is inside the union
  * of the two mode domains. A dry endpoint contributes only its standing body. */
 transition(s:ModeState,t:Transition,maxTicks:number):readonly ModeFrame[]|null {
  if(!Number.isSafeInteger(maxTicks)||maxTicks<1||maxTicks>600||!Number.isSafeInteger(s.tick+maxTicks)||s.tick+maxTicks>=Number.MAX_SAFE_INTEGER)return null;
  if(!this.valid(s)||s.mode!==t.from||s.x!==t.a[0]||s.y!==t.a[1]||s.vx||s.vy)return null;
  const moving=t.from==='ground'?t.to:t.from;if(moving==='ground')return null;
  const motor=this.motors.get(moving);if(!motor)return null;
  const swim=this.profile.abilities.find(a=>a.kind==='swim');
  if(moving==='swim'&&swim?.kind==='swim'&&swim.buoyancy!==this.profile.air.gravity)return null;
  const end:ModeState={x:t.b[0],y:t.b[1],vx:0,vy:0,tick:s.tick,mode:t.to,supportId:t.to==='ground'?this.ground(...t.b):null};
  if(!this.valid(end))return null;
  // A supported shoreline is horizontal. Vertical water breach is bounded by its impulse.
  const horizontal=t.a[1]===t.b[1],limit=moving==='swim'&&!horizontal&&t.to==='ground'&&swim?.kind==='swim'?Math.min(motor.speed,swim.breachImpulse):motor.speed;
  if(!horizontal&&moving==='swim'&&t.from==='ground'||limit<1)return null;
  const domains=(mode:Mode,p:readonly [number,number]):readonly Rect[]=>mode==='ground'?[this.footprint(...p)]:this.motors.get(mode)?.volumes??[];
  const union=[...domains(t.from,t.a),...domains(t.to,t.b)],frames:ModeFrame[]=[];
  let state:FlightState={...s,mode:'fly'};
  for(let n=0;n<maxTicks;n++){
   const remaining=Math.abs(horizontal?t.b[0]-state.x:t.b[1]-state.y),sign=Math.sign(horizontal?t.b[0]-state.x:t.b[1]-state.y);
   if(!remaining&&!state.vx&&!state.vy)return frames.length?own(frames):null;
   const stop=(v:number)=>{const k=Math.max(0,Math.floor((v-1)/motor.acceleration));return k*v-motor.acceleration*k*(k+1)/2;};
   let lo=0,hi=Math.min(limit,remaining);while(lo<hi){const v=Math.ceil((lo+hi)/2);if(v+stop(v)<=remaining)lo=v;else hi=v-1;}
   const u={targetVx:horizontal?(sign*lo||0):0,targetVy:horizontal?0:(sign*lo||0)},[vx,vy]=motor.velocity(state,u),x=state.x+vx,y=state.y+vy;
   if((horizontal?t.b[0]-x:t.b[1]-y)*sign<0||Math.abs(vx)+Math.abs(vy)>limit)return null;
   const r=this.footprint(Math.min(state.x,x),Math.min(state.y,y)),rect:Rect=[r[0],r[1],r[2]+Math.abs(vx),r[3]+Math.abs(vy)];
   if(!covered(rect,union)||!covered(rect,[motor.bound])||overlaps(motor.world,x,y))return null;
   const contact={...state,mode:'air',supportId:null} as unknown as State;
   if(sweep(motor.world,contact,horizontal?0:1,horizontal?vx:vy,true).some(h=>h.coordinate!==(horizontal?x:y)))return null;
   state={x,y,vx,vy,tick:state.tick+1,mode:'fly'};
   const done=x===end.x&&y===end.y&&vx===0&&vy===0;
   frames.push({state:{...state,mode:done?t.to:'transition',supportId:done?end.supportId:null},action:t.id,input:u});
   if(done)return own(frames);
  }
  return null;
 }
}
