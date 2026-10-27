import {test,expect} from 'vitest';
import {readFileSync,readdirSync,mkdtempSync,realpathSync,cpSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {planTimedPlatforms,timedIdentity,timedStateKey,TIMED_DEFAULTS} from '../src/platforms/navigation';
import {replayTimed,followTimed,timedStep} from '../src/platforms/replay';
import {phases,WAIT} from '../src/platforms/timing';
import {TIMED_SOURCES} from '../src/platforms/identity';
import {TimedSession,createTimedEndpoint,type TimedRequest,type TimedReply} from '../src/platforms/protocol';
import {buildSurfaceGraph} from '../src/navigation/surface';import {buildAirborneActions} from '../src/navigation/airborne';
import {TestSession} from '../src/test-runtime/session';
import {validateSourceGraph,canonical,type JsonValue} from '../src/contracts';import {exportLibrary} from '../src/library/export';
const root='conformance/timed-platforms',read=(f:string):any=>JSON.parse(readFileSync(join(root,f),'utf8')),sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex'),sync=async()=>{};
const cases:any[]=read('cases.json'),base=cases[0],map=()=>read(base.map),profile=()=>read(base.profile);
const solve=(c:any)=>planTimedPlatforms(read(c.map),read(c.profile),c.query,1,c.settings,()=>false,sync);
test('owned timed corpus binds final bytes, source pins and source graph',()=>{
 const index=read('index.json');expect(index.license).toBe('CC0-1.0');expect(index.files.map((f:any)=>f.path).sort()).toEqual(readdirSync(root).filter(f=>f!=='index.json').sort());
 for(const f of index.files)expect(sha(readFileSync(join(root,f.path))),f.path).toBe(f.sha256);
 expect(Object.keys(TIMED_SOURCES).sort()).toEqual(['motion','navigation','replay','runtime','timing','world']);
 for(const [name,pin] of Object.entries(TIMED_SOURCES))expect(sha(readFileSync('src/platforms/'+name+'.ts')),name).toBe(pin);
 const docs=readdirSync(root).filter(f=>/\.(map|movement)\.json$/.test(f)).map(read);expect(validateSourceGraph(docs as JsonValue[]).diagnostics.filter(d=>d.severity==='error')).toEqual([]);
});
for(const c of cases)test('bounded periodic-platform search '+c.id,async()=>{
 const m=read(c.map),p=read(c.profile),before=JSON.stringify({m,p,q:c.query}),proof=await planTimedPlatforms(m,p,c.query,1,c.settings,()=>false,sync);
 expect(JSON.stringify({m,p,q:c.query})).toBe(before);expect(proof.status,proof.diagnostics.join(';')).toBe(c.status);expect(proof.canCertify).toBe(false);expect(proof.complete).toBe(false);expect(proof.heuristic).toBe('zero');
 if(c.costTicks!==undefined){
  expect(proof.costTicks).toBe(c.costTicks);expect(replayTimed(m,p,c.query.initial,proof.frames)).toEqual(proof.frames);
  const testRun=new TestSession(m,p,c.query.initial);for(const f of proof.frames)expect(testRun.advance(f.input)).toEqual(f.frame);expect(testRun.getSnapshot().state).toEqual(proof.terminal);
  const d=await planTimedPlatforms(m,p,{...c.query,algorithm:'dijkstra'},1,c.settings,()=>false,sync);expect(d.costTicks).toBe(proof.costTicks);expect(d.frames).toEqual(proof.frames);
  expect((await solve(c)).frames).toEqual(proof.frames);expect(proof.safeIntervals).not.toEqual([]);
  for(const interval of proof.safeIntervals){expect(interval.fromTick).toBeGreaterThanOrEqual(c.query.initial.tick);expect(interval.throughTick).toBeLessThanOrEqual(c.query.initial.tick+c.settings.maxRouteTicks);}
 }else{expect(proof.frames).toEqual([]);expect(proof.safeIntervals).toEqual([]);expect(proof.terminal).toBeNull();}
});
test('exact wait/board/ride/exit checkpoints and integer departure velocity',async()=>{
 const proof=await solve(base);expect(proof.frames.map(f=>({tick:f.frame.state.tick,x:f.frame.state.x,y:f.frame.state.y,supportId:f.frame.state.supportId,kind:f.kind}))).toEqual(read('elevator.checkpoints.json'));
 const d=read('departure.fixture.json'),m=read(d.map),p=profile();let s=d.initial;
 for(let n=0;n<d.ticks;n++){const {fromTick:_,...u}=d.input.filter((u:any)=>u.fromTick<=s.tick).at(-1),f=timedStep(m,p,s,u);expect(f).not.toBeNull();expect({status:f!.frame.status,state:f!.frame.state,platformStatus:f!.frame.platforms.status,events:f!.frame.platforms.events}).toEqual(d.expect[n]);s=f!.frame.state;}
});
test('phase feedback, actor/contact drift, stale source and forged witnesses require replanning',async()=>{
 const m=map(),p=profile(),q=base.query,proof=await solve(base),frames=proof.frames;
 expect(followTimed(m,p,q.initial,frames,0,q.initial,{tick:0,phases:phases(m,0)}).status).toBe('follow');
 expect(followTimed(m,p,q.initial,frames,0,q.initial,{tick:0,phases:phases(m,1)}).status).toBe('replan');
 expect(followTimed(m,p,q.initial,frames,0,{...q.initial,vx:1},{tick:0,phases:phases(m,0)}).status).toBe('replan');
 expect(followTimed(m,p,q.initial,frames,0,q.initial,{tick:1,phases:phases(m,0)}).status).toBe('replan');
 const changed=map();changed.bodies[0].motion.initialPhaseTicks++;expect(replayTimed(changed,p,q.initial,frames)).toBeNull();
 for(const mutate of [(f:any)=>f[0].frame.state.y++,(f:any)=>f[0].phases[0].phaseTicks++,(f:any)=>f[0].kind='ride',(f:any)=>f[0].input.moveX=1]){const forged=structuredClone(frames);mutate(forged);expect(replayTimed(m,p,q.initial,forged)).toBeNull();}
 expect(timedStateKey(q.initial)).not.toBe(timedStateKey({...q.initial,tick:16}));
});
test('timed identities retain phase/profile/settings; static caches and conditional links certify nothing',async()=>{
 const m=map(),p=profile(),q=base.query,id=await timedIdentity(m,p,TIMED_DEFAULTS);
 const art=map();art.metadata.name+=' artwork';expect(await timedIdentity(art,p,TIMED_DEFAULTS)).toEqual(id);
 const phase=map();phase.bodies[0].motion.initialPhaseTicks++;expect((await timedIdentity(phase,p,TIMED_DEFAULTS)).cacheKey).not.toBe(id.cacheKey);
 const coefficient=profile();coefficient.ground.braking++;expect((await timedIdentity(m,coefficient,TIMED_DEFAULTS)).cacheKey).not.toBe(id.cacheKey);
 expect((await timedIdentity(m,p,{...TIMED_DEFAULTS,maxRouteTicks:121})).cacheKey).not.toBe(id.cacheKey);
 expect((await buildSurfaceGraph(m,p,1,undefined,()=>false,sync)).status).toBe('unsupported');expect((await buildAirborneActions(m,p,1,undefined,()=>false,sync)).status).toBe('unsupported');
 const conditional=map();conditional.navigation.links=[{conditions:[{kind:'flag',flagId:'flag.door',value:true}]}];expect((await planTimedPlatforms(conditional,p,q,1,base.settings,()=>false,sync)).status).toBe('unsupported');
});
test('bounded work, invalid inputs, cancellation and unsupported motion return no partial witness',async()=>{
 for(const settings of [{...base.settings,maxExpanded:1},{...base.settings,maxSamples:1},{...base.settings,maxReplayTicks:1},{...base.settings,maxIntervalSamples:1}]){const proof=await planTimedPlatforms(map(),profile(),base.query,1,settings,()=>false,sync);expect(proof.status).toBe('budget');expect(proof.frames).toEqual([]);}
 const cancel=await planTimedPlatforms(map(),profile(),base.query,1,base.settings,()=>true,sync);expect(cancel.status).toBe('cancelled');expect(cancel.frames).toEqual([]);
 let stop=false;const during=await planTimedPlatforms(map(),profile(),base.query,1,base.settings,()=>stop,async()=>{stop=true;});expect(during.status).toBe('cancelled');
 for(const query of [{...base.query,initial:{...base.query.initial,x:0}},{...base.query,initial:{...base.query.initial,tick:Number.MAX_SAFE_INTEGER}},{...base.query,controls:[{...WAIT,moveX:2}]},{...base.query,goal:{...base.query.goal,notAfterTick:-1}}])expect((await planTimedPlatforms(map(),profile(),query,1,base.settings,()=>false,sync)).status).toBe('unsupported');
 const rider=cases.find(c=>c.id==='narrow-rider-sweep');expect(timedStep(read(rider.map),profile(),rider.query.initial,WAIT)?.frame.state.supportId).not.toBe('fh.lift');
});
test('worker refuses stale identities/query/revisions and cancels superseded work',async()=>{
 const sent:TimedRequest[]=[],s=new TimedSession(r=>sent.push(r));await s.solve(map(),profile(),base.query,1,base.settings);const req=sent.at(-1)!;if(req.kind!=='solve')throw Error('missing solve');const proof=await solve(base);
 for(const p of [{...proof,revision:2},{...proof,querySha256:'stale'},{...proof,identity:{...proof.identity,cacheKey:'stale'}},{...proof,canCertify:true}])expect(s.accept({kind:'proof',job:req.job,proof:p} as TimedReply)).toBe(false);
 s.invalidate();expect(s.accept({kind:'proof',job:req.job,proof})).toBe(false);s.dispose();
 const replies:TimedReply[]=[],endpoint=createTimedEndpoint(r=>replies.push(r)),running=endpoint(req);await endpoint({kind:'cancel',job:req.job});await running;expect(replies).toEqual([]);
});
test('independent Node consumer checks exported bytes, timed checkpoints and repaired-digest semantic tampering',async()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'maplab-timed-consumer-')));try{
  const library=join(dir,'library');cpSync('placeholder-library',library,{recursive:true});const index=JSON.parse(readFileSync(join(library,'maplab.project.json'),'utf8'));index.documents=[];index.defaults.movementId=profile().id;
  for(const [name,kind] of [[base.map,'map'],[base.profile,'movement']]){const path=(kind==='map'?'maps/':'movement/')+name,bytes=canonical(read(name!));mkdirSync(dirname(join(library,path)),{recursive:true});writeFileSync(join(library,path),bytes);index.documents.push({id:read(name!).id,kind,path,sha256:sha(bytes)});}writeFileSync(join(library,'maplab.project.json'),JSON.stringify(index));
  const bundle=await exportLibrary({dir:library,label:'Owned timed platform fixtures',placeholder:false},map().id,sha(readFileSync(join(library,'maps/'+base.map))));for(const [path,bytes] of bundle.files){mkdirSync(dirname(join(dir,'bundle',path)),{recursive:true});writeFileSync(join(dir,'bundle',path),bytes);}
  cpSync(root,join(dir,'fixtures'),{recursive:true});cpSync('schemas',join(dir,'schemas'),{recursive:true});cpSync('tests/consumer/reader',join(dir,'reader'),{recursive:true});cpSync('tests/consumer/timed-platforms.mjs',join(dir,'consumer.mjs'));
  const reports:any={};for(const c of cases)reports[c.id]=await solve(c);writeFileSync(join(dir,'reports.json'),JSON.stringify(reports));
  const consume=()=>execFileSync(process.execPath,[join(dir,'consumer.mjs'),join(dir,'fixtures'),join(dir,'reports.json'),join(dir,'bundle'),join(dir,'schemas')],{cwd:dir,encoding:'utf8'});expect(JSON.parse(consume()).verified).toBe(true);
  const report=join(dir,'reports.json'),forged=structuredClone(reports);forged[base.id].frames[0].frame.state.y++;writeFileSync(report,JSON.stringify(forged));expect(consume).toThrow();writeFileSync(report,JSON.stringify(reports));
  const path=join(dir,'bundle/maps/'+base.map),changed=JSON.parse(readFileSync(path,'utf8'));changed.bodies[0].motion.initialPhaseTicks++;const bytes=canonical(changed);writeFileSync(path,bytes);const mp=join(dir,'bundle/manifest.json'),manifest=JSON.parse(readFileSync(mp,'utf8')),entry=manifest.files.find((f:any)=>f.path==='maps/'+base.map);entry.sha256=sha(bytes);entry.bytes=Buffer.byteLength(bytes);writeFileSync(mp,canonical(manifest));expect(consume).toThrow('exported timed document binding');
 }finally{rmSync(dir,{recursive:true,force:true});}
},60000);
