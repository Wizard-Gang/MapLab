import {test,expect} from 'vitest';
import {readFileSync,readdirSync,mkdtempSync,realpathSync,cpSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {ModeWorld,type ModeState} from '../src/modes/controller';import {planModes,modeIdentity,modeStateKey,MODE_DEFAULTS,type ModeQuery,type ModeProof} from '../src/modes/planner';import {ModeTestSession,replayModes} from '../src/modes/replay';import {ModeSession,createModeEndpoint,type ModeRequest,type ModeReply} from '../src/modes/protocol';import {MODE_MOTOR_SHA256,MODE_SOLVER_SHA256} from '../src/modes/identity';
import {validateSourceGraph,canonical,type MapDocument,type MovementDocument,type JsonValue} from '../src/contracts';import {exportLibrary} from '../src/library/export';
const root='conformance/modes',read=(f:string):any=>JSON.parse(readFileSync(join(root,f),'utf8')),sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex'),sync=async()=>{},cases:any[]=read('cases.json');
const solve=(c:any,algorithm:'astar'|'dijkstra'='astar')=>planModes(read(c.map),read(c.profile),{...c.query,algorithm},1,MODE_DEFAULTS,()=>false,sync);
test('owned final-byte inventory and separate motor/solver source identity',()=>{
 const index=read('index.json');expect(index.license).toBe('CC0-1.0');expect(index.files.map((f:any)=>f.path).sort()).toEqual(readdirSync(root).filter(f=>f!=='index.json').sort());for(const f of index.files)expect(sha(readFileSync(join(root,f.path))),f.path).toBe(f.sha256);
 expect(sha(readFileSync('src/modes/controller.ts'))).toBe(MODE_MOTOR_SHA256);expect(sha(readFileSync('src/modes/planner.ts'))).toBe(MODE_SOLVER_SHA256);
 const profiles=readdirSync(root).filter(f=>f.endsWith('.movement.json')).map(read);for(const name of ['water','shore','blocked','corner','transitions'])expect(validateSourceGraph([read(name+'.map.json'),read('modes.catalog.json'),...profiles] as JsonValue[]).diagnostics.filter(d=>d.severity==='error')).toEqual([]);
});
for(const c of cases)test('finite-body mode witness '+c.id,async()=>{
 const m=read(c.map),p=read(c.profile),before=JSON.stringify({m,p,q:c.query}),proof=await solve(c);
 if(c.id==='blocked-exit')expect(['no route found within declared search/sampling budget','budget']).toContain(proof.status);else expect(proof.status,proof.diagnostics.join(';')).toBe(c.status);
 expect(JSON.stringify({m,p,q:c.query})).toBe(before);expect(proof.canCertify).toBe(false);expect(proof.complete).toBe(false);
 if(proof.status==='verified reachable with replay witness'){
  const world=new ModeWorld(m,p);expect(replayModes(world,c.query.initial,proof.frames)).toEqual(proof.frames);expect(proof.terminal).toMatchObject({...c.query.goal,vx:0,vy:0});expect(proof.costTicks).toBe(proof.frames.length);
  for(const f of proof.frames)if(f.action===null)expect(world.valid(f.state)).toBe(true);else expect(world.transitions.some(t=>t.id===f.action)).toBe(true);
  const session=new ModeTestSession(world,c.query.initial);expect(session.replay(proof.frames)).toBe(true);expect(session.state).toEqual(proof.terminal);
  if(c.id.startsWith('shore'))expect(proof.frames.some(f=>f.state.mode==='transition')).toBe(true);
 }else{expect(proof.frames).toEqual([]);expect(proof.terminal).toBeNull();}
},60000);
test('exact turn checkpoints retain momentum and non-neutral swimming applies buoyancy before propulsion',()=>{
 const c=read('turn.fixture.json'),w=new ModeWorld(read('water.map.json'),read('flyer.movement.json'));let state=c.initial;const actual=[];for(const expected of c.expected){state=w.step(state,c.input)!;actual.push(state);expect(state).toEqual(expected);}expect(actual[0].vx).toBe(224);
 const swim=new ModeWorld(read('water.map.json'),read('drift.movement.json')),s={...cases[0].query.initial,x:12*256};expect(swim.step(s,{targetVx:256,targetVy:0})).toMatchObject({vx:113,vy:18,x:s.x+113,y:s.y+18});
});
test('flight turn limits and acceleration change routes; A* cost equals Dijkstra',async()=>{
 const fast=await solve(cases.find(c=>c.id==='flight-acceleration')),slow=await solve(cases.find(c=>c.id==='slow-flight'));expect(fast.costTicks).toBeLessThan(slow.costTicks);expect(fast.identity.cacheKey).not.toBe(slow.identity.cacheKey);
 for(const id of ['swim-seam','shore-entry','flight-acceleration']){const c=cases.find(c=>c.id===id),a=await solve(c),d=await solve(c,'dijkstra');expect(d.status).toBe(a.status);expect(d.costTicks).toBe(a.costTicks);}
 const map=read('corner.map.json'),p=read('flyer.movement.json'),input={targetVx:0,targetVy:-256};let state=read('turn.fixture.json').initial,w=new ModeWorld(map,p);expect(w.step(state,input)).not.toBeNull();state=w.step(state,input)!;state=w.step(state,input)!;expect(w.step(state,input)).toBeNull();
 const turn={...p,abilities:p.abilities.map((a:any)=>({...a,turnAcceleration:256,acceleration:256}))};w=new ModeWorld(map,turn);state=read('turn.fixture.json').initial;for(let i=0;i<4;i++){const next=w.step(state,input);expect(next).not.toBeNull();state=next!;}
},60000);
test('volume edges, seams, missing bindings, wrong modes, malformed inputs and swept gaps fail closed',()=>{
 const map=read('water.map.json'),p=read('swimmer.movement.json'),world=new ModeWorld(map,p),s=cases[0].query.initial;
 expect(world.valid({...s,x:8*256})).toBe(false);expect(world.valid({...s,x:20*256})).toBe(true);expect(world.step({...s,x:11*256,vx:-256},{targetVx:-256,targetVy:0})).not.toBeNull();expect(world.step({...s,x:11*256-1,vx:-256},{targetVx:-256,targetVy:0})).toBeNull();
 const gap=structuredClone(map);gap.regions.find((r:any)=>r.id==='water.b').shape.rect[0]+=1;expect(new ModeWorld(gap,p).valid({...s,x:20*256})).toBe(false);
 expect(()=>new ModeWorld({...map,navigation:{...map.navigation,modeVolumes:[]}},p)).toThrow('matching');expect(world.valid({...s,mode:'fly'})).toBe(false);expect(world.step(s,{targetVx:NaN,targetVy:0})).toBeNull();expect(world.valid({...s,tick:Number.MAX_SAFE_INTEGER})).toBe(false);
});
test('entry/exit cannot be inferred, scripted diagonal links and unsupported swim drift are qualified',async()=>{
 const c=cases.find(c=>c.id==='shore-entry'),map=read('water.map.json'),p=read(c.profile);expect((await planModes(map,p,c.query,0,MODE_DEFAULTS,()=>false,sync)).status).not.toBe('verified reachable with replay witness');
 const bad=read('shore.map.json');bad.navigation.links[0].to.point=[10,19];expect(()=>new ModeWorld(bad,p)).toThrow('cardinal');const scripted=read('shore.map.json');scripted.navigation.links[0].action.key='animation.moves-me';expect(()=>new ModeWorld(scripted,p)).toThrow('Unsupported');
 const drift={...p,abilities:p.abilities.map((a:any)=>({...a,buoyancy:8192}))};expect(()=>new ModeWorld(map,drift)).toThrow('drift');
 const duplicate=read('shore.map.json');duplicate.navigation.links.push({...structuredClone(duplicate.navigation.links[0]),id:'shore:reverse'});expect(()=>new ModeWorld(duplicate,p)).toThrow('Duplicate mode transition');
 const w=new ModeWorld(read('shore.map.json'),p),t=w.transitions.find(t=>t.id==='shore')!;expect(w.transition({...c.query.initial,tick:Number.MAX_SAFE_INTEGER-2},t,128)).toBeNull();expect(w.transition(c.query.initial,t,Infinity)).toBeNull();
 const initial=structuredClone(c.query.initial),session=new ModeTestSession(w,initial);initial.x+=256;expect(session.recording().initial).toEqual(c.query.initial);
},60000);
test('mode/profile/volume/query/velocity identities and old worker replies cannot cross revisions',async()=>{
 const c=cases[0],m=read(c.map),p=read(c.profile),id=await modeIdentity(m,p,MODE_DEFAULTS);expect((await modeIdentity({...m,metadata:{...m.metadata,name:'Art only'}},p,MODE_DEFAULTS)).cacheKey).toBe(id.cacheKey);
 expect((await modeIdentity(m,{...p,abilities:p.abilities.map((a:any)=>({...a,acceleration:a.acceleration+1}))},MODE_DEFAULTS)).cacheKey).not.toBe(id.cacheKey);const changed=structuredClone(m);changed.navigation.modeVolumes[0].profileIds=[];expect((await modeIdentity(changed,p,MODE_DEFAULTS)).cacheKey).not.toBe(id.cacheKey);expect(modeStateKey(c.query.initial)).not.toBe(modeStateKey({...c.query.initial,vx:1}));
 const requests:ModeRequest[]=[],session=new ModeSession(r=>requests.push(r));await session.solve(m,p,c.query,7);const r=requests.at(-1)!;const proof=await solve(c);expect(session.accept({kind:'proof',job:r.job,proof})).toBe(false);expect(session.accept({kind:'proof',job:r.job,proof:{...proof,revision:7,identity:{...proof.identity,cacheKey:'wrong'}}})).toBe(false);session.invalidate();expect(session.accept({kind:'proof',job:r.job,proof:{...proof,revision:7}})).toBe(false);session.dispose();
 const replies:ModeReply[]=[],endpoint=createModeEndpoint(r=>replies.push(r));const pending=endpoint({...r,job:99});await endpoint({kind:'cancel',job:99});await pending;expect(replies).toEqual([]);
});
test('independent exported consumer rejects forged controls, traces and rehashed profile substitutions',async()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'maplab-modes-consumer-')));try{
  const library=join(dir,'library');cpSync('placeholder-library',library,{recursive:true});const index=JSON.parse(readFileSync(join(library,'maplab.project.json'),'utf8'));index.documents=[];index.defaults.movementId='movement.swimmer';
  const files=[{path:'maps/water.map.json',kind:'map',doc:read('water.map.json')},{path:'catalogs/modes.catalog.json',kind:'catalog',doc:read('modes.catalog.json')},...readdirSync(root).filter(f=>f.endsWith('.movement.json')).map(f=>({path:'movement/'+f,kind:'movement',doc:read(f)}))];
  for(const f of files){const bytes=JSON.stringify(f.doc);writeFileSync(join(library,f.path),bytes);index.documents.push({id:f.doc.id,kind:f.kind,path:f.path,sha256:sha(bytes)});}writeFileSync(join(library,'maplab.project.json'),JSON.stringify(index));
  const selected={dir:library,label:'Owned mode fixtures',placeholder:false},bundle=await exportLibrary(selected,'map.modes',sha(readFileSync(join(library,'maps/water.map.json'))));
  for(const [path,bytes] of bundle.files){mkdirSync(dirname(join(dir,'bundle',path)),{recursive:true});writeFileSync(join(dir,'bundle',path),bytes);}cpSync(root,join(dir,'fixtures'),{recursive:true});cpSync('schemas',join(dir,'schemas'),{recursive:true});cpSync('tests/consumer/reader',join(dir,'reader'),{recursive:true});cpSync('tests/consumer/modes.mjs',join(dir,'consumer.mjs'));
  const reports:Record<string,ModeProof>={};for(const c of cases)reports[c.id]=await solve(c);writeFileSync(join(dir,'reports.json'),JSON.stringify(reports));
  const consume=()=>execFileSync(process.execPath,[join(dir,'consumer.mjs'),join(dir,'fixtures'),join(dir,'reports.json'),join(dir,'bundle'),join(dir,'schemas')],{cwd:dir,encoding:'utf8',stdio:'pipe'});expect(JSON.parse(consume())).toMatchObject({verified:true,finalByteImport:true});
  const forged=structuredClone(reports);(forged['swim-seam']!.frames[0]!.state as any).x+=1;writeFileSync(join(dir,'reports.json'),JSON.stringify(forged));expect(consume).toThrow('independent mode equation');
  const controls=structuredClone(reports);(controls['shore-entry']!.frames[0]!.input as any).targetVx=0;writeFileSync(join(dir,'reports.json'),JSON.stringify(controls));expect(consume).toThrow('independent transition controls');writeFileSync(join(dir,'reports.json'),JSON.stringify(reports));
  const path=join(dir,'bundle/movement/swimmer.movement.json'),profile=JSON.parse(readFileSync(path,'utf8'));profile.abilities[0].acceleration+=1;const bytes=canonical(profile);writeFileSync(path,bytes);const mp=join(dir,'bundle/manifest.json'),manifest=JSON.parse(readFileSync(mp,'utf8')),entry=manifest.files.find((f:any)=>f.path==='movement/swimmer.movement.json');entry.sha256=sha(bytes);entry.bytes=Buffer.byteLength(bytes);writeFileSync(mp,canonical(manifest));expect(consume).toThrow('exported mode profile binding');
 }finally{rmSync(dir,{recursive:true,force:true});}
},120000);
test('bounded work, duration and cancellation publish no partial route',async()=>{
 const c=cases[0];for(const o of [{...MODE_DEFAULTS,maxReplayTicks:1},{...MODE_DEFAULTS,maxExpanded:1},{...MODE_DEFAULTS,maxRouteTicks:1}]){const proof=await planModes(read(c.map),read(c.profile),c.query,0,o,()=>false,sync);expect(proof.status).not.toBe('verified reachable with replay witness');expect(proof.frames).toEqual([]);}
 const cancelled=await planModes(read(c.map),read(c.profile),c.query,0,MODE_DEFAULTS,()=>true,sync);expect(cancelled.status).toBe('cancelled');expect(cancelled.frames).toEqual([]);
});
