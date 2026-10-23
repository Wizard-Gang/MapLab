import {test,expect,vi} from 'vitest';
import {readFileSync,readdirSync,mkdtempSync,cpSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {CameraPreview} from '../src/camera/preview';import {presentationEdit} from '../src/camera/authoring';
import {PortalTestSession,type PortalRecording} from '../src/test-runtime/portals';import {TestSession,NEUTRAL} from '../src/test-runtime/session';
import {canonical,validateSourceGraph,type JsonValue,type MapDocument,type MovementDocument} from '../src/contracts';
import {normalize,denormalize} from '../src/domain/model';import {candidate} from '../src/editor/editing';import type {State} from '../src/physics-reference';
const root='conformance/camera',read=<T>(p:string):T=>JSON.parse(readFileSync(join(root,p),'utf8'));
const walk=(p:string):string[]=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)]);
const sources=walk(root+'/sources').map(p=>JSON.parse(readFileSync(p,'utf8')) as JsonValue),map=read<MapDocument>('sources/maps/forest.map.json'),profile=read<MovementDocument>('sources/movement/player.movement.json');
type Case={id:string;map:string;camera:MapDocument['camera'];environment:MapDocument['environment'];collider:{width:number;height:number};observations:{state:State;reset?:boolean}[]};
const cases=read<Case[]>('cases.json'),source=(c:Case):MapDocument=>({...read<MapDocument>(c.map),camera:c.camera,environment:c.environment});
function run(c:Case){const r=new CameraPreview(source(c),c.collider);return c.observations.map((o,i)=>i===0||o.reset?r.reset(o.state):r.step(o.state));}
for(const c of cases)test('final-byte camera numerical fixture '+c.id,()=>{const before=JSON.stringify(c),actual=run(c);expect(JSON.stringify(actual)+'\n').toBe(readFileSync(join(root,c.id+'.expected.json'),'utf8'));expect(JSON.stringify(c)).toBe(before);expect(Object.isFrozen(actual[0]!.effective.bounds)).toBe(true);});
test('source closure and shaft geometry are valid, original fixture bytes are owned and hashed',()=>{
 expect(validateSourceGraph(sources).ok).toBe(true);expect(validateSourceGraph([read<JsonValue>('shaft.map.json'),...sources.filter(s=>(s as {id:string}).id!==map.id)]).ok).toBe(true);
 const wav=readFileSync(root+'/assets/camera-silence.wav');expect(wav.subarray(0,4).toString()).toBe('RIFF');expect(wav.subarray(44).every(n=>n===0)).toBe(true);
 for(const c of cases)expect(validateSourceGraph([source(c) as unknown as JsonValue,...sources.filter(s=>(s as {id:string}).id!==map.id)]).ok).toBe(true);
});
test('priority and stable IDs ignore authored order; full-body tangency is outside',()=>{
 const c=structuredClone(cases.find(c=>c.id==='zone-ties')!),before=run(c);c.camera={...c.camera,zones:[...c.camera.zones].reverse()};c.environment={...c.environment,zones:[...c.environment.zones].reverse()};expect(run(c)).toEqual(before);
 const r=new CameraPreview(source(c),c.collider),s=c.observations[0]!.state;expect(r.reset({...s,x:500*256}).zoneId).toBe(null);expect(r.reset({...s,x:500*256+1}).zoneId).toBe('camera.a');
 c.camera={...c.camera,zones:c.camera.zones.map(z=>({...z,priority:z.id==='camera.b'?11:10}))};expect(run(c)[0]!.zoneId).toBe('camera.b');
});
test('short jumps hold, safety follows tall jumps, climbFollow overrides hold and higher landings snap once',()=>{
 const short=run(cases[0]!);expect(new Set(short.map(v=>v.center[1]))).toEqual(new Set([616]));const tall=run(cases[1]!);expect(Math.min(...tall.map(v=>v.center[1]))).toBeLessThan(570);
 const c=structuredClone(cases.find(c=>c.id==='ladder')!),yes=run(c);c.camera={...c.camera,defaults:{...c.camera.defaults,climbFollow:false}};const no=run(c);expect(yes.some((v,i)=>v.center[1]!==no[i]!.center[1])).toBe(true);expect(yes.at(-1)!.center[1]).toBe(472);
 const higher=run(cases.find(c=>c.id==='stacked-floors')!);expect(higher[2]!.center[1]).toBe(472);expect(higher[4]!.center[1]).toBe(360);
 const base=cases[0]!,r=new CameraPreview(source(base),base.collider),s=base.observations[0]!.state;r.reset(s);const snap=r.step({...s,tick:1,mode:'air',y:500*256}),land=r.step({...s,tick:2,y:496*256});expect(land.center[1]).toBe(472);expect(r.step({...s,tick:3,mode:'air',y:490*256}).center).toEqual(land.center);expect(snap.center[1]).toBeLessThanOrEqual(616);
});
test('locked axes center effective bounds during blends, full viewport confines and interruptions start from current settings',()=>{
 const c=structuredClone(cases.find(c=>c.id==='boss-lock')!),views=run(c);for(const v of views.slice(1)){expect(v.center[0]).toBe(v.effective.bounds[0]+v.effective.bounds[2]/2);expect(v.center[1]).toBe(v.effective.bounds[1]+v.effective.bounds[3]/2);}
 const r=new CameraPreview(source(c),c.collider),s=c.observations[0]!.state;r.reset(s);const entered=r.step(c.observations[1]!.state);const left=r.step({...s,tick:2});expect(left.zoneId).toBe(null);expect(left.transition).toBe(null);expect(left.effective).toEqual(c.camera.defaults);
 c.camera={...c.camera,defaults:{...c.camera.defaults,transitionTicks:4,transition:'linear'}};const r2=new CameraPreview(source(c),c.collider);r2.reset(s);const v=r2.step(c.observations[1]!.state),out=r2.step({...s,tick:2});expect(out.transition?.fromZoneId).toBe(entered.zoneId);expect(out.effective.zoom).toBe(v.effective.zoom+(c.camera.defaults.zoom-v.effective.zoom)/4);expect(out.transition?.elapsedTicks).toBe(1);
});
test('malformed source identity, normalized sums, references, audio MIME, actor sequencing and budgets reject atomically',()=>{
 const c=cases[0]!,m=source(c),s=c.observations[0]!.state;
 for(const mutate of [(m:any)=>m.camera.model.key='engine.camera',(m:any)=>m.camera.defaults.deadZone=[.75,0,.5,1],(m:any)=>m.camera.zones=[{...map.camera.zones[0],regionId:'missing'}],(m:any)=>m.camera.defaults.zoom=0,(m:any)=>m.camera.defaults.script='execute()',(m:any)=>m.camera.zones=Array.from({length:257},(_,i)=>({...map.camera.zones[0],id:'camera.'+i}))]){const bad=structuredClone(m);mutate(bad);expect(()=>new CameraPreview(bad,c.collider)).toThrow();}
 const audioBase=source(cases.find(c=>c.id==='audio-fade')!),audio={...audioBase,assets:audioBase.assets.map(a=>a.id==='asset.camera-silence'?{...a,mediaType:'image/png' as const}:a)};expect(()=>new CameraPreview(audio,c.collider)).toThrow('audio asset');
 expect(()=>new CameraPreview(m,{width:0,height:48})).toThrow();expect(()=>new CameraPreview(m,{width:1/256,height:48})).toThrow('precision');
 const r=new CameraPreview(m,c.collider),v=r.reset(s);for(const state of [{...s,tick:2},{...s,tick:1,x:NaN},{...s,tick:1,y:Infinity},{...s,tick:1,vx:.5}]){expect(()=>r.step(state)).toThrow();expect(r.getSnapshot()).toBe(v);}expect(r.step({...s,tick:1}).tick).toBe(1);expect(r.reset({...s,tick:100}).transition).toBe(null);
});
test('typed camera/environment field transactions preserve IDs and reject unknown fields and invalid graph refs',()=>{
 const n=normalize(map as unknown as JsonValue);if(!n.ok)throw Error('fixture');const before=canonical(denormalize(n.model)),camera={...map.camera,defaults:{...map.camera.defaults,zoom:2}},m=candidate(n.model,presentationEdit(n.model,'camera',camera as unknown as JsonValue));expect((denormalize(m) as unknown as MapDocument).camera).toEqual(camera);expect(canonical(denormalize(n.model))).toBe(before);
 const changed=candidate(m,presentationEdit(m,'environment',{...map.environment,ambientColor:'#123456'} as unknown as JsonValue));expect(validateSourceGraph([denormalize(changed),...sources.filter(s=>(s as {id:string}).id!==map.id)]).ok).toBe(true);expect((denormalize(changed) as unknown as MapDocument).camera.zones.map(z=>z.id)).toEqual(map.camera.zones.map(z=>z.id));
 expect(()=>presentationEdit(n.model,'camera',{...camera,script:'run()'} as unknown as JsonValue)).toThrow();const invalid={...camera,zones:camera.zones.map(z=>({...z,regionId:'missing'}))};const candidateModel=candidate(n.model,presentationEdit(n.model,'camera',invalid as unknown as JsonValue));expect(validateSourceGraph([denormalize(candidateModel),...sources.filter(s=>(s as {id:string}).id!==map.id)]).ok).toBe(false);expect(canonical(denormalize(n.model))).toBe(before);
});
test('camera/environment intent cannot feed physics; publication and pause never advance smoothing',()=>{
 const m=source(cases[0]!),closure=[m as unknown as JsonValue,...sources.filter(s=>(s as {id:string}).id!==m.id)],r=new PortalTestSession(m,profile,closure),raw=new TestSession(m as never,profile),before=canonical(m as unknown as JsonValue),initial=r.getSnapshot().camera;
 const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('camera must not fetch'));
 try{r.pause();expect(r.getSnapshot().camera).toEqual(initial);r.pause(false);expect(r.getSnapshot().camera).toEqual(initial);for(let i=0;i<60;i++){const input={...NEUTRAL,jump:i<20};r.advance(input);raw.advance(input);expect(r.getSnapshot().state).toEqual(raw.getSnapshot().state);expect(r.getSnapshot().camera?.tick).toBe(r.getSnapshot().state.tick);}const final=r.getSnapshot().camera,record=r.recording();r.reset();expect(r.getSnapshot().camera).toEqual(initial);r.replay(record);expect(r.getSnapshot().camera).toEqual(final);expect(canonical(m as unknown as JsonValue)).toBe(before);expect(fetch).not.toHaveBeenCalled();}finally{fetch.mockRestore();}
});
test('portal arrival clears camera smoothing and event injection does not sample',()=>{
 const p='conformance/portals/',docs=walk(p+'sources').map(f=>JSON.parse(readFileSync(f,'utf8')) as JsonValue),m=docs.find(s=>(s as {id:string}).id==='map.forest') as unknown as MapDocument,record=JSON.parse(readFileSync(p+'journey.input.json','utf8')) as PortalRecording,r=new PortalTestSession(m,profile,docs),first=r.getSnapshot().camera;r.injectEvent({key:'core.encounter.cleared',version:1},'encounter.boss');expect(r.getSnapshot().camera).toEqual(first);r.interact('portal.clearing');r.advance();r.advance();const v=r.getSnapshot(),destination=docs.find(s=>(s as {id:string}).id===v.mapId) as unknown as MapDocument;expect(v.mapId).toBe('map.clearing');expect(v.camera).toEqual(new CameraPreview(destination,profile.collider as {width:number;height:number}).reset(v.state));r.replay(record);expect(r.getSnapshot().camera?.mapId).toBe(r.getSnapshot().mapId);
});
test('preview work refusal is diagnosed separately and leaves physical ticks available',()=>{
 const c=cases[0]!,base=source(c),m={...base,camera:{...base.camera,zones:Array.from({length:257},(_,i)=>({...map.camera.zones[0]!,id:'camera.budget.'+i}))}};const r=new PortalTestSession(m,profile,[m as unknown as JsonValue,...sources.filter(s=>(s as {id:string}).id!==m.id)]);expect(r.getSnapshot().camera).toBe(null);expect(r.getSnapshot().cameraDiagnosis).toContain('budget');expect(r.advance(NEUTRAL).status).toBe('ok');expect(r.getSnapshot().state.tick).toBe(1);
});
test('isolated final-byte oracle rejects coherently rehashed locked-center and zone-winner corruption',()=>{
 const dir=mkdtempSync(join(tmpdir(),'maplab-camera-consumer-'));try{cpSync(root,join(dir,'fixtures'),{recursive:true});cpSync('tests/consumer/camera.mjs',join(dir,'consumer.mjs'));const exec=()=>execFileSync(process.execPath,[join(dir,'consumer.mjs'),join(dir,'fixtures')],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']});expect(JSON.parse(exec()).verified).toBe(true);
 const corrupt=(file:string,change:(v:any)=>void)=>{const path=join(dir,'fixtures',file),v=JSON.parse(readFileSync(path,'utf8'));change(v);writeFileSync(path,JSON.stringify(v)+'\n');const ip=join(dir,'fixtures/index.json'),index=JSON.parse(readFileSync(ip,'utf8'));index.files.find((f:{path:string})=>f.path===file).sha256=createHash('sha256').update(readFileSync(path)).digest('hex');writeFileSync(ip,JSON.stringify(index));};
 corrupt('small-bounds.expected.json',v=>{v[0].center[0]+=1;v[0].view[0]+=1;v[0].deadZoneWorld[0]+=1;});expect(exec).toThrow();cpSync(root,join(dir,'fixtures'),{recursive:true});corrupt('zone-ties.expected.json',v=>{v[0].zoneId='camera.b';v[0].activeZoneIds.reverse();});expect(exec).toThrow();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('camera regions reuse strict circle/polygon full-body geometry and expose equal-priority warnings',()=>{
 const c=structuredClone(cases.find(c=>c.id==='zone-ties')!),base=source(c),s=c.observations[0]!.state,region=base.regions.find(r=>r.id==='region.camera-probe')!;
 for(const shape of [{kind:'circle' as const,center:[640,620] as const,radius:10},{kind:'polygon' as const,points:[[630,580],[650,580],[650,660],[630,660]] as const}]){
  const m={...base,regions:base.regions.map(r=>r.id===region.id?{...r,shape}:r)},r=new CameraPreview(m,c.collider);expect(r.reset(s).zoneId).toBe('camera.a');expect(r.reset({...s,x:600*256}).zoneId).toBe(null);expect(r.reset(s).warnings.some(w=>w.includes('Equal-priority camera'))).toBe(true);
 }
});
test('input ownership and sample budget cannot leave partial preview state; reset recovers',()=>{
 const c=structuredClone(cases.find(c=>c.id==='small-bounds')!),m=source(c),collider={...c.collider},s=c.observations[0]!.state,r=new CameraPreview(m,collider);collider.width=1000;(m as any).camera.defaults.bounds[0]=999;expect(r.source.camera.defaults.bounds[0]).toBe(100);expect(Object.isFrozen(r.source.camera.defaults)).toBe(true);r.reset(s);for(let tick=1;tick<=3600;tick++)r.step({...s,tick});const last=r.getSnapshot();expect(()=>r.step({...s,tick:3601})).toThrow('budget');expect(r.getSnapshot()).toBe(last);expect(r.reset({...s,tick:3601}).center).toEqual([140,230]);expect(r.step({...s,tick:3602}).tick).toBe(3602);
});
