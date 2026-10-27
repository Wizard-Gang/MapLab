import {test,expect} from 'vitest';
import {readFileSync,readdirSync,mkdtempSync,realpathSync,cpSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {GrappleWorld,coast,type GrappleState,type GrappleFrame} from '../src/grapple/controller';import {planGrapple,grappleIdentity,grappleStateKey,GRAPPLE_DEFAULTS,type GrappleProof} from '../src/grapple/planner';import {GrappleTestSession,replayGrapple} from '../src/grapple/replay';import {GrappleSession,createGrappleEndpoint,type GrappleRequest,type GrappleReply} from '../src/grapple/protocol';import {GRAPPLE_MOTOR_SHA256,GRAPPLE_GEOMETRY_SHA256,GRAPPLE_PLANNER_SHA256} from '../src/grapple/identity';
import {ropeClear,rootCeil} from '../src/grapple/geometry';import {validateSourceGraph,canonical,type JsonValue} from '../src/contracts';import {exportLibrary} from '../src/library/export';
const root='conformance/grapple',read=(f:string):any=>JSON.parse(readFileSync(join(root,f),'utf8')),sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex'),sync=async()=>{},cases:any[]=read('cases.json'),traces:any[]=read('traces.json'),steps:any[]=read('steps.json');
const negative={...GRAPPLE_DEFAULTS,maxExpanded:64,maxSamples:1024,maxReplayTicks:4096,maxRouteTicks:8};
const solve=(c:any)=>planGrapple(read(c.map),read(c.profile),c.query,1,c.status==='verified reachable with replay witness'?GRAPPLE_DEFAULTS:negative,()=>false,sync);
test('owned grapple inventory, exact source identity and complete source graph',()=>{
 const index=read('index.json');expect(index.license).toBe('CC0-1.0');expect(index.files.map((f:any)=>f.path).sort()).toEqual(readdirSync(root).filter(f=>f!=='index.json').sort());for(const f of index.files)expect(sha(readFileSync(join(root,f.path))),f.path).toBe(f.sha256);
 for(const [file,pinned] of [['controller',GRAPPLE_MOTOR_SHA256],['geometry',GRAPPLE_GEOMETRY_SHA256],['planner',GRAPPLE_PLANNER_SHA256]])expect(sha(readFileSync('src/grapple/'+file+'.ts'))).toBe(pinned);
 const docs=readdirSync(root).filter(f=>f.endsWith('.map.json')||f.endsWith('.movement.json')).map(read);expect(validateSourceGraph(docs as JsonValue[]).diagnostics.filter(d=>d.severity==='error')).toEqual([]);
});
for(const c of cases)test('bounded grapple plan '+c.id,async()=>{
 const m=read(c.map),p=read(c.profile),before=JSON.stringify({m,p,q:c.query}),proof=await solve(c);expect(JSON.stringify({m,p,q:c.query})).toBe(before);expect(proof.canCertify).toBe(false);expect(proof.complete).toBe(false);
 if(c.status==='verified reachable with replay witness'){
  expect(proof.status,proof.diagnostics.join(';')).toBe(c.status);expect(proof.frames.length).toBeGreaterThan(0);const world=new GrappleWorld(m,p);expect(replayGrapple(world,c.query.initial,proof.frames)).toEqual(proof.frames);const session=new GrappleTestSession(world,c.query.initial);expect(session.replay(proof.frames)).toBe(true);expect(session.state).toEqual(proof.terminal);expect(proof.costTicks).toBe(proof.frames.length);if(c.id==='attach-reel-release')expect(proof.frames.map(f=>f.input.action)).toEqual(['attach','coast','release']);
 }else{expect(c.allowedStatuses??[c.status]).toContain(proof.status);expect(proof.frames).toEqual([]);expect(proof.terminal).toBeNull();}
},60000);
for(const c of traces)test('integer grapple checkpoints '+c.id,()=>{
 const w=new GrappleWorld(read(c.map),read(c.profile)),session=new GrappleTestSession(w,c.initial);for(let i=0;i<c.inputs.length;i++){const f=session.tick(c.inputs[i]);expect(f.status,f.reason).toBe('ok');expect(f.state).toEqual(c.expected[i]);expect(w.valid(f.state)).toBe(true);}expect(session.recording().frames.map(f=>f.state)).toEqual(c.expected);
 expect(replayGrapple(w,c.initial,session.recording().frames)).toEqual(session.recording().frames);const forged=structuredClone(session.recording().frames) as any[];forged[0].state.x++;expect(replayGrapple(w,c.initial,forged)).toBeNull();
});
for(const c of steps)test('finite-body attachment/swing/release '+c.id,()=>{
 const w=new GrappleWorld(read(c.map),read(c.profile)),f=w.step(c.initial,c.input);expect(f.status,f.reason).toBe(c.status);expect(f.contacts).toEqual(c.expectedContacts);if(f.status!=='ok')expect(f.state).toEqual(c.initial);
});
test('straight rope sweep rejects a blocker inside the swept triangle and exact pivot-only contact is allowed',()=>{
 expect(ropeClear([0,0],[-10,20],[10,20],[{a:[-1,10],b:[1,10]}])).toBe(false);
 expect(ropeClear([0,0],[0,20],[0,20],[{a:[-2,0],b:[2,0]}])).toBe(true);
 expect(ropeClear([0,0],[0,20],[0,20],[{a:[0,0],b:[0,3]}])).toBe(false);
 for(const n of [0n,1n,2n,15n,16n,17n,9007199254740991n]){const r=rootCeil(n);expect(r*r>=n).toBe(true);if(r)expect((r-1n)*(r-1n)<n).toBe(true);}
});
test('unsupported geometry/solvers/permissions and malformed runtime states cannot create witnesses',async()=>{
 const m=read('open.map.json'),p=read('grapple.movement.json'),w=new GrappleWorld(m,p),s=cases[0].query.initial,u={...coast(),action:'attach' as const,anchorId:'grapple.ceiling'};
 for(const change of [(v:any)=>v.bodies[0].mobility='kinematic',(v:any)=>v.bodies[0].shapes[0]={id:'shape.anchor',kind:'segment',a:[28,4],b:[36,4]},(v:any)=>v.traversals[0].points=[[32,3]],(v:any)=>v.navigation.links.push({id:'unsupported'})]){const v=structuredClone(m);change(v);expect(()=>new GrappleWorld(v,p)).toThrow();}
 expect(()=>new GrappleWorld(m,{...p,abilities:[]})).toThrow('Unsupported');expect(()=>new GrappleWorld(m,read('unknown.movement.json'))).toThrow('Unsupported');
 expect(()=>new GrappleWorld(m,{...p,grabHeight:p.collider.height+1})).toThrow('harness');const overflow={...traces[1].initial,tick:Number.MAX_SAFE_INTEGER-2};expect(w.step(overflow,{...coast(),action:'release'}).status).toBe('invalidState');
 const forbidden=structuredClone(m);forbidden.traversals[0].requiredAbilities=['not.permitted'];expect(new GrappleWorld(forbidden,p).step(s,u).status).toBe('unsupported');
 const approach=structuredClone(m);approach.regions[0].shape.rect=[0,4,16,40];expect(new GrappleWorld(approach,p).step(s,u).status).toBe('blocked');
 for(const initial of [{...s,vx:NaN},{...s,tick:Number.MAX_SAFE_INTEGER-1},{...s,attachment:{anchorId:'grapple.ceiling',pointIndex:0,length:1}},{...s,attachment:{anchorId:'stale',pointIndex:0,length:5120}},{...s,unexpected:true}])expect(w.step(initial,u).status).toBe('invalidState');
 for(const input of [{...coast(),moveX:2},{...coast(),reel:1},{...coast(),action:'release'},{...u,reel:1},{...u,pointIndex:0.5}])expect(w.step(s,input as any).status).toBe('invalidState');
 const immutable=structuredClone(s),session=new GrappleTestSession(w,immutable);immutable.x++;expect(session.state).toEqual(s);
 const attached=traces[1].initial;expect(grappleStateKey(attached)).not.toBe(grappleStateKey({...attached,vx:attached.vx+1}));expect(grappleStateKey(attached)).not.toBe(grappleStateKey({...attached,attachment:{...attached.attachment,length:5121}}));
});
test('identity includes physics/profile/rope parameters and worker rejects stale/cancelled publication',async()=>{
 const c=cases[0],m=read(c.map),p=read(c.profile),id=await grappleIdentity(m,p,GRAPPLE_DEFAULTS),art={...m,metadata:{...m.metadata,name:'art-only'}};expect((await grappleIdentity(art,p,GRAPPLE_DEFAULTS)).cacheKey).toBe(id.cacheKey);
 const moved=structuredClone(m);moved.bodies[0].position[0]+=1;expect((await grappleIdentity(moved,p,GRAPPLE_DEFAULTS)).cacheKey).not.toBe(id.cacheKey);const changed=structuredClone(p);changed.abilities[0].reelSpeed++;expect((await grappleIdentity(m,changed,GRAPPLE_DEFAULTS)).cacheKey).not.toBe(id.cacheKey);
 const requests:GrappleRequest[]=[],session=new GrappleSession(r=>requests.push(r));await session.solve(m,p,c.query,7);const r=requests.at(-1)!;const proof=await solve(c);expect(session.accept({kind:'proof',job:r.job,proof})).toBe(false);expect(session.accept({kind:'proof',job:r.job,proof:{...proof,revision:7,querySha256:'wrong'}})).toBe(false);session.invalidate();expect(session.accept({kind:'proof',job:r.job,proof:{...proof,revision:7}})).toBe(false);session.dispose();
 const replies:GrappleReply[]=[],endpoint=createGrappleEndpoint(r=>replies.push(r));const pending=endpoint({...r,job:99});await endpoint({kind:'cancel',job:99});await pending;expect(replies).toEqual([]);
});
test('work, sample, expansion, duration and cancellation bounds publish no partial proof',async()=>{
 const c=cases[1],m=read(c.map),p=read(c.profile);
 for(const limits of [{maxReplayTicks:1},{maxSamples:1},{maxExpanded:1}]){const proof=await planGrapple(m,p,{...c.query,goal:{...c.query.goal,x:2000,y:3000}},0,{...GRAPPLE_DEFAULTS,...limits},()=>false,sync);expect(proof.status).toBe('budget');expect(proof.frames).toEqual([]);}
 const horizon=await planGrapple(m,p,{...c.query,goal:{...c.query.goal,y:c.query.goal.y-64}},0,{...GRAPPLE_DEFAULTS,maxRouteTicks:1},()=>false,sync);expect(horizon.status).not.toBe('verified reachable with replay witness');expect(horizon.frames).toEqual([]);
 const cancelled=await planGrapple(m,p,c.query,0,GRAPPLE_DEFAULTS,()=>true,sync);expect(cancelled.status).toBe('cancelled');expect(cancelled.frames).toEqual([]);await expect(planGrapple(m,p,c.query,0,{...GRAPPLE_DEFAULTS,maxReplayTicks:Infinity})).rejects.toThrow('settings');
});
test('independent final-byte consumer rejects forged traces, controls, rope lengths and rehashed profiles',async()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'maplab-grapple-consumer-')));try{
  const library=join(dir,'library');cpSync('placeholder-library',library,{recursive:true});const index=JSON.parse(readFileSync(join(library,'maplab.project.json'),'utf8'));index.documents=[];index.defaults.movementId='movement.grapple';
  for(const name of readdirSync(root).filter(f=>f.endsWith('.map.json')||f.endsWith('.movement.json'))){const doc=read(name),kind=name.endsWith('.map.json')?'map':'movement',path=(kind==='map'?'maps/':'movement/')+name,bytes=JSON.stringify(doc);mkdirSync(dirname(join(library,path)),{recursive:true});writeFileSync(join(library,path),bytes);index.documents.push({id:doc.id,kind,path,sha256:sha(bytes)});}writeFileSync(join(library,'maplab.project.json'),JSON.stringify(index));
  const bundle=await exportLibrary({dir:library,label:'Owned grapple fixtures',placeholder:false},'map.grapple',sha(readFileSync(join(library,'maps/open.map.json'))));for(const [path,bytes] of bundle.files){mkdirSync(dirname(join(dir,'bundle',path)),{recursive:true});writeFileSync(join(dir,'bundle',path),bytes);}
  cpSync(root,join(dir,'fixtures'),{recursive:true});cpSync('schemas',join(dir,'schemas'),{recursive:true});cpSync('tests/consumer/reader',join(dir,'reader'),{recursive:true});cpSync('tests/consumer/grapple.mjs',join(dir,'consumer.mjs'));
  const reports:Record<string,any>={plans:{},traces:{},steps:{}};for(const c of cases)reports.plans[c.id]=await solve(c);for(const c of traces){let s=c.initial;reports.traces[c.id]=c.inputs.map((u:any)=>{const f=new GrappleWorld(read(c.map),read(c.profile)).step(s,u);s=f.state;return f;});}for(const c of steps)reports.steps[c.id]=new GrappleWorld(read(c.map),read(c.profile)).step(c.initial,c.input);
  const path=join(dir,'reports.json'),consume=()=>execFileSync(process.execPath,[join(dir,'consumer.mjs'),join(dir,'fixtures'),path,join(dir,'bundle'),join(dir,'schemas')],{cwd:dir,encoding:'utf8',stdio:'pipe'}),save=(v:unknown)=>writeFileSync(path,JSON.stringify(v));save(reports);expect(JSON.parse(consume())).toMatchObject({verified:true,finalByteImport:true});
  for(const corrupt of [(v:any)=>v.traces.swing[0].state.x++,(v:any)=>v.traces['attach-reel-release'][1].input.reel=0,(v:any)=>v.plans.attach.frames[0].state.attachment.length++,(v:any)=>v.steps['bad-release'].contacts[0].bodyId='wrong.body',(v:any)=>v.steps['pendulum-collision'].contacts[0].axis='y']){const forged=structuredClone(reports);corrupt(forged);save(forged);expect(consume).toThrow();}save(reports);
  const pp=join(dir,'bundle/movement/grapple.movement.json'),profile=JSON.parse(readFileSync(pp,'utf8'));profile.abilities[0].reelSpeed++;const bytes=canonical(profile);writeFileSync(pp,bytes);const mp=join(dir,'bundle/manifest.json'),manifest=JSON.parse(readFileSync(mp,'utf8')),entry=manifest.files.find((f:any)=>f.path==='movement/grapple.movement.json');entry.sha256=sha(bytes);entry.bytes=Buffer.byteLength(bytes);writeFileSync(mp,canonical(manifest));expect(consume).toThrow('exported grapple document binding');
 }finally{rmSync(dir,{recursive:true,force:true});}
},120000);
