import {test,expect,vi} from 'vitest';
import {readFileSync,readdirSync,realpathSync,mkdtempSync,cpSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {PortalTestSession,parsePortalRecording,type PortalRecording} from '../src/test-runtime/portals';
import {NEUTRAL,spawn} from '../src/test-runtime/session';import {createWorld} from '../src/physics-reference';
import {canonical,validateSourceGraph,type MapDocument,type MovementDocument,type JsonValue} from '../src/contracts';
import {exportLibrary} from '../src/library/export';
vi.setConfig({testTimeout:15000});
const root='conformance/portals',read=<T>(p:string):T=>JSON.parse(readFileSync(join(root,p),'utf8')),walk=(p:string):string[]=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)]);
const sources=walk(root+'/sources').map(p=>JSON.parse(readFileSync(p,'utf8')) as JsonValue),map=read<MapDocument>('sources/maps/forest.map.json'),clearing=read<MapDocument>('sources/maps/clearing.map.json'),profile=read<MovementDocument>('sources/movement/player.movement.json'),recording=read<PortalRecording>('journey.input.json');
const mutable=()=>JSON.parse(JSON.stringify({map,clearing,sources})) as {map:any;clearing:any;sources:JsonValue[]};
function run(f=map,c=clearing,initial?:import('../src/physics-reference').State){return new PortalTestSession(f,profile,[f as unknown as JsonValue,c as unknown as JsonValue,...sources.filter(s=>!['map.forest','map.clearing'].includes((s as {id:string}).id))],initial);}
const clear=(r:PortalTestSession)=>r.injectEvent({key:'core.encounter.cleared',version:1},'encounter.boss');
const project=(r:PortalTestSession)=>{const v=r.getSnapshot();return {mapId:v.mapId,state:v.state,travels:v.travels,gameplay:v.gameplay};};
test('owned final-byte portal schedule unlocks with explicit event, latches delay and arrives by full-body stance',()=>{
 const before=canonical(sources as unknown as JsonValue),r=run();expect(r.getSnapshot().gameplay?.encounters['encounter.boss']).toBe('active');expect(()=>r.interact('portal.clearing')).toThrow('blocked');clear(r);r.interact('portal.clearing');expect(r.getSnapshot().pending?.remainingTicks).toBe(2);r.advance();expect(r.getSnapshot().mapId).toBe('map.forest');r.advance();expect(r.getSnapshot().state).toMatchObject({x:160*256,y:576*256,tick:2,vx:0,vy:0,supportId:'fh.floor',traversalId:null});r.advance();expect(project(r)).toEqual(read('journey.expected.json'));expect(r.recording()).toEqual(recording);expect(canonical(sources as unknown as JsonValue)).toBe(before);
 expect(Object.isFrozen(r.source.entities)).toBe(true);r.reset();expect(r.getSnapshot().mapId).toBe('map.forest');expect(r.getSnapshot().gameplay?.flags['flag.boss-defeated']).toBe(false);expect(r.getSnapshot().travels).toEqual([]);
});
test('ordered commands replay across maps atomically, including commands on a shared boundary',()=>{
 const r=run();r.replay(recording);expect(project(r)).toEqual(read('journey.expected.json'));const before=r.getSnapshot();const wrong=structuredClone(recording) as any;wrong.commands.reverse();expect(()=>r.replay(wrong)).toThrow('blocked');expect(r.getSnapshot()).toBe(before);
 expect(()=>parsePortalRecording({...recording,commands:[{kind:'script',afterTicks:0,code:'run()'}]})).toThrow('command');expect(()=>parsePortalRecording({...recording,events:[]})).toThrow('command');
});
test('captured maps and dependency cycles are immutable; no fetch is used',()=>{
 const f=mutable(),r=run(f.map,f.clearing),fetch=vi.spyOn(globalThis,'fetch').mockImplementation(()=>{throw Error('network forbidden');});try{f.clearing.entities[0].anchor.u=0;r.replay(recording);expect(r.getSnapshot().state.x).toBe(160*256);expect(fetch).not.toHaveBeenCalled();expect(r.captures('map.clearing')).toBe(true);}finally{fetch.mockRestore();}
});
test('dangling targets and missing dependency closure reject before Test; disabled or unsafe arrivals do not swap worlds',()=>{
 const f=mutable();f.map.entities.find((e:any)=>e.kind==='portal').destination.entityId='missing.target';expect(()=>run(f.map,f.clearing)).toThrow('closure');
 const m=mutable();m.map.dependencies=m.map.dependencies.filter((d:any)=>d.id!=='map.clearing');expect(()=>run(m.map,m.clearing)).toThrow('closure');
 for(const unsafe of ['disabled','overlap','edge']){
  const f=mutable(),arrival=f.clearing.entities.find((e:any)=>e.id==='start.arrival');if(unsafe==='disabled')arrival.enabled=false;else if(unsafe==='overlap')arrival.anchor={kind:'world',point:[160,600]};else arrival.anchor.u=0;
  const r=run(f.map,f.clearing);clear(r);expect(()=>r.interact('portal.clearing')).toThrow();expect(r.getSnapshot().mapId).toBe('map.forest');expect(r.getSnapshot().travels).toEqual([]);expect(r.getSnapshot().paused).toBe(true);
 }
});
test('touch portals use strict full-body interior, swept crossings and stable simultaneous IDs',()=>{
 const f=mutable(),p=f.map.entities.find((e:any)=>e.kind==='portal');p.activation='touch';p.delayTicks=0;p.conditions=[];f.map.regions.find((r:any)=>r.id==='region.portal').shape.rect=[100,592,1,48];
 const initial={...spawn(createWorld(f.map,profile)),x:88*256,vx:1024};const r=run(f.map,f.clearing,initial);expect(r.getSnapshot().mapId).toBe('map.forest');r.advance({...NEUTRAL,moveX:1,run:true});expect(r.getSnapshot().mapId).toBe('map.clearing');
 const s=mutable(),p2=s.map.entities.find((e:any)=>e.kind==='portal');p2.activation='touch';p2.delayTicks=0;p2.conditions=[];s.map.entities.push({...p2,id:'a.portal'});expect(run(s.map,s.clearing).getSnapshot().travels[0]?.portalId).toBe('a.portal');
});
test('arrival touch-loop guard survives waiting, releases only after exit, and reentry/reset create fresh flags and once state',()=>{
 const f=mutable(),p=f.map.entities.find((e:any)=>e.kind==='portal'),back=f.clearing.entities.find((e:any)=>e.kind==='portal');p.activation='interact';p.delayTicks=0;back.activation='touch';back.delayTicks=0;const r=run(f.map,f.clearing);clear(r);r.interact(p.id);expect(r.getSnapshot().portals[0]?.suppressed).toBe(true);for(let i=0;i<8;i++)r.advance();expect(r.getSnapshot().travels).toHaveLength(1);
 for(let i=0;i<16;i++)r.advance({...NEUTRAL,moveX:1,run:true});expect(r.getSnapshot().portals[0]?.suppressed).toBe(false);
 for(let i=0;i<45&&r.getSnapshot().mapId==='map.clearing';i++)r.advance({...NEUTRAL,moveX:-1,run:true});expect(r.getSnapshot().mapId).toBe('map.forest');expect(r.getSnapshot().gameplay?.flags['flag.boss-defeated']).toBe(false);expect(r.getSnapshot().gameplay?.encounters['encounter.boss']).toBe('active');expect(r.getSnapshot().travels).toHaveLength(2);const rec=r.recording(),v=project(r);r.replay(rec);expect(project(r)).toEqual(v);r.reset();expect(r.getSnapshot().state).toEqual(r.initial);expect(r.getSnapshot().travels).toEqual([]);
});
test('arrival resolves selected nondefault entities and entity/body/world anchors without copying source state',()=>{
 for(const kind of ['world','body','entity']){
  const f=mutable(),p=f.map.entities.find((e:any)=>e.kind==='portal');p.delayTicks=0;const target=f.clearing.entities.find((e:any)=>e.id==='start.arrival');f.clearing.entities.push({...target,id:'arrival.other',kind:'playerStart',default:false,anchor:kind==='world'?{kind,point:[160,576]}:kind==='body'?{kind,bodyId:'body.floor',point:[160,576]}:{kind,entityId:'start.arrival',point:[0,0]}});p.destination.entityId='arrival.other';expect(validateSourceGraph([f.map,f.clearing,...sources.filter(s=>!['map.forest','map.clearing'].includes((s as any).id))]).ok).toBe(true);const r=run(f.map,f.clearing);clear(r);r.interact(p.id);expect(r.getSnapshot().state).toMatchObject({x:160*256,y:576*256,vx:0,vy:0,supportId:'fh.floor'});
 }
});
test('unsupported engine conditions do not activate and repeated transitions exhaust a bounded budget',()=>{
 const f=mutable(),p=f.map.entities.find((e:any)=>e.kind==='portal');p.conditions=[{kind:'entityState',entityId:'spawn.boss',state:'dormant'}];const r=run(f.map,f.clearing);expect(r.getSnapshot().portals[0]?.condition).toBe('unsupported');expect(()=>r.interact(p.id)).toThrow('unsupported');
 const b=mutable();for(const m of [b.map,b.clearing]){const p=m.entities.find((e:any)=>e.kind==='portal');p.delayTicks=0;p.conditions=[];}const q=run(b.map,b.clearing);for(let i=0;i<64;i++)q.interact(q.getSnapshot().portals[0]!.id);expect(()=>q.interact(q.getSnapshot().portals[0]!.id)).toThrow('budget');expect(q.getSnapshot().travels).toHaveLength(64);expect(q.getSnapshot().travelStatus).toBe('budget');
});
test('unavailable gameplay boundaries and absolute tick budgets cannot be hidden by portal travel',()=>{
 const f=mutable(),triggers=Array.from({length:257},(_,i)=>({id:'trigger.budget.'+i,regionId:'region.back',event:'enter',actorCategories:['player'],once:false,conditions:[],actions:[]}));f.clearing.triggers=triggers;const r=run(f.map,f.clearing);clear(r);expect(()=>r.interact('portal.clearing')).toThrow('budget');expect(r.getSnapshot().mapId).toBe('map.forest');expect(r.getSnapshot().travels).toEqual([]);
 expect(()=>run(map,clearing,{...spawn(createWorld(map as never,profile)),tick:3601})).toThrow('budget');
});
test('arrival initial-trigger body changes cannot commit an overlapping runtime world',()=>{
 const f=mutable();f.clearing.bodies.push({...f.clearing.bodies[0],id:'body.arrival-gate',enabled:false,shapes:[{id:'shape.arrival-gate',kind:'rect',rect:[148,528,24,48]}]});f.clearing.triggers=[{id:'trigger.arrival-gate',regionId:'region.back',event:'enter',actorCategories:['player'],once:true,conditions:[],actions:[{key:'core.body.set-enabled',version:1,params:{target:{ref:{kind:'body',id:'body.arrival-gate'}},enabled:true}}]}];const r=run(f.map,f.clearing);clear(r);expect(()=>r.interact('portal.clearing')).toThrow('arrival');expect(r.getSnapshot().mapId).toBe('map.forest');expect(r.getSnapshot().travels).toEqual([]);
});
test('owned fixture index binds all final bytes',()=>{const index=read<{license:string;files:{path:string;sha256:string}[]}>('index.json');expect(index.license).toBe('CC0-1.0');expect(index.files.map(f=>f.path).sort()).toEqual(walk(root).map(p=>p.slice(root.length+1)).filter(p=>p!=='index.json').sort());for(const f of index.files)expect(createHash('sha256').update(readFileSync(join(root,f.path))).digest('hex')).toBe(f.sha256);});

