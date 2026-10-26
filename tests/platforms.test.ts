import {test,expect} from 'vitest';
import {readFileSync,readdirSync,mkdtempSync,realpathSync,cpSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import type {MapDocument,MovementDocument,Motion,JsonValue} from '../src/contracts';
import {canonical,validateSourceGraph} from '../src/contracts';
import {platformStep,type PlatformStep} from '../src/platforms/runtime';
import {platformWorld} from '../src/platforms/world';import {motionOffset} from '../src/platforms/motion';
import {createWorld,step,overlaps,type State,type ContactMap} from '../src/physics-reference';
import {TestSession,NEUTRAL} from '../src/test-runtime/session';import {GameplaySession} from '../src/gameplay/runtime';
import {buildSurfaceGraph} from '../src/navigation/surface';import {buildAirborneActions} from '../src/navigation/airborne';
import {normalize,denormalize} from '../src/domain/model';import {candidate} from '../src/editor/editing';import {platformMotion} from '../src/editor/platforms';
import {exportLibrary} from '../src/library/export';
const root='conformance/platforms',read=(p:string):any=>JSON.parse(readFileSync(join(root,p),'utf8')),names:string[]=read('cases.json').cases;
const fixture=(name:string)=>read(name+'.fixture.json'),map=(name:string):MapDocument&ContactMap=>read(name+'.map.json'),profile=():MovementDocument=>read('player.movement.json');
const projection=(f:PlatformStep)=>({status:f.status,state:f.state,platformStatus:f.platforms.status,events:f.platforms.events});
function run(c:any,m:MapDocument&ContactMap=read(c.map)){
 let s:State=c.initial;const frames:PlatformStep[]=[];
 for(let n=0;n<c.ticks;n++){const {fromTick:_,...input}=c.input.filter((i:any)=>i.fromTick<=s.tick).at(-1);const f=platformStep(m,profile(),s,input);frames.push(f);s=f.state;if(f.status!=='ok')break;}
 return frames;
}
test('owned final-byte fixture inventory binds every file, source contract and exact checkpoint',()=>{
 const ix=read('index.json');expect(ix.license).toBe('CC0-1.0');expect(ix.files.map((f:any)=>f.path).sort()).toEqual(readdirSync(root).filter(f=>f!=='index.json').sort());
 for(const f of ix.files)expect(createHash('sha256').update(readFileSync(join(root,f.path))).digest('hex'),f.path).toBe(f.sha256);
});
test.each(names)('exact carry/push/departure/phase/disable/crush trace, repeats and resumes: %s',name=>{
 const c=read(name),m=read(c.map),before=JSON.stringify([m,c,profile()]),frames=run(c,m);
 expect(frames.map(projection)).toEqual(c.expect);expect(JSON.stringify(run(c,m))).toBe(JSON.stringify(frames));expect(JSON.stringify([m,c,profile()])).toBe(before);
 const reversed={...m,bodies:[...m.bodies].reverse(),footholds:[...m.footholds].reverse()};expect(run(c,reversed)).toEqual(frames);
 for(const f of frames.filter(f=>f.status==='ok')){expect(overlaps(platformWorld(m,profile(),f.state.tick),f.state.x,f.state.y)).toBe(false);for(const b of m.bodies)expect(f.platforms.offsets[b.id]).toEqual(b.motion?motionOffset(b.motion,f.state.tick):[0,0]);}
 if(frames.length>1){const s=frames[0]!.state,resumed=run({...c,initial:s,ticks:c.ticks-1});expect(resumed).toEqual(frames.slice(1));}
});
test('integer schedule: negative floor interpolation, loop closure, once clamp, safe absolute phase and strict unsupported input',()=>{
 const m:Motion={...map('elevator').bodies[0]!.motion!,points:[[0,0],[-.0625,.0625]],legTicks:[3]};
 expect([1,2,3,4].map(t=>motionOffset(m,t))).toEqual([[-6,5],[-11,10],[-16,16],[-16,16]]);
 const loop:Motion={...m,mode:'loop',points:[[0,0],[1,0],[0,0]],legTicks:[2,2]};expect([0,1,2,3,4,5].map(t=>motionOffset(loop,t))).toEqual([[0,0],[128,0],[256,0],[128,0],[0,0],[128,0]]);
 expect(motionOffset({...loop,initialPhaseTicks:3},Number.MAX_SAFE_INTEGER)).toEqual([256,0]);
 for(const bad of [{...m,legTicks:[0]},{...m,initialPhaseTicks:4},{...m,mode:'loop'},{...m,points:Array(257).fill([0,0]),legTicks:Array(256).fill(1)},{...m,easing:'bezier'}])expect(()=>motionOffset(bad as Motion,0)).toThrow();
 for(const tick of [-1,NaN,Number.MAX_SAFE_INTEGER+1])expect(()=>motionOffset(m,tick)).toThrow();
});
test('malformed schedules, initial overlap/support, integer overflow, body/face and equal-contact budgets refuse atomically',()=>{
 const m=map('elevator'),c=fixture('elevator'),p=profile();
 const cases=[{...m,bodies:m.bodies.map(b=>({...b,motion:null}))},{...m,bodies:m.bodies.map(b=>({...b,motion:{...b.motion!,legTicks:[0]}}))},
 {...m,bodies:Array.from({length:17},(_,i)=>({...m.bodies[0]!,id:'body.extra-'+i,shapes:[{id:'shape.extra-'+i,kind:'rect' as const,rect:[300,300,1,1] as const}]})),footholds:[]},
 {...m,bodies:[{...m.bodies[0]!,shapes:Array.from({length:1025},(_,i)=>({id:'shape.budget-'+i,kind:'rect' as const,rect:[300,300,1,1] as const}))}],footholds:[]}];
 for(const bad of cases){const f=platformStep(bad as ContactMap,p,c.initial,NEUTRAL);expect(f.status).toBe('unsupported');expect(f.state).toBe(c.initial);}
 for(const s of [{...c.initial,y:110*256},{...c.initial,supportId:'missing'},{...c.initial,resources:{airJumps:1,dashCharges:0,cooldowns:{}}}])expect(platformStep(m,p,s,NEUTRAL).status).toBe('invalidState');
 expect(platformStep(m,p,{...c.initial,tick:Number.MAX_SAFE_INTEGER},NEUTRAL).status).toBe('unsafeInteger');
 const clip=map('carry-clipped'),wall=clip.bodies[1]!;const budget={...clip,bodies:[clip.bodies[0]!,...Array.from({length:9},(_,i)=>({...wall,id:'body.wall-'+i,shapes:wall.shapes.map(sh=>({...sh,id:'shape.wall-'+i}))}))]};
 const f=platformStep(budget,p,c.initial,NEUTRAL);expect(f.status).toBe('contactBudget');expect(f.state).toBe(c.initial);
});
test('authoring is undoable source data; registered solid enablement stays coherent and invalid edits leave the model untouched',()=>{
 const source=map('authoring'),n=normalize(source as unknown as JsonValue);if(!n.ok)throw Error('fixture model');const before=JSON.stringify(denormalize(n.model)),motion=map('elevator').bodies[0]!.motion!;
 const disabled=candidate(n.model,platformMotion(n.model,'body.floor',motion,false)),d=denormalize(disabled) as unknown as MapDocument;
 expect(d.bodies[0]!.enabled).toBe(false);expect(d.footholds[0]!.enabled).toBe(false);expect(d.bodies[0]!.motion).toEqual(motion);expect(validateSourceGraph([d,profile()] as unknown as JsonValue[]).ok).toBe(true);
 const restored=denormalize(candidate(disabled,platformMotion(disabled,'body.floor',null,true))) as unknown as MapDocument;expect(restored).toEqual(source);
 expect(()=>platformMotion(n.model,'body.floor',{...motion,initialPhaseTicks:999},true)).toThrow();expect(JSON.stringify(denormalize(n.model))).toBe(before);
});
test('integrated Test carries, records/resumes, stops on crush and preserves authored bytes; static controller parity remains exact',()=>{
 for(const name of ['elevator','jump-addPlatformVelocity','ceiling-crush']){const c=fixture(name),m=map(name),before=JSON.stringify(m),s=new TestSession(m,profile(),c.initial);const {fromTick:_,...controls}=c.input[0];for(let n=0;n<c.ticks;n++)s.advance(controls);const frames=s.getSnapshot().frames;expect(frames.map(f=>projection(f as PlatformStep))).toEqual(c.expect);const recording=s.recording();s.reset();s.replay(recording);expect(s.getSnapshot().frames).toEqual(frames);expect(JSON.stringify(m)).toBe(before);}
 const c=fixture('elevator'),m=map('authoring'),s=c.initial;expect(platformStep(m,profile(),s,NEUTRAL)).toMatchObject(step(createWorld(m,profile()),s,NEUTRAL));
});
test('tick-zero gameplay body disable detaches a registered solid rider through the real Test snapshot and replays',()=>{
 const m:any=map('authoring'),p=profile(),catalog=JSON.parse(readFileSync('placeholder-library/catalogs/core.catalog.json','utf8'));m.bodies=[{...m.bodies[0]!,mobility:'kinematic',motion:map('elevator').bodies[0]!.motion}];
 m.dependencies=[...m.dependencies,{id:catalog.id,kind:'catalog',path:'catalogs/core.catalog.json',required:true}];m.regions=[{id:'region.disable',name:'Disable',shape:{kind:'rect',rect:[0,40,256,100]},role:'trigger'} as never];
 m.triggers=[{id:'trigger.disable',regionId:'region.disable',event:'enter',actorCategories:['player'],once:true,conditions:[],actions:[{key:'core.body.set-enabled',version:1,params:{target:{ref:{kind:'body',id:'body.floor'}},enabled:false}}]}];
 const s=new TestSession(m,p,undefined,source=>new GameplaySession(source as unknown as MapDocument,[p,catalog] as unknown as JsonValue[]));expect(s.getSnapshot().gameplay?.bodies['body.floor']).toBe(false);const f=s.advance(NEUTRAL) as PlatformStep;expect(f.status).toBe('ok');expect(f.state.mode).toBe('air');expect(f.platforms.events).toContainEqual({kind:'disabled',bodyId:'body.floor',deltaSu:[0,0]});const rec=s.recording();s.replay(rec);expect(s.getSnapshot().frame).toEqual(f);
});
test('static navigation explicitly refuses moving sources and publishes no timed rendezvous edges',async()=>{
 const m=map('elevator'),p=profile();const g=await buildSurfaceGraph(m,p,1);expect(g.status).toBe('unsupported');expect(g.edges).toEqual([]);expect(g.canCertify).toBe(false);
 const a=await buildAirborneActions(m,p,1);expect(a.status).toBe('unsupported');expect(a.edges).toEqual([]);
});
test('isolated independent final-byte importer and rectangular oracle reject coherently rehashed forged traces and motion',async()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'maplab-platform-consumer-')));try{
 const library=join(dir,'library');cpSync('placeholder-library',library,{recursive:true});const ix=JSON.parse(readFileSync(join(library,'maplab.project.json'),'utf8')),m:any=map('authoring'),p=profile();m.bodies=[{...m.bodies[0]!,mobility:'kinematic',motion:map('elevator').bodies[0]!.motion}];
 for(const d of [{doc:m,kind:'map',path:'maps/platform.map.json'},{doc:p,kind:'movement',path:'movement/platform.movement.json'}]){const b=JSON.stringify(d.doc);writeFileSync(join(library,d.path),b);ix.documents.push({id:d.doc.id,kind:d.kind,path:d.path,sha256:createHash('sha256').update(b).digest('hex')});}writeFileSync(join(library,'maplab.project.json'),JSON.stringify(ix));
 const hash=createHash('sha256').update(readFileSync(join(library,'maps/platform.map.json'))).digest('hex'),bundle=await exportLibrary({dir:library,label:'Owned platform fixture',placeholder:false},m.id,hash),again=await exportLibrary({dir:library,label:'Owned platform fixture',placeholder:false},m.id,hash);expect(bundle.zip).toEqual(again.zip);
 for(const [path,bytes] of bundle.files){mkdirSync(dirname(join(dir,'bundle',path)),{recursive:true});writeFileSync(join(dir,'bundle',path),bytes);}
 cpSync(root,join(dir,'fixtures'),{recursive:true});cpSync('schemas',join(dir,'schemas'),{recursive:true});cpSync('tests/consumer/reader',join(dir,'reader'),{recursive:true});cpSync('tests/consumer/platforms.mjs',join(dir,'consumer.mjs'));
 const reports=Object.fromEntries(names.map(n=>{const c=read(n);return [c.id,run(c).map(projection)];}));writeFileSync(join(dir,'reports.json'),JSON.stringify(reports));
 const consume=()=>execFileSync(process.execPath,[join(dir,'consumer.mjs'),join(dir,'fixtures'),join(dir,'reports.json'),join(dir,'bundle'),join(dir,'schemas')],{cwd:dir,encoding:'utf8',stdio:'pipe'});expect(JSON.parse(consume())).toMatchObject({verified:true,cases:names.length,exportedElevator:true});
 const path=join(dir,'fixtures/elevator.fixture.json'),f=JSON.parse(readFileSync(path,'utf8'));f.expect[0].state.y++;writeFileSync(path,JSON.stringify(f));const index=JSON.parse(readFileSync(join(dir,'fixtures/index.json'),'utf8'));index.files.find((v:any)=>v.path==='elevator.fixture.json').sha256=createHash('sha256').update(readFileSync(path)).digest('hex');writeFileSync(join(dir,'fixtures/index.json'),JSON.stringify(index));expect(consume).toThrow('independent platform trace');
 cpSync(root,join(dir,'fixtures'),{recursive:true});const exported=join(dir,'bundle/maps/platform.map.json'),forged=JSON.parse(readFileSync(exported,'utf8'));forged.bodies[0].motion.legTicks[0]=8;const forgedBytes=canonical(forged);writeFileSync(exported,forgedBytes);const manifestPath=join(dir,'bundle/manifest.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8')),entry=manifest.files.find((v:any)=>v.path==='maps/platform.map.json');entry.sha256=createHash('sha256').update(forgedBytes).digest('hex');entry.bytes=Buffer.byteLength(forgedBytes);writeFileSync(manifestPath,canonical(manifest));expect(consume).toThrow('independent platform trace');
 }finally{rmSync(dir,{recursive:true,force:true});}
},60000);
