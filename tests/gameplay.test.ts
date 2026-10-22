import {test,expect} from 'vitest';
import {readFileSync,readdirSync,mkdtempSync,cpSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {GameplaySession,type SensorActor} from '../src/gameplay/runtime';import {sensorSpans} from '../src/gameplay/sensors';
import {TestSession,NEUTRAL} from '../src/test-runtime/session';import {canonical,validateSourceGraph,type JsonValue,type MapDocument,type MovementDocument,type CatalogDocument} from '../src/contracts';
import {normalize,denormalize,type JsonObject} from '../src/domain/model';import {candidate} from '../src/editor/editing';
import {GAMEPLAY_COLLECTIONS,gameplayEdit,formSchema} from '../src/gameplay/inspector';import {Node} from '../src/app/GameplayPanel';
const root=join(process.cwd(),'conformance/gameplay-events'),read=<T>(p:string):T=>JSON.parse(readFileSync(join(root,p),'utf8'));
const walk=(p:string):string[]=>readdirSync(p,{withFileTypes:true}).flatMap(f=>f.isDirectory()?walk(join(p,f.name)):[join(p,f.name)]);
const sources=walk(join(root,'sources')).map(p=>JSON.parse(readFileSync(p,'utf8')) as JsonValue),map=read<MapDocument>('sources/maps/forest.map.json'),profile=read<MovementDocument>('sources/movement/player.movement.json');
type Case={id:string;map:MapDocument;steps:({tick:number;actors:SensorActor[];initial?:boolean}|{event:{key:string;version:number};encounterId:string})[]};
const cases=read<Case[]>('cases.json');
function run(c:Case){const s=new GameplaySession(c.map,sources);for(const step of c.steps)if('event' in step)s.inject(step.event,step.encounterId);else s.sense(step.tick,step.actors,step.initial);return s;}
const actor=(id:string,x0:number,x1=x0):SensorActor=>({id,category:'player',from:{x:x0*256,y:640*256},to:{x:x1*256,y:640*256},width:24*256,height:48*256,abilities:[]});
test('all F entity kinds and gameplay collections have closed typed inspectors and atomically validated transactions',()=>{
 expect(new Set(map.entities.map(e=>e.kind)).size).toBe(15);expect(validateSourceGraph(sources).ok).toBe(true);
 const normalized=normalize(map as unknown as JsonValue);if(!normalized.ok)throw Error('fixture');let model=normalized.model;const original=canonical(denormalize(model));
 const catalog=read<CatalogDocument>('sources/catalogs/core.catalog.json');
 for(const collection of GAMEPLAY_COLLECTIONS)for(const id of model.collections.get(collection)!.order){
  const r=model.collections.get(collection)!.byId.get(id)!,draft={...r,...('name' in r?{name:r.name+' edited'}:collection==='waypoints'?{waitTicks:Number(r.waitTicks)+1}:collection==='flags'?{initial:true}:{})};
  const before=canonical(denormalize(model)),tx=gameplayEdit(model,collection,draft);model=candidate(model,tx);expect(canonical(denormalize(normalized.model))).toBe(original);
  expect(validateSourceGraph([denormalize(model),...sources.filter(s=>(s as {id:string}).id!==map.id)]).ok).toBe(true);
  const markup=renderToStaticMarkup(createElement(Node,{schema:formSchema(collection),value:r,path:'',context:{map,maps:[map],entries:catalog.entries,profiles:[profile.id],entityKind:String(r.kind??'')},onChange:()=>{}}));
  expect(markup).not.toContain('<textarea');expect(markup).toContain('Gameplay');if('name' in r)expect(before).not.toBe(canonical(denormalize(model)));
 }
 expect(()=>gameplayEdit(model,'entities',{...map.entities[0],script:'run()'} as unknown as JsonObject)).toThrow('Unknown member');
});
test('choosing or creating a default player start atomically preserves exactly one default and stable IDs',()=>{
 const n=normalize(map as unknown as JsonValue);if(!n.ok)throw Error('fixture');const start=map.entities.find(e=>e.kind==='playerStart')!,second={...start,id:'start.alternate',default:false} as unknown as JsonObject;
 const inserted=candidate(n.model,gameplayEdit(n.model,'entities',second,true)),switched=candidate(inserted,gameplayEdit(inserted,'entities',{...second,default:true}));
 const result=denormalize(switched) as unknown as MapDocument;expect(result.entities.filter(e=>e.kind==='playerStart'&&e.default).map(e=>e.id)).toEqual(['start.alternate']);expect(validateSourceGraph([result as unknown as JsonValue,...sources.filter(s=>(s as {id:string}).id!==map.id)]).ok).toBe(true);expect((denormalize(n.model) as unknown as MapDocument).entities.find(e=>e.id===start.id)).toEqual(start);
 const created=candidate(n.model,gameplayEdit(n.model,'entities',{...second,default:true},true));expect((denormalize(created) as unknown as MapDocument).entities.filter(e=>e.kind==='playerStart'&&e.default).map(e=>e.id)).toEqual(['start.alternate']);
});
test('final-byte source/event fixtures rerun deterministically and preserve source and input bytes',()=>{
 for(const c of cases){const before=canonical(c as unknown as JsonValue),r=run(c).getSnapshot();expect(r.status).toBe('ready');expect(canonical(r as unknown as JsonValue)+'\n').toBe(readFileSync(join(root,c.id+'.expected.json'),'utf8'));expect(canonical(c as unknown as JsonValue)).toBe(before);}
 const fast=run(cases[0]!).getSnapshot();expect(fast.events.map(e=>[e.event,e.time])).toEqual([['enter',0.35],['exit',0.6625]]);expect(fast.flags['flag.boss-defeated']).toBe(false);
});
test('full body interiors include shoulders, reject tangency, and retain concave polygon/circle swept crossings',()=>{
 const rect={kind:'rect' as const,rect:[100,580,1,80] as const},p={x:88*256,y:640*256};expect(sensorSpans(rect,p,p,24*256,48*256)).toEqual([]);
 expect(sensorSpans(rect,{...p,x:p.x+1},{...p,x:p.x+1},24*256,48*256)).not.toEqual([]);
 const circle={kind:'circle' as const,center:[100,620] as const,radius:10};expect(sensorSpans(circle,{x:78*256,y:620*256},{x:78*256,y:620*256},24*256,48*256)).toEqual([]);
 const polygon={kind:'polygon' as const,points:[[90,580],[130,580],[130,600],[110,600],[110,660],[90,660]] as const};expect(sensorSpans(polygon,actor('a',60).from,actor('a',160).to,24*256,48*256).length).toBe(1);
});
test('TOI is global, simultaneous actors and triggers use stable IDs, once persists and conditions snapshot before actions',()=>{
 const c=structuredClone(cases[0]!);const enter=c.map.triggers.find(t=>t.event==='enter')!;c.map={...c.map,triggers:[{...enter,id:'z',conditions:[{kind:'flag',id:'flag.boss-defeated',equals:false}]},{...enter,id:'a',conditions:[{kind:'flag',id:'flag.boss-defeated',equals:false}]}]};
 const s=new GameplaySession(c.map,sources);s.sense(0,[actor('z',60),actor('a',0)],true);s.sense(1,[actor('z',60,140),actor('a',0,100)]);expect(s.getSnapshot().events.map(e=>e.actorId)).toEqual(['z','z','a','a']);expect(s.getSnapshot().events.every(e=>e.condition==='passed')).toBe(true);
 const once=run(cases[1]!).getSnapshot();expect(once.actions.map(a=>a.ownerId)).toEqual(['a.enter','z.enter']);expect(once.once).toEqual(['a.enter','z.enter']);expect(once.events.slice(0,4).map(e=>e.actorId)).toEqual(['actor.a','actor.a','actor.b','actor.b']);expect(run(cases[1]!).getSnapshot()).toEqual(once);
});
test('explicit boss completion requires the declared event and active encounter, applies flags/gate but never combat',()=>{
 const c=cases.find(c=>c.id==='boss-injection')!,s=new GameplaySession(c.map,sources),event={key:'core.encounter.cleared',version:1};expect(()=>s.inject(event,'encounter.boss')).toThrow('active');
 s.sense(0,[actor('player.1',60)],true);expect(s.getSnapshot().entities['spawn.boss']).toBe(true);expect(s.getSnapshot().bodies['body.gate']).toBe(true);
 const before=s.getSnapshot();expect(()=>s.inject({key:'core.idle',version:1},'encounter.boss')).toThrow('event handler kind');expect(s.getSnapshot()).toBe(before);s.inject(event,'encounter.boss');expect(s.getSnapshot().flags['flag.boss-defeated']).toBe(true);expect(s.getSnapshot().bodies['body.gate']).toBe(false);expect(s.source.flags[0]!.initial).toBe(false);expect(()=>s.inject(event,'encounter.boss')).toThrow('active');
});
test('Test reset/replay rebuilds overlap/once/runtime state and records explicit event injections outside authored state',()=>{
 const m=cases.find(c=>c.id==='boss-injection')!.map,run=new TestSession(m as never,profile,undefined,source=>new GameplaySession(source as unknown as MapDocument,sources)),before=canonical(m as unknown as JsonValue);expect(run.getSnapshot().gameplay?.encounters['encounter.boss']).toBe('active');run.advance(NEUTRAL);run.injectEvent({key:'core.encounter.cleared',version:1},'encounter.boss');run.advance(NEUTRAL);const final=run.getSnapshot(),recording=run.recording();expect(recording.events?.[0]?.afterTicks).toBe(1);run.reset();expect(run.getSnapshot().gameplay?.flags['flag.boss-defeated']).toBe(false);run.replay(recording);expect(run.getSnapshot().gameplay).toEqual(final.gameplay);expect(run.getSnapshot().state).toEqual(final.state);expect(canonical(m as unknown as JsonValue)).toBe(before);
 const previous=run.getSnapshot();expect(()=>run.replay({...recording,events:[{...recording.events![0]!,event:{key:'core.idle',version:1}}]})).toThrow();expect(run.getSnapshot()).toBe(previous);
});
test('unknown engine conditions/actions are configured, not executed; wrong catalog kind refuses; exhausted work publishes no partial state',()=>{
 const c=structuredClone(cases[1]!);c.map={...c.map,triggers:[{...c.map.triggers[0]!,once:false,actions:[{key:'core.chest.open',version:1,params:{}}]}]};const s=run(c);expect(s.getSnapshot().actions.every(a=>a.status==='configured, not simulated')).toBe(true);
 c.map={...c.map,triggers:[{...c.map.triggers[0]!,conditions:[{kind:'entityState',entityId:'spawn.boss',state:'dormant'}]}]};expect(run(c).getSnapshot().events.every(e=>e.condition==='unsupported')).toBe(true);expect(run(c).getSnapshot().actions).toEqual([]);
 const wrong={...c.map,triggers:[{...c.map.triggers[0]!,actions:[{key:'core.idle',version:1,params:{}}]}]};expect(()=>new GameplaySession(wrong,sources)).toThrow('Expected action');
 const budget=new GameplaySession(cases[1]!.map,sources);budget.sense(0,Array.from({length:65},(_,n)=>actor('a'+n,60)),true);expect(budget.getSnapshot()).toMatchObject({status:'budget',events:[],actions:[],once:[]});
 const invalid=new GameplaySession(cases[1]!.map,sources);invalid.sense(0,[actor('same',60),actor('same',60)],true);expect(invalid.getSnapshot()).toMatchObject({status:'unsupported',events:[],actions:[]});
});
test('body actions change the next physics tick, while explicit completion can unblock it without source mutation',()=>{
 const base=cases.find(c=>c.id==='boss-injection')!.map,m={...base,bodies:base.bodies.map(b=>b.id==='body.gate'?{...b,position:[0,0] as const,shapes:b.shapes.map(s=>s.kind==='rect'?{...s,rect:[58,592,16,48] as const}:s)}:b)},factory=(source:import('../src/physics-reference').ContactMap)=>new GameplaySession(source as unknown as MapDocument,sources);
 const run=new TestSession(m as never,profile,undefined,factory);expect(run.getSnapshot().frame.status).toBe('ok');expect(run.getSnapshot().state.tick).toBe(0);expect(run.advance(NEUTRAL).status).toBe('invalidState');
 const cleared=new TestSession(m as never,profile,undefined,factory);cleared.injectEvent({key:'core.encounter.cleared',version:1},'encounter.boss');expect(cleared.advance(NEUTRAL).status).toBe('ok');expect(m.bodies.find(b=>b.id==='body.gate')!.enabled).toBe(false);
});
test('per-boundary work overflow rolls back every queued effect and tangential circle motion stays outside',()=>{
 const base=cases[1]!.map,m={...base,triggers:Array.from({length:200},(_,n)=>({...base.triggers[0]!,id:'trigger.budget.'+n}))},run=new GameplaySession(m,sources);run.sense(0,Array.from({length:64},(_,n)=>actor('actor.'+n,60)),true);expect(run.getSnapshot()).toMatchObject({status:'budget',events:[],actions:[],once:[],flags:{'flag.boss-defeated':false}});
 const shape={kind:'circle' as const,center:[100,620] as const,radius:10};expect(sensorSpans(shape,{x:60*256,y:610*256},{x:140*256,y:610*256},24*256,48*256)).toEqual([]);
});
test('isolated final-byte consumer validates event math/order/actions and rejects rehashed semantic corruption',()=>{
 const dir=mkdtempSync(join(tmpdir(),'maplab-gameplay-consumer-'));try{cpSync(root,join(dir,'fixtures'),{recursive:true});cpSync('tests/consumer/gameplay.mjs',join(dir,'consumer.mjs'));const run=()=>execFileSync(process.execPath,[join(dir,'consumer.mjs'),join(dir,'fixtures')],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']});expect(JSON.parse(run()).verified).toBe(true);
 const p=join(dir,'fixtures/fast-crossing.expected.json'),r=JSON.parse(readFileSync(p,'utf8'));r.events[0].time=0.5;writeFileSync(p,JSON.stringify(r)+'\n');const index=JSON.parse(readFileSync(join(dir,'fixtures/index.json'),'utf8'));index.files.find((f:{path:string})=>f.path==='fast-crossing.expected.json').sha256=createHash('sha256').update(readFileSync(p)).digest('hex');writeFileSync(join(dir,'fixtures/index.json'),JSON.stringify(index));expect(run).toThrow();}finally{rmSync(dir,{recursive:true,force:true});}
});
