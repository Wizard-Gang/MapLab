// Explicit declarative Test subset. Never an engine AI/combat/script executor.
import type {MapDocument,CatalogDocument} from '../contracts/document-types';
import type {Call,Condition,ContractRef} from '../contracts/common-types';
import {validateSourceGraph,type JsonValue} from '../contracts';
function deepFreeze<T>(v:T):T{if(v&&typeof v==='object'){for(const child of Object.values(v))deepFreeze(child);Object.freeze(v);}return v;}
import {sensorSpans,type Pose} from './sensors';
export interface SensorActor {readonly id:string;readonly category:'player'|'enemy'|'npc';readonly from:Pose;readonly to:Pose;readonly width:number;readonly height:number;readonly abilities:readonly string[]}
export interface SensorEvent {readonly tick:number;readonly time:number;readonly actorId:string;readonly triggerId:string;readonly event:'enter'|'exit'|'interact';readonly condition:'passed'|'blocked'|'unsupported'}
export interface ActionEvent {readonly tick:number;readonly ownerId:string;readonly key:string;readonly status:'applied'|'configured, not simulated';readonly detail:string}
export interface GameplayView {readonly tick:number;readonly status:'ready'|'budget'|'unsupported';readonly diagnostics:readonly string[];readonly flags:Readonly<Record<string,boolean>>;readonly bodies:Readonly<Record<string,boolean>>;readonly entities:Readonly<Record<string,boolean>>;readonly encounters:Readonly<Record<string,'inactive'|'active'|'completed'>>;readonly once:readonly string[];readonly overlaps:readonly string[];readonly events:readonly SensorEvent[];readonly actions:readonly ActionEvent[]}
const own=<T>(v:T):T=>deepFreeze(structuredClone(v));
export class GameplaySession {
 readonly source:MapDocument;private view:GameplayView;private started=false;private readonly entries:CatalogDocument['entries'];
 constructor(map:MapDocument,sources:readonly JsonValue[]){
  const graph=validateSourceGraph([map as unknown as JsonValue,...sources.filter(s=>s&&typeof s==='object'&&!Array.isArray(s)&&s.id!==map.id)]);if(!graph.ok)throw Error('Gameplay source graph: '+graph.diagnostics.filter(d=>d.severity==='error').map(d=>d.message).join('; '));
  this.source=own(map);const allowed=new Set<string>([map.id]),pending=[map.id],docs=new Map(sources.filter(s=>s&&typeof s==='object'&&!Array.isArray(s)&&typeof s.id==='string').map(s=>[(s as {id:string}).id,s]));docs.set(map.id,map as unknown as JsonValue);
  while(pending.length){const d=docs.get(pending.pop()!) as unknown as {dependencies?:{id:string}[]};for(const dep of d?.dependencies??[])if(!allowed.has(dep.id)){allowed.add(dep.id);pending.push(dep.id);}}
  this.entries=own([...docs.values()].filter(s=>s&&typeof s==='object'&&!Array.isArray(s)&&s.format==='maplab.catalog'&&allowed.has(String(s.id))).flatMap(s=>(s as unknown as CatalogDocument).entries));
  const tooLarge=map.triggers.length>256||map.regions.reduce((n,r)=>n+(r.shape.kind==='polygon'?r.shape.points.length:4),0)>4096||map.regions.some(r=>r.shape.kind==='polygon'&&r.shape.points.length>256);
  this.view=own({tick:0,status:tooLarge?'budget':'ready',diagnostics:tooLarge?['Test sensor geometry budget']:[],flags:Object.fromEntries(map.flags.map(f=>[f.id,f.initial])),bodies:Object.fromEntries(map.bodies.map(b=>[b.id,b.enabled])),entities:Object.fromEntries(map.entities.map(e=>[e.id,e.enabled])),encounters:Object.fromEntries(map.encounters.map(e=>[e.id,'inactive' as const])),once:[],overlaps:[],events:[],actions:[]});
 }
 getSnapshot=():GameplayView=>this.view;
 private condition(c:Condition,a:SensorActor,v:GameplayView):boolean|null{
  if(c.kind==='flag')return Object.hasOwn(v.flags,c.id)?v.flags[c.id]===c.equals:null;
  if(c.kind==='ability')return a.abilities.includes(c.tag);
  if(c.kind==='entityState')return null; // No implicit engine state machine.
  if(c.kind==='not'){const result=this.condition(c.term,a,v);return result===null?null:!result;}
  const terms=c.terms.map(t=>this.condition(t,a,v));if(terms.includes(null))return null;return c.kind==='all'?terms.every(Boolean):terms.some(Boolean);
 }
 conditions(conditions:readonly Condition[],actor:SensorActor):'passed'|'blocked'|'unsupported'{const results=conditions.map(c=>this.condition(c,actor,this.view));return results.includes(null)?'unsupported':results.every(Boolean)?'passed':'blocked';}
 private apply(call:Call,ownerId:string,tick:number,v:GameplayView):GameplayView{
  let next=v,status:ActionEvent['status']='applied',detail='Test declarative subset';
  const definition=this.entries.find(e=>e.key===call.key&&e.version===call.version&&e.kind==='action');
  if(!definition)throw Error('Wrong or missing action handler kind');
  const ref=(key:string,kind:string)=>{const p=call.params[key];return typeof p==='object'&&p.ref.kind===kind&&!p.ref.mapId?p.ref.id:null;};
  if(call.key==='core.flag.set'&&call.version===1){const id=ref('flag','flag');if(!id||!Object.hasOwn(v.flags,id)||typeof call.params.value!=='boolean')throw Error('Invalid flag action');next={...v,flags:{...v.flags,[id]:call.params.value}};}
  else if(call.key==='core.body.set-enabled'&&call.version===1){const id=ref('target','body');if(!id||!Object.hasOwn(v.bodies,id)||typeof call.params.enabled!=='boolean')throw Error('Invalid body action');next={...v,bodies:{...v.bodies,[id]:call.params.enabled}};}
  else if(call.key==='core.encounter.activate'&&call.version===1){const id=ref('target','encounter'),e=this.source.encounters.find(e=>e.id===id);if(!e)throw Error('Invalid encounter action');if(v.encounters[e.id]==='inactive')next={...v,encounters:{...v.encounters,[e.id]:'active'},entities:{...v.entities,...Object.fromEntries(e.spawnIds.map(id=>[id,true]))}};else detail='Encounter already activated; no duplicate spawn';}
  else {status='configured, not simulated';detail='Engine-owned action; no handler executed';}
  return {...next,actions:[...next.actions,{tick,ownerId,key:call.key,status,detail}]};
 }
 /** Tick-zero spawn and later resolved-foot segments. Time-of-impact precedes actor/trigger ID ties; instance IDs own overlap sets.
  * Conditions observe the boundary snapshot; all action effects apply only after sensing. */
 sense(tick:number,actors:readonly SensorActor[],initial=false):void{
  if(this.view.status!=='ready')return;
  const old=this.view;try{
   if(tick>3600||actors.length>64)throw Error('Test sensor tick/actor budget');
   if(!Number.isSafeInteger(tick)||tick<0||(initial?this.started:!this.started||tick!==old.tick+1)||new Set(actors.map(a=>a.id)).size!==actors.length||actors.some(a=>!a.id||!['player','enemy','npc'].includes(a.category)||![a.from.x,a.from.y,a.to.x,a.to.y,a.width,a.height].every(Number.isSafeInteger)||a.width<=0||a.width%2||a.height<=0||!Array.isArray(a.abilities)||a.abilities.length>256||a.abilities.some(t=>typeof t!=='string')))throw Error('Invalid Test sensor tick/actor state');
   let work=0;
   const events:SensorEvent[]=[],overlaps:string[]=[],queue:{call:Call;owner:string}[]=[],once=new Set(old.once);
   for(const a of [...actors].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
    const candidates:SensorEvent[]=[];
    for(const t of [...this.source.triggers].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
     if(!t.actorCategories.includes(a.category))continue;const region=this.source.regions.find(r=>r.id===t.regionId)!;
     work+=region.shape.kind==='polygon'?region.shape.points.length**3:16;if(work>100000)throw Error('Test sensor work budget');
     const spans=sensorSpans(region.shape,initial?a.to:a.from,a.to,a.width,a.height),key=a.id+'\0'+t.id;
     const atEnd=spans.some(s=>s.lo<1&&s.hi>1);if(atEnd)overlaps.push(key);
     const push=(event:'enter'|'exit',time:number)=>{if(t.event!==event)return;const cs=t.conditions.map(c=>this.condition(c,a,old));candidates.push({tick,time,actorId:a.id,triggerId:t.id,event,condition:cs.includes(null)?'unsupported':cs.every(Boolean)?'passed':'blocked'});};
     if(initial){if(atEnd)push('enter',0);continue;}
     for(const span of spans){if(span.lo>=0&&span.lo<1)push('enter',Math.max(0,span.lo));if(span.hi>0&&span.hi<=1)push('exit',Math.min(1,span.hi));}
     // Starting exactly on a boundary is outside. An overlap retained from the prior
     // tick exits at t=0 when the new resolved segment immediately leaves it.
     if(old.overlaps.includes(key)&&!spans.some(s=>s.lo<=0&&s.hi>0))push('exit',0);
    }
    candidates.sort((a,b)=>a.time-b.time||(a.triggerId<b.triggerId?-1:a.triggerId>b.triggerId?1:0)||(a.event==='enter'?-1:1));
    events.push(...candidates);
   }
   events.sort((a,b)=>a.time-b.time||(a.actorId<b.actorId?-1:a.actorId>b.actorId?1:0)||(a.triggerId<b.triggerId?-1:a.triggerId>b.triggerId?1:0)||(a.event==='enter'?-1:1));
   for(const event of events){const t=this.source.triggers.find(t=>t.id===event.triggerId)!;if(event.condition!=='passed'||t.once&&once.has(t.id))continue;if(t.once)once.add(t.id);for(const call of t.actions)queue.push({call,owner:t.id});}
   if(old.events.length+events.length>10000||old.actions.length+queue.length>10000)throw Error('Test event budget');
   let next:GameplayView={...old,tick,overlaps,once:[...once].sort(),events:[...old.events,...events]};for(const q of queue)next=this.apply(q.call,q.owner,tick,next);this.view=own(next);this.started=true;
  }catch(e){this.view=own({...old,status:String(e).includes('budget')?'budget':'unsupported',diagnostics:[String(e)]});}
 }
 inject(event:ContractRef,encounterId:string):void{
  if(this.view.status!=='ready')throw Error('Test event boundary unavailable');const v=this.view,e=this.source.encounters.find(e=>e.id===encounterId);
  if(!this.entries.some(d=>d.key===event.key&&d.version===event.version&&d.kind==='event'))throw Error('Injection requires a declared event handler kind');
  if(!e||e.completionEvent.key!==event.key||e.completionEvent.version!==event.version)throw Error('Event does not complete the selected encounter');
  if(v.encounters[e.id]!=='active')throw Error('Explicit completion requires an active, incomplete encounter');
  if(v.actions.length+e.onComplete.length>10000)throw Error('Test action budget');
  let next:GameplayView={...v,encounters:{...v.encounters,[e.id]:'completed'}};for(const call of e.onComplete)next=this.apply(call,e.id,v.tick,next);this.view=own(next);
 }
 physicsSource():MapDocument{return {...this.source,bodies:this.source.bodies.map(b=>({...b,enabled:this.view.bodies[b.id]??b.enabled}))};}
}
