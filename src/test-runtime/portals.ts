// Captured Test worlds only. No editor, storage, network or engine implementation dependency.
import {validateSourceGraph,type MapDocument,type MovementDocument,type JsonValue,type ContractRef} from '../contracts';
import type {Entity} from '../contracts/gameplay-types';
import {GameplaySession} from '../gameplay/runtime';
import {sensorSpans} from '../gameplay/sensors';
import {createWorld,step,replayBytes,type State,type Input,type Step,type RunInput} from '../physics-reference';
import {TestSession,spawn,parseRecording,NEUTRAL,MAX_TICKS,type TestView,type Recording,type Injection} from './session';
type Portal=Extract<Entity,{kind:'portal'}>;
function own<T>(v:T):T {const copy=structuredClone(v);const freeze=(n:unknown):void=>{if(n&&typeof n==='object'){Object.values(n).forEach(freeze);Object.freeze(n);}};freeze(copy);return copy;}
export type PortalCommand=({readonly kind:'interact';readonly portalId:string}|{readonly kind:'inject';readonly encounterId:string;readonly event:ContractRef})&{readonly afterTicks:number};
export interface PortalRecording extends Recording {readonly commands?:readonly PortalCommand[]}
export interface Travel {readonly tick:number;readonly fromMap:string;readonly portalId:string;readonly toMap:string;readonly entityId:string;readonly arrival:State}
export interface PortalChoice {readonly id:string;readonly activation:'touch'|'interact';readonly inside:boolean;readonly condition:'passed'|'blocked'|'unsupported';readonly suppressed:boolean;readonly destination:{readonly mapId:string;readonly entityId:string}}
export interface PortalView extends TestView {readonly mapId:string;readonly travelStatus:'ready'|'unsupported'|'budget';readonly travelDiagnosis:string;readonly portals:readonly PortalChoice[];readonly travels:readonly Travel[];readonly pending:{readonly portalId:string;readonly remainingTicks:number}|null;readonly reentry:'fresh-map-instance; touch-exit-before-reentry'}
export function parsePortalRecording(value:unknown):PortalRecording {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected portal recording');
 const {commands,...base}=value as PortalRecording,r=parseRecording(base);
 if(commands!==undefined&&(r.events!==undefined||!Array.isArray(commands)||commands.length>1000||commands.some((v,i)=>!v||!Number.isSafeInteger(v.afterTicks)||v.afterTicks<0||v.afterTicks>r.ticks||(i>0&&v.afterTicks<commands[i-1]!.afterTicks)||(v.kind==='interact'?Object.keys(v).sort().join(',')!=='afterTicks,kind,portalId'||typeof v.portalId!=='string'||!v.portalId:v.kind==='inject'?Object.keys(v).sort().join(',')!=='afterTicks,encounterId,event,kind'||typeof v.encounterId!=='string'||!v.event||Object.keys(v.event).sort().join(',')!=='key,version'||typeof v.event.key!=='string'||!Number.isSafeInteger(v.event.version)||v.event.version<1:true))))throw Error('Invalid portal command schedule');
 return own({...r,...(commands===undefined?{}:{commands})});
}
/** Each entry creates fresh flags, encounters, once/overlap state. Actor profile is retained;
 * velocity, contact, climb and resource state reset through the destination stance solver.
 * Touch arrivals are locked per region until the full body exits. Delay latches on activation. */
