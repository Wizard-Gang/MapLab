import {test,expect} from 'vitest';
import {readFileSync,readdirSync,mkdtempSync,realpathSync,cpSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {ActionWorld,coast,type ActionFrame} from '../src/actions/controller';
import {planActions,actionIdentity,actionStateKey,ACTION_DEFAULTS} from '../src/actions/planner';
import {ActionTestSession,replayActions} from '../src/actions/replay';
import {applyModifier,effectiveProfile,effectiveProfileHash} from '../src/actions/modifiers';
import {ActionSession,createActionEndpoint,type ActionRequest,type ActionReply} from '../src/actions/protocol';
import {ACTION_MOTOR_SHA256,ACTION_MODIFIERS_SHA256,ACTION_PLANNER_SHA256} from '../src/actions/identity';
import {validateSourceGraph,canonical,type JsonValue} from '../src/contracts';import {exportLibrary} from '../src/library/export';
const root='conformance/actions',read=(f:string):any=>JSON.parse(readFileSync(join(root,f),'utf8')),sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex'),sync=async()=>{};
const cases:any[]=read('cases.json'),traces:any[]=read('traces.json'),steps:any[]=read('steps.json'),initial=cases[0].query.initial;
const solve=(c:any)=>planActions(read(c.map),read(c.profile),c.query,1,ACTION_DEFAULTS,()=>false,sync);
const single=(c:any):ActionFrame=>{try{return new ActionWorld(read(c.map),read(c.profile)).step(c.initial,c.input);}catch(e){return {status:'unsupported',state:c.initial,input:c.input,contacts:[],reason:String(e)};}};
test('owned action inventory, final source identity and closed source graph',()=>{
 const index=read('index.json');expect(index.license).toBe('CC0-1.0');expect(index.files.map((f:any)=>f.path).sort()).toEqual(readdirSync(root).filter(f=>f!=='index.json').sort());for(const f of index.files)expect(sha(readFileSync(join(root,f.path))),f.path).toBe(f.sha256);
 for(const [file,pin] of [['controller',ACTION_MOTOR_SHA256],['modifiers',ACTION_MODIFIERS_SHA256],['planner',ACTION_PLANNER_SHA256]])expect(sha(readFileSync('src/actions/'+file+'.ts'))).toBe(pin);
 const docs=readdirSync(root).filter(f=>/\.(map|movement|catalog)\.json$/.test(f)).map(read);expect(validateSourceGraph(docs as JsonValue[]).diagnostics.filter(d=>d.severity==='error')).toEqual([]);
});
for(const c of cases)test('bounded stateful action route '+c.id,async()=>{
 const m=read(c.map),p=read(c.profile),before=JSON.stringify({m,p,q:c.query}),proof=await solve(c);expect(JSON.stringify({m,p,q:c.query})).toBe(before);expect(proof.status,proof.diagnostics.join(';')).toBe(c.status);expect(proof.canCertify).toBe(false);expect(proof.complete).toBe(false);expect(proof.heuristic).toBe('zero');
 if(c.costTicks!==undefined){expect(proof.costTicks).toBe(c.costTicks);expect(proof.effectiveProfileHashes).toHaveLength(proof.frames.length+1);const session=new ActionTestSession(new ActionWorld(m,p),c.query.initial);expect(session.replay(proof.frames)).toBe(true);expect(session.state).toEqual(proof.terminal);expect(replayActions(session.world,c.query.initial,proof.frames)).toEqual(proof.frames);expect((await planActions(m,p,{...c.query,algorithm:'dijkstra'},1,ACTION_DEFAULTS,()=>false,sync)).costTicks).toBe(proof.costTicks);}
 else {expect(proof.frames).toEqual([]);expect(proof.terminal).toBeNull();}
},60000);
for(const c of traces)test('exact integer action checkpoints '+c.id,()=>{
 const session=new ActionTestSession(new ActionWorld(read(c.map),read(c.profile)),c.initial);for(let i=0;i<c.inputs.length;i++){const f=session.tick(c.inputs[i]);expect(f.status,f.reason).toBe('ok');expect(f.state).toEqual(c.expected[i]);}
 const frames=session.recording().frames;expect(replayActions(session.world,c.initial,frames)).toEqual(frames);const forged=structuredClone(frames) as any[];forged[0].state.x++;expect(replayActions(session.world,c.initial,forged)).toBeNull();
});
for(const c of steps)test('action destination/recovery rejection '+c.id,()=>{
 const f=single(c);expect(f.status,f.reason).toBe(c.status);if(f.status!=='ok')expect(f.state).toEqual(c.initial);
 if(c.id==='thin-wall-knockback'){expect(f.state.x).toBe(27*256);expect(f.contacts).toMatchObject([{bodyId:'body.wall',shapeId:'shape.wall',edgeIndex:3,axis:'x'}]);}
 if(c.id==='launch-recovery-control')expect(f.state.vx).toBe(224);if(c.id==='launch-locked-control')expect(f.state.vx).toBe(256);
});
test('rational stack, single truncation, clamp, replacement, expiry and effective hash',async()=>{
 const p=read('actions.movement.json'),input=traces[1].inputs[0],call=(num:number,den:number)=>({...input.definition,params:{...input.definition.params,num,den}});
 let a=applyModifier(p,[],'buff.a',call(16,1));a=applyModifier(p,a,'buff.b',call(16,1));expect(effectiveProfile(p,a).ground.runSpeed).toBe(8192);
 const fractional={...p,ground:{...p.ground,runSpeed:1}};const x=applyModifier(p,[],'buff.a',call(3,2)),y=applyModifier(p,x,'buff.b',call(3,2));expect(effectiveProfile(fractional,y).ground.runSpeed).toBe(2);
 const replace=read('replace.movement.json'),r=applyModifier(replace,applyModifier(replace,[],'buff.a',call(2,1)),'buff.b',call(3,1));expect(r).toHaveLength(1);expect(effectiveProfile(replace,r).ground.runSpeed).toBe(768);
 expect(await effectiveProfileHash(p,y)).toBe(await effectiveProfileHash(p,[...y].reverse()));expect(await effectiveProfileHash(p,y)).not.toBe(await effectiveProfileHash(p,y.map(v=>({...v,ticksLeft:v.ticksLeft-1}))));expect(await effectiveProfileHash(p,[])).not.toBe(await effectiveProfileHash(p,y));
 for(const bad of [call(17,1),call(1,0),{...call(1,1),params:{...call(1,1).params,extra:0}},{...call(1,1),key:'unknown.modifier'}])expect(()=>applyModifier(p,[],'buff.bad',bad)).toThrow();
 expect(()=>applyModifier(p,[],'bad id',call(1,1))).toThrow();expect(()=>effectiveProfile(replace,y)).toThrow('replacement');
});
test('cache identity retains state, profile and physical changes; stale/cancelled workers publish nothing',async()=>{
 const m=read('open.map.json'),p=read('actions.movement.json'),q=cases[0].query,id=await actionIdentity(m,p,initial,ACTION_DEFAULTS);
 for(const s of [{...initial,tick:1},{...initial,cooldownTicks:1},{...initial,launched:true},traces[1].expected[0]]){expect(actionStateKey(s)).not.toBe(actionStateKey(initial));expect((await actionIdentity(m,p,s,ACTION_DEFAULTS)).cacheKey).not.toBe(id.cacheKey);}
 const art={...m,metadata:{...m.metadata,name:'Art only'}};expect((await actionIdentity(art,p,initial,ACTION_DEFAULTS)).cacheKey).toBe(id.cacheKey);
 expect((await actionIdentity(m,{...p,air:{...p.air,gravity:p.air.gravity+1}},initial,ACTION_DEFAULTS)).cacheKey).not.toBe(id.cacheKey);
 const moved=structuredClone(m);moved.bodies[0].position[0]++;expect((await actionIdentity(moved,p,initial,ACTION_DEFAULTS)).cacheKey).not.toBe(id.cacheKey);
 const requests:ActionRequest[]=[],session=new ActionSession(r=>requests.push(r));await session.solve(m,p,q,7);const r=requests.at(-1)!;const proof=await planActions(m,p,q,7,ACTION_DEFAULTS,()=>false,sync);expect(session.accept({kind:'proof',job:r.job,proof:{...proof,querySha256:'stale'}})).toBe(false);expect(session.accept({kind:'proof',job:r.job,proof:{...proof,revision:6}})).toBe(false);session.invalidate();expect(session.accept({kind:'proof',job:r.job,proof})).toBe(false);session.dispose();
 const replies:ActionReply[]=[],endpoint=createActionEndpoint(r=>replies.push(r));const pending=endpoint({...r,job:99});await endpoint({kind:'cancel',job:99});await pending;expect(replies).toEqual([]);
});
test('bounded failures and unsupported combinations never return partial success',async()=>{
 const m=read('open.map.json'),p=read('actions.movement.json'),q={...cases[0].query,actions:[],goal:{...cases[0].query.goal,x:63*256}};
 for(const limits of [{maxReplayTicks:1},{maxSamples:1},{maxExpanded:1},{maxRouteTicks:1}]){const proof=await planActions(m,p,q,0,{...ACTION_DEFAULTS,...limits},()=>false,sync);expect(proof.status).toBe('budget');expect(proof.frames).toEqual([]);expect(proof.terminal).toBeNull();}
 expect((await planActions(m,p,q,0,ACTION_DEFAULTS,()=>true,sync)).status).toBe('cancelled');await expect(planActions(m,p,q,0,{...ACTION_DEFAULTS,maxRouteTicks:Infinity})).rejects.toThrow('settings');
 const w=new ActionWorld(m,p);for(const s of [{...initial,vx:NaN},{...initial,tick:Number.MAX_SAFE_INTEGER-1},{...initial,cooldownTicks:-1},{...initial,extra:1},{...initial,modifiers:[{}]},{...initial,supportId:'stale'}])expect(w.step(s as any,coast()).status).toBe('invalidState');
 expect(w.step(initial,{kind:'coast',moveX:2} as any).status).toBe('invalidState');expect(()=>new ActionWorld(m,{...p,abilities:[]})).toThrow();expect(()=>new ActionWorld(m,read('unknown.movement.json'))).toThrow();
 for(const mutate of [(v:any)=>v.bodies[0].mobility='kinematic',(v:any)=>v.navigation.links.push({id:'unsupported'})]){const v=structuredClone(m);mutate(v);expect(()=>new ActionWorld(v,p)).toThrow();}
});
test('independent final-byte consumer rejects forged controls, contacts, expiry and rehashed profile',async()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'maplab-actions-consumer-')));try{
  const library=join(dir,'library');cpSync('placeholder-library',library,{recursive:true});const index=JSON.parse(readFileSync(join(library,'maplab.project.json'),'utf8'));index.documents=[];index.defaults.movementId='movement.actions';
  for(const name of readdirSync(root).filter(f=>/\.(map|movement|catalog)\.json$/.test(f))){const doc=read(name),kind=doc.format.slice(7),path=(kind==='map'?'maps/':kind==='catalog'?'catalogs/':'movement/')+name,bytes=JSON.stringify(doc);mkdirSync(dirname(join(library,path)),{recursive:true});writeFileSync(join(library,path),bytes);index.documents.push({id:doc.id,kind,path,sha256:sha(bytes)});}writeFileSync(join(library,'maplab.project.json'),JSON.stringify(index));
  const bundle=await exportLibrary({dir:library,label:'Owned action fixtures',placeholder:false},'map.actions',sha(readFileSync(join(library,'maps/open.map.json'))));for(const [path,bytes] of bundle.files){mkdirSync(dirname(join(dir,'bundle',path)),{recursive:true});writeFileSync(join(dir,'bundle',path),bytes);}
  cpSync(root,join(dir,'fixtures'),{recursive:true});cpSync('schemas',join(dir,'schemas'),{recursive:true});cpSync('tests/consumer/reader',join(dir,'reader'),{recursive:true});cpSync('tests/consumer/actions.mjs',join(dir,'consumer.mjs'));
  const reports:any={plans:{},traces:{},steps:{}};for(const c of cases)reports.plans[c.id]=await solve(c);for(const c of traces){let s=c.initial;const w=new ActionWorld(read(c.map),read(c.profile));reports.traces[c.id]=c.inputs.map((u:any)=>{const f=w.step(s,u);s=f.state;return f;});}for(const c of steps)reports.steps[c.id]=single(c);
  const path=join(dir,'reports.json'),consume=()=>execFileSync(process.execPath,[join(dir,'consumer.mjs'),join(dir,'fixtures'),path,join(dir,'bundle'),join(dir,'schemas')],{cwd:dir,encoding:'utf8',stdio:'pipe'}),save=(v:unknown)=>writeFileSync(path,JSON.stringify(v));save(reports);expect(JSON.parse(consume())).toMatchObject({verified:true,finalByteImport:true});
  for(const corrupt of [(v:any)=>v.plans['shortcut-anchor'].frames[0].input.target[0]++,(v:any)=>v.traces['launch-and-land'][0].state.vx++,(v:any)=>v.traces['stack-and-expire'][1].state.modifiers[0].ticksLeft++,(v:any)=>v.steps['thin-wall-knockback'].contacts[0].bodyId='wrong.body',(v:any)=>v.plans['shortcut-anchor'].effectiveProfileHashes[0]='stale']){const v=structuredClone(reports);corrupt(v);save(v);expect(consume).toThrow();}save(reports);
  const pp=join(dir,'bundle/movement/actions.movement.json'),profile=JSON.parse(readFileSync(pp,'utf8'));profile.air.gravity++;const bytes=canonical(profile);writeFileSync(pp,bytes);const mp=join(dir,'bundle/manifest.json'),manifest=JSON.parse(readFileSync(mp,'utf8')),entry=manifest.files.find((f:any)=>f.path==='movement/actions.movement.json');entry.sha256=sha(bytes);entry.bytes=Buffer.byteLength(bytes);writeFileSync(mp,canonical(manifest));expect(consume).toThrow('exported action document binding');
 }finally{rmSync(dir,{recursive:true,force:true});}
},120000);