test('independent importer loads actual exported bytes and consumes injected-event portal trace; rehashed corruptions fail',async()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'maplab-portal-consumer-')));try{
  const library=join(dir,'library');cpSync('placeholder-library',library,{recursive:true});cpSync(root+'/sources',library,{recursive:true});const index=JSON.parse(readFileSync(join(library,'maplab.project.json'),'utf8'));for(const d of index.documents)d.sha256=createHash('sha256').update(readFileSync(join(library,d.path))).digest('hex');writeFileSync(join(library,'maplab.project.json'),JSON.stringify(index));
  const digest=createHash('sha256').update(readFileSync(join(library,'maps/forest.map.json'))).digest('hex'),bundle=await exportLibrary({dir:library,label:'Owned portal fixture',placeholder:false},'map.forest',digest),bundleDir=join(dir,'bundle');
  for(const [p,b] of bundle.files){mkdirSync(dirname(join(bundleDir,p)),{recursive:true});writeFileSync(join(bundleDir,p),b);}
  cpSync('schemas',join(dir,'schemas'),{recursive:true});cpSync('tests/consumer/reader',join(dir,'reader'),{recursive:true});cpSync('tests/consumer/portals.mjs',join(dir,'consumer.mjs'));cpSync(root,join(dir,'fixtures'),{recursive:true});
  const consume=()=>execFileSync(process.execPath,[join(dir,'consumer.mjs'),bundleDir,join(dir,'schemas'),join(dir,'fixtures')],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']});expect(JSON.parse(consume())).toMatchObject({verified:true,mapId:'map.clearing',transitions:1});
  const expected=join(dir,'fixtures/journey.expected.json'),original=readFileSync(expected);const v=JSON.parse(original.toString());v.travels[0].arrival.x++;writeFileSync(expected,JSON.stringify(v));const ix=JSON.parse(readFileSync(join(dir,'fixtures/index.json'),'utf8'));ix.files.find((f:{path:string})=>f.path==='journey.expected.json').sha256=createHash('sha256').update(readFileSync(expected)).digest('hex');writeFileSync(join(dir,'fixtures/index.json'),JSON.stringify(ix));expect(consume).toThrow('independent portal arrival/delay trace');writeFileSync(expected,original);ix.files.find((f:{path:string})=>f.path==='journey.expected.json').sha256=createHash('sha256').update(original).digest('hex');writeFileSync(join(dir,'fixtures/index.json'),JSON.stringify(ix));
  const path='maps/forest.map.json',bad=JSON.parse(readFileSync(join(bundleDir,path),'utf8'));bad.entities.find((e:any)=>e.kind==='portal').destination.entityId='missing.target';const bytes=Buffer.from(canonical(bad));writeFileSync(join(bundleDir,path),bytes);const manifest=JSON.parse(readFileSync(join(bundleDir,'manifest.json'),'utf8')),entry=manifest.files.find((f:{path:string})=>f.path===path);entry.sha256=createHash('sha256').update(bytes).digest('hex');entry.bytes=bytes.length;writeFileSync(join(bundleDir,'manifest.json'),canonical(manifest));expect(consume).toThrow('portal.entity');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