export class PortalTestSession {
 readonly profile:MovementDocument;readonly initial:State;readonly root:MapDocument;
 private readonly sources:readonly JsonValue[];private readonly ids:Set<string>;private readonly maps:ReadonlyMap<string,MapDocument>;
 private run:TestSession;private view!:PortalView;private frames:Step[]=[];private input:RunInput[]=[];private events:Injection[]=[];private commands:PortalCommand[]=[];private travels:Travel[]=[];
 private suppressed=new Set<string>();private pending: {portal:Portal;remainingTicks:number}|null=null;
 private status:PortalView['travelStatus']='ready';private diagnosis='';private runInitial:State;
 private readonly listeners=new Set<()=>void>();
 constructor(root:MapDocument,profile:MovementDocument,sources:readonly JsonValue[],initial?:State){
  this.sources=own([root as unknown as JsonValue,...sources.filter(s=>!(s&&typeof s==='object'&&!Array.isArray(s)&&s.id===root.id))]);
  const graph=validateSourceGraph(this.sources);if(!graph.ok)throw Error('Portal snapshot closure: '+graph.diagnostics.filter(d=>d.severity==='error').map(d=>d.message).join('; '));
  const docs=new Map(this.sources.filter(s=>s&&typeof s==='object'&&!Array.isArray(s)).map(s=>[(s as {id:string}).id,s]));this.ids=new Set([root.id]);const pending=[root.id];
  while(pending.length){const doc=docs.get(pending.pop()!) as unknown as {dependencies?:{id:string}[]};for(const d of doc?.dependencies??[])if(!this.ids.has(d.id)){this.ids.add(d.id);pending.push(d.id);}}
  if(this.ids.size>256)throw Error('Portal snapshot document budget');
  this.maps=new Map([...docs].filter(([id,s])=>this.ids.has(id)&&(s as {format?:string}).format==='maplab.map').map(([id,s])=>[id,s as unknown as MapDocument]));
  if(this.maps.size>64)throw Error('Portal map budget');
  for(const map of this.maps.values()){
   const portals=map.entities.filter(e=>e.kind==='portal');let work=0;
   if(portals.length>64)throw Error('Portal sensor budget');
   for(const p of portals){const shape=map.regions.find(r=>r.id===p.regionId)!.shape;work+=shape.kind==='polygon'?shape.points.length**3:16;}
   if(work>100000)throw Error('Portal sensor geometry budget');
  }
  this.root=this.maps.get(root.id)!;this.profile=own(profile);this.run=this.instance(this.root,initial);this.initial=own(this.run.initial);this.runInitial=this.initial;
  if(this.run.getSnapshot().gameplay?.status!=='ready')throw Error('Portal initial gameplay '+this.run.getSnapshot().gameplay?.status);
  this.touch(this.initial,this.initial);this.publish();
 }
 get source():MapDocument{return this.run.source as unknown as MapDocument;}
 captures(id:string):boolean{return this.ids.has(id);}
 readonly subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
 readonly getSnapshot=():PortalView=>this.view;
 private instance(map:MapDocument,initial?:State):TestSession {return new TestSession(map as never,this.profile,initial,source=>new GameplaySession(source as unknown as MapDocument,this.sources));}
 private spans(p:Portal,from:State,to:State){const shape=this.source.regions.find(r=>r.id===p.regionId)!.shape,c=this.profile.collider;if(c.kind!=='rect')throw Error('Portal sensors require rectangular actor');return sensorSpans(shape,from,to,c.width*256,c.height*256);}
 private inside(p:Portal,state:State):boolean{return this.spans(p,state,state).some(s=>s.lo<1&&s.hi>1);}
 private portals():Portal[]{return this.source.entities.filter((e):e is Portal=>e.kind==='portal'&&e.enabled).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);}
 private publish():void {
  const v=this.run.getSnapshot();this.view=own({...v,paused:v.paused||this.status!=='ready',frames:this.frames,input:this.input,mapId:this.source.id,travelStatus:this.status,travelDiagnosis:this.diagnosis,
   portals:this.portals().map(p=>({id:p.id,activation:p.activation,inside:this.inside(p,v.state),condition:this.run.testConditions(p.conditions),suppressed:this.suppressed.has(p.id),destination:p.destination})),travels:this.travels,pending:this.pending?{portalId:this.pending.portal.id,remainingTicks:this.pending.remainingTicks}:null,reentry:'fresh-map-instance; touch-exit-before-reentry'});
  for(const l of this.listeners)l();
 }
 private fail(e:unknown):void {this.status=String(e).includes('budget')?'budget':'unsupported';this.diagnosis=String(e);this.pending=null;this.run.pause();}
 private destination(p:Portal):TestSession {
  const map=this.maps.get(p.destination.mapId);if(!map)throw Error('Portal destination outside captured map closure');
  const world=createWorld(map as never,this.profile),state={...spawn(world,p.destination.entityId),tick:this.run.getSnapshot().state.tick};
  // Constructor probes collision/support before any world is committed.
  const run=this.instance(map,state);if(run.getSnapshot().gameplay?.status!=='ready')throw Error('Portal arrival gameplay '+run.getSnapshot().gameplay?.status);
  const probe=step(createWorld(run.runtimeSource(),this.profile),state,NEUTRAL);if(probe.status!=='ok')throw Error('Unsafe portal arrival after initial events: '+probe.status+' '+probe.reason);return run;
 }
 private commit(p:Portal):void {
  if(this.travels.length>=64)throw Error('Portal transition budget');
  const next=this.destination(p),fromMap=this.source.id,wasPaused=this.run.getSnapshot().paused;const state=next.getSnapshot().state;
  this.run=next;this.pending=null;this.suppressed=new Set(this.portals().filter(p=>p.activation==='touch'&&this.inside(p,state)).map(p=>p.id));
  this.travels.push(own({tick:state.tick,fromMap,portalId:p.id,toMap:this.source.id,entityId:p.destination.entityId,arrival:state}));this.run.pause(wasPaused);
 }
 private activate(p:Portal):void {
  this.destination(p); // Validate now, including delayed arrivals. No partial transition on failure.
  if(p.delayTicks===0)this.commit(p);else this.pending={portal:p,remainingTicks:p.delayTicks};
 }
 private touch(from:State,to:State):void {
  if(this.pending||this.status!=='ready'||this.run.getSnapshot().gameplay?.status!=='ready')return;
  const candidates:{portal:Portal;time:number}[]=[];
  for(const p of this.portals()){
   if(p.activation!=='touch')continue;
   if(this.suppressed.has(p.id)){if(!this.inside(p,to))this.suppressed.delete(p.id);continue;}
   const spans=this.spans(p,from,to);if(spans.length&&this.run.testConditions(p.conditions)==='passed')candidates.push({portal:p,time:Math.max(0,spans[0]!.lo)});
  }
  candidates.sort((a,b)=>a.time-b.time||(a.portal.id<b.portal.id?-1:1));if(candidates[0])try{this.activate(candidates[0].portal);}catch(e){this.fail(e);}
 }
 pause(paused=true):void {this.run.pause(paused||this.status!=='ready'||this.frames.length>=MAX_TICKS);this.publish();}
 reset():void {this.frames=[];this.input=[];this.events=[];this.commands=[];this.travels=[];this.pending=null;this.suppressed.clear();this.status='ready';this.diagnosis='';this.runInitial=this.initial;this.run=this.instance(this.root,this.initial);this.touch(this.initial,this.initial);this.publish();}
 advance(input:Input=NEUTRAL):Step {
  if(this.status!=='ready'||this.run.getSnapshot().frame.status!=='ok'||this.run.getSnapshot().gameplay?.status!=='ready'||this.frames.length>=MAX_TICKS){this.pause();return this.view.frame;}
  const before=this.run.getSnapshot().state,frame=this.run.advance(input);
  const {fromTick:_,...last}=this.input.at(-1)??{fromTick:0};if(!this.input.length||replayBytes(last)!==replayBytes(input))this.input.push(own({...input,fromTick:before.tick}));
  this.frames.push(frame);
  if(frame.status==='ok'&&this.run.getSnapshot().gameplay?.status!=='ready')this.fail(Error('Portal gameplay '+this.run.getSnapshot().gameplay?.status));
  if(frame.status==='ok'&&this.status==='ready'){
   if(this.pending){this.pending.remainingTicks--;if(this.pending.remainingTicks===0)try{this.commit(this.pending.portal);}catch(e){this.fail(e);}}
   else this.touch(before,frame.state);
  }
  if(this.frames.length>=MAX_TICKS||this.status!=='ready')this.run.pause();this.publish();return this.view.frame;
 }
 interact(portalId:string):void {
  if(this.commands.length>=1000)throw Error('Portal command budget');
  if(this.status!=='ready'||this.pending)throw Error('Portal transition unavailable');
  const p=this.portals().find(p=>p.id===portalId);if(!p||p.activation!=='interact'||!this.inside(p,this.view.state))throw Error('Interact requires an enabled portal overlapping the full actor');
  const condition=this.run.testConditions(p.conditions);if(condition!=='passed')throw Error('Portal conditions '+condition);
  try{this.activate(p);}catch(e){this.fail(e);this.publish();throw e;}
  this.commands.push(own({kind:'interact',afterTicks:this.frames.length,portalId}));this.run.pause();this.publish();
 }
 injectEvent(event:ContractRef,encounterId:string):void {if(this.commands.length>=1000)throw Error('Portal command budget');if(this.status!=='ready')throw Error('Portal Test unavailable');this.run.injectEvent(event,encounterId);this.events.push(own({afterTicks:this.frames.length,event,encounterId}));this.commands.push(own({kind:'inject',afterTicks:this.frames.length,event,encounterId}));this.publish();}
 runtimeSource():MapDocument{return this.run.runtimeSource() as unknown as MapDocument;}
 recording():PortalRecording {return own({initial:this.runInitial,input:this.input,ticks:this.frames.length,...(this.commands.some(c=>c.kind==='interact')?{commands:this.commands}:this.events.length?{events:this.events}:{})});}
 replay(value:unknown):void {
  const r=parsePortalRecording(value),next=new PortalTestSession(this.root,this.profile,this.sources,r.initial);let input=0,command=0;const commands:readonly PortalCommand[]=r.commands??r.events?.map(e=>({...e,kind:'inject' as const}))??[];
  const boundary=()=>{while(commands[command]?.afterTicks===next.frames.length){const c=commands[command++]!;if(c.kind==='inject')next.injectEvent(c.event,c.encounterId);else next.interact(c.portalId);}};boundary();
  for(let i=0;i<r.ticks;i++){while(r.input[input+1]&&r.input[input+1]!.fromTick<=next.view.state.tick)input++;const {fromTick:_,...controls}=r.input[input]!;if(next.advance(controls).status!=='ok'||next.status!=='ready'||next.frames.length!==i+1)throw Error('Portal replay refused: '+next.view.travelDiagnosis+' '+next.view.frame.reason);boundary();}
  this.run=next.run;this.frames=next.frames;this.input=next.input;this.events=next.events;this.commands=next.commands;this.travels=next.travels;this.suppressed=next.suppressed;this.pending=next.pending;this.status=next.status;this.diagnosis=next.diagnosis;this.runInitial=own(r.initial);this.run.pause();this.publish();
 }
}
