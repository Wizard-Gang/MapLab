import {beforeAll,test,expect} from 'vitest';
import {readFileSync,readdirSync,mkdtempSync,realpathSync,cpSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {step,wallContact,initialWall,initialResources,initialDash,type WallState} from '../src/wall/runtime';
import {WALL_RUNTIME_SHA256,WALL_PRIMITIVE_SHA256,WALL_INTENT_SHA256} from '../src/wall/identity';
import {createWorld,replayBytes,type State,type ClimbState,type ContactMap,type Step} from '../src/physics-reference';
import {Navigation,ROUTE_DEFAULTS,replayRouteActions,physicalStateKey,type RouteProof} from '../src/navigation/routes';
import {buildWallActions} from '../src/navigation/wall';import {buildSurfaceGraph,identity} from '../src/navigation/surface';import {AIR_DEFAULTS} from '../src/navigation/airborne';
import {TestSession,NEUTRAL} from '../src/test-runtime/session';import {validateSourceGraph,canonical,type MapDocument,type MovementDocument,type JsonValue} from '../src/contracts';import {exportLibrary} from '../src/library/export';
const root='conformance/wall',read=(f:string):any=>JSON.parse(readFileSync(join(root,f),'utf8')),sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const map=(name='corridor'):MapDocument&ContactMap=>read(name+'.map.json'),profile=(name='player'):MovementDocument=>read(name+'.movement.json'),cases:string[]=read('cases.json').cases;
export const wallSettings={...ROUTE_DEFAULTS,maxReplayTicks:2_000_000,maxActionTicks:64,maxRouteTicks:256,air:{...AIR_DEFAULTS,maxTicks:24,maxCandidates:100_000,maxAirStates:100_000,maxReplayTicks:1_500_000,maxAirActions:0,airStepTicks:2}};
const project=(f:Step)=>({status:f.status,state:f.state});
function run(c:any,start:State=c.initial,ticks=c.ticks){const world=createWorld(read(c.map),read(c.profile)),frames:Step[]=[];let s=start;for(let n=0;n<ticks;n++){const {fromTick:_,...input}=c.input.filter((v:any)=>v.fromTick<=s.tick).at(-1),f=step(world,s,input);frames.push(f);s=f.state;if(f.status!=='ok')break;}return frames;}
let nav:Navigation,proof:RouteProof,noneProof:RouteProof;
// Two builds and two bounded queries share this setup; allow CI contention without changing search limits.
beforeAll(async()=>{const c=read('cases.json').route;nav=await Navigation.build(map(),profile(),1,wallSettings,undefined,async()=>{});proof=await nav.route(c.initial,c.goal,'astar',undefined,async()=>{});const n=await Navigation.build(map(),profile('none'),1,wallSettings,undefined,async()=>{}),{wall:_,...plain}=c.initial;noneProof=await n.route(plain,c.goal,'astar',undefined,async()=>{});},360000);
test('owned final-byte inventory, runtime/primitive/intent identities and schema closure',()=>{
 const ix=read('index.json');expect(ix.license).toBe('CC0-1.0');expect(ix.files.map((f:any)=>f.path).sort()).toEqual(readdirSync(root).filter(f=>f!=='index.json').sort());for(const f of ix.files)expect(sha(readFileSync(join(root,f.path))),f.path).toBe(f.sha256);
 for(const [file,value] of [['src/wall/runtime.ts',WALL_RUNTIME_SHA256],['src/navigation/wall.ts',WALL_PRIMITIVE_SHA256],['src/wall/intent.ts',WALL_INTENT_SHA256]])expect(sha(readFileSync(file!))).toBe(value);
 expect(validateSourceGraph([map(),...['player','short','slide','none'].map(profile)] as unknown as JsonValue[])).toMatchObject({ok:true});
});
test.each(cases)('exact contact, launch, stamina and roof trace repeats and resumes: %s',name=>{
 const c=read(name),before=replayBytes(c),frames=run(c);expect(frames.map(project)).toEqual(c.expect);expect(run(c)).toEqual(frames);expect(replayBytes(c)).toBe(before);for(let i=1;i<frames.length;i++)expect(run(c,frames[i-1]!.state,frames.length-i)).toEqual(frames.slice(i));
 if(c.blockingBody)expect(frames[0]!.contacts.some(v=>v.bodyId===c.blockingBody&&v.axis==='y')).toBe(true);
});
test('contact comes from enabled collision geometry, masks and material permission',()=>{
 const c=read('right-slide.fixture.json'),p=profile(),w=createWorld(map(),p);expect(wallContact(w,c.initial)).toMatchObject({side:1,bodyId:'body.right',edgeIndex:3});
 const m=map();for(const b of m.bodies)if(b.id==='body.right')(b as any).enabled=false;expect(wallContact(createWorld(m,p),c.initial)).toBeNull();
 expect(wallContact(createWorld(map(),{...p,mask:[]}),c.initial)).toBeNull();
 const forbidden=map();(forbidden.materials[0] as any).tags=['hazard'];expect(wallContact(createWorld(forbidden,p),c.initial)).toBeNull();expect(wallContact(w,{...c.initial,x:c.initial.x-1})).toBeNull();
});
test('permission and exhaustion do not fabricate wall actions or replenish on release',()=>{
 const c=read('right-jump.fixture.json'),p=profile('slide'),f=step(createWorld(map(),p),c.initial,{...NEUTRAL,jump:true});expect((f.state as WallState).wall!.action).toBeNull();expect(f.state.y).toBe(c.initial.y);
 const s=run(read('stamina-exhaustion.fixture.json'))[1]!.state,fresh=step(createWorld(map(),profile('short')),s,NEUTRAL);expect((fresh.state as WallState).wall!.staminaTicks).toBe(0);
});
test('invalid original resources, side and controls reject atomically',()=>{
 const c=read('right-jump.fixture.json'),w=createWorld(map(),profile());
 for(const bad of [{...c.initial,wall:{...c.initial.wall,staminaTicks:-1}},{...c.initial,wall:{...c.initial.wall,contact:{bodyId:'body.left',shapeId:'shape.left',edgeIndex:1,side:-1}}},{...c.initial,wall:{...c.initial.wall,launched:'bad'}}]){const f=step(w,bad,{...NEUTRAL,jump:true});expect(f.status).toBe('invalidState');expect(f.state).toBe(bad);}
 for(const bad of [{...NEUTRAL,jump:true,moveX:2},{...NEUTRAL,jump:true,moveY:3},{...NEUTRAL,jump:'bad'},{...NEUTRAL,jump:true,drop:1}]){const f=step(w,c.initial,bad as any);expect(f.status).toBe('invalidState');expect(f.state).toBe(c.initial);}
 const bad={...c.initial,vy:Number.MAX_SAFE_INTEGER+1};expect(step(w,bad,{...NEUTRAL,jump:true})).toMatchObject({status:'unsafeInteger',state:bad});
});
test('safe wall launch and slide do not depend on the discarded forbidden-floor fall',()=>{
 const m=map();(m.materials as any).push({...m.materials[0],id:'material.hazard',tags:['hazard']});(m.bodies.find(b=>b.id==='body.floor') as any).materialId='material.hazard';(m.footholds.find(f=>f.id==='fh.floor') as any).materialId='material.hazard';
 const c=read('right-jump.fixture.json'),s={...c.initial,y:47*256,vy:1024},w=createWorld(m,profile());const jump=step(w,s,{...NEUTRAL,jump:true}),slide=step(w,s,{...NEUTRAL,moveX:1});expect(jump.status).toBe('ok');expect((jump.state as WallState).wall!.action).toBe('wallJump');expect(jump.state.y).toBe(45*256);expect(slide.status).toBe('ok');expect(slide.state.y).toBe(47*256+128);
});
test('dash takes priority and wall launch preserves additional jump pools',()=>{
 const p=profile(),dash=JSON.parse(readFileSync('conformance/dash/player.movement.json','utf8')).abilities.filter((a:any)=>a.kind==='dash'),combined={...p,abilities:[...p.abilities.map(a=>a.kind==='jump'?{...a,airJumps:2}:a),...dash]},c=read('right-jump.fixture.json'),s={...c.initial,resources:initialResources(combined),...initialDash(combined)};
 const d=step(createWorld(map(),combined),s,{...NEUTRAL,moveX:-1,dash:true,jump:true});expect(d.status).toBe('ok');expect((d.state as WallState).wall!.action).toBeNull();expect(d.state.resources!.airJumps).toBe(2);
 const j=step(createWorld(map(),combined),s,{...NEUTRAL,jump:true});expect(j.status).toBe('ok');expect(j.state.resources!.airJumps).toBe(2);expect(j.state.resources!.dashCharges).toBe(2);
});
test('ladder priority retains dash and air-jump adapter bookkeeping',()=>{
 const p=profile(),dash=JSON.parse(readFileSync('conformance/dash/player.movement.json','utf8')).abilities.filter((a:any)=>a.kind==='dash'),combined:MovementDocument={...p,abilities:[...p.abilities.map(a=>a.kind==='jump'?{...a,airJumps:2}:a),...dash,{kind:'climb',version:1,speed:256,ladder:true,rope:true,jumpOff:[256,-512]}]},m=map();
 (m.traversals as any).push({id:'traversal.wall-ladder',kind:'ladder',points:[[23,20],[23,40]],grabRadius:1,direction:'both',access:[{id:'access.wall',pathU:.5,anchor:{kind:'world',point:[23,30]},entry:'airborne',exit:'airborne',conditions:[]}],requiredAbilities:[],visualId:null,planeId:null});
 const c=read('climb.fixture.json'),initial={...c.initial,resources:{...initialResources(combined),cooldowns:{'dash.ground':0,'dash.air':5}},...initialDash(combined)};initial.dash={...initial.dash!,held:true};
 const f=step(createWorld(m,combined),initial,{...NEUTRAL,moveX:1,moveY:-1,dash:false});expect(f.status).toBe('ok');expect(f.state.mode).toBe('climb');expect(f.state.resources!.cooldowns['dash.air']).toBe(4);expect((f.state as any).dash.held).toBe(false);expect(f.state.resources!.airJumps).toBe(2);expect((f.state as WallState).wall!.staminaTicks).toBe(24);
});
test('whole route needs wall permission, preserves exact state and uses zero heuristic',async()=>{
 expect(nav.status).toBe('candidate');expect(proof.status).toBe('verified reachable with replay witness');expect(proof.heuristic).toBe('zero');expect(proof.frames.some(f=>(f.state as WallState).wall?.action==='wallClimb')).toBe(true);expect(replayRouteActions(createWorld(map(),profile()),proof.initial!,proof.actions)?.frames).toEqual(proof.frames);
 const d=await nav.route(read('cases.json').route.initial,read('cases.json').route.goal,'dijkstra',undefined,async()=>{});expect(d.costTicks).toBe(proof.costTicks);expect(d.status).toBe(proof.status);expect(['budget','no route found within declared search/sampling budget']).toContain(noneProof.status);expect(noneProof.frames).toEqual([]);
 const forged=structuredClone(proof.actions);(forged[0]!.initial as any).wall.staminaTicks=0;expect(replayRouteActions(createWorld(map(),profile()),proof.initial!,forged)).toBeNull();
},120000);
test('bounded wall jump sequence launches from the correct side and lands on the opposite wall',async()=>{
 const base=profile(),p:MovementDocument={...base,abilities:base.abilities.map(a=>a.kind==='wall'?{...a,permissions:['jump']}:a)},settings={...wallSettings,air:{...wallSettings.air,maxAirActions:1}},n=await Navigation.build(map(),p,1,settings,undefined,async()=>{}),c=read('right-jump.fixture.json'),initial={...c.initial,y:20*256};
 const result=await n.route(initial,{supportId:'fh.left',x:7*256,toleranceSu:128,vx:0},'astar',undefined,async()=>{});expect(result.status).toBe('verified reachable with replay witness');expect(result.actions.some(a=>a.kind==='wallJump')).toBe(true);expect(result.frames.some(f=>(f.state as WallState).wall?.action==='wallJump'&&f.state.vx===-512)).toBe(true);expect(replayRouteActions(createWorld(map(),p),result.initial!,result.actions)?.frames).toEqual(result.frames);
},120000);
test('wall restrictions survive forged action splits and query state retains stamina',()=>{
 const c=read('right-jump.fixture.json'),frames=run(c),s=frames[0]!.state as ClimbState;expect(physicalStateKey(s)).not.toBe(physicalStateKey({...s,wall:{...(s as WallState).wall!,staminaTicks:0}} as ClimbState));
 const m=map();(m.regions as any).push({id:'region.wall',name:'Wall jump forbidden',role:'trigger',shape:{kind:'rect',rect:[18,24,4,12]}});(m.navigation.overrides as any).push({id:'nav.wall',regionId:'region.wall',profileIds:[profile().id],actions:['wallJump'],policy:'forbid',penaltyTicks:0});
 const next=step(createWorld(map(),profile()),s,NEUTRAL),action={key:'forged-split',kind:'fall',initial:s,terminal:next.state as ClimbState,input:[{...NEUTRAL,fromTick:s.tick}],frames:[next],durationTicks:1,penaltyTicks:0,refinedFrom:null};expect(replayRouteActions(createWorld(m,profile()),s,[action])).toBeNull();
});
test('budget and cancellation publish no partial wall witnesses',async()=>{
 const p=profile(),m=map(),w=createWorld(m,p),settings={...AIR_DEFAULTS,maxTicks:24},id=await identity(m,p,{maxSamples:2_000_000,maxTicks:3600}),surface=await buildSurfaceGraph(m,p,1,undefined,undefined,async()=>{});
 for(const limits of [{maxCandidates:1},{maxReplayTicks:1},{maxAirStates:1}]){const result=await buildWallActions(m,p,w,1,{...settings,...limits},id,surface.intervals,()=>false,async()=>{},undefined,read('cases.json').route.initial);expect(result.status).toBe('budget');expect(result.edges).toEqual([]);}
 const cancelled=await buildWallActions(m,p,w,1,settings,id,surface.intervals,()=>true,async()=>{});expect(cancelled.status).toBe('cancelled');expect(cancelled.edges).toEqual([]);
});
test('Test replay keeps wall state ephemeral',()=>{
 const c=read('stamina-exhaustion.fixture.json'),session=new TestSession(read(c.map),read(c.profile),c.initial),before=replayBytes(session.source);session.replay({initial:c.initial,input:c.input,ticks:c.ticks});expect(session.getSnapshot().frames.map(project)).toEqual(c.expect);const r=session.recording();session.reset();session.replay(r);expect(session.getSnapshot().frames.map(project)).toEqual(c.expect);expect(replayBytes(session.source)).toBe(before);
});
test('independent exported-bundle consumer rejects semantically corrupt rehashed fixtures and profiles',async()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'maplab-wall-consumer-')));try{
  const library=join(dir,'library');cpSync('placeholder-library',library,{recursive:true});const ix=JSON.parse(readFileSync(join(library,'maplab.project.json'),'utf8'));ix.documents=[];ix.defaults.movementId=profile().id;
  for(const d of [{doc:map(),kind:'map',path:'maps/corridor.map.json'},...['player','short','slide','none'].map(name=>({doc:profile(name),kind:'movement',path:'movement/'+name+'.movement.json'}))]){const bytes=JSON.stringify(d.doc);writeFileSync(join(library,d.path),bytes);ix.documents.push({id:d.doc.id,kind:d.kind,path:d.path,sha256:sha(bytes)});}writeFileSync(join(library,'maplab.project.json'),JSON.stringify(ix));
  const selected={dir:library,label:'Owned wall',placeholder:false},bundle=await exportLibrary(selected,map().id,sha(readFileSync(join(library,'maps/corridor.map.json'))));expect((await exportLibrary(selected,map().id,sha(readFileSync(join(library,'maps/corridor.map.json'))))).zip).toEqual(bundle.zip);
  for(const [path,bytes] of bundle.files){mkdirSync(dirname(join(dir,'bundle',path)),{recursive:true});writeFileSync(join(dir,'bundle',path),bytes);}cpSync(root,join(dir,'fixtures'),{recursive:true});cpSync('schemas',join(dir,'schemas'),{recursive:true});cpSync('tests/consumer/reader',join(dir,'reader'),{recursive:true});cpSync('tests/consumer/wall.mjs',join(dir,'consumer.mjs'));cpSync('tests/consumer/wall-equations.mjs',join(dir,'wall-equations.mjs'));
  const reports={cases:Object.fromEntries(cases.map(name=>[name,run(read(name)).map(project)])),proof,noneProof};writeFileSync(join(dir,'reports.json'),JSON.stringify(reports));const consume=()=>execFileSync(process.execPath,[join(dir,'consumer.mjs'),join(dir,'fixtures'),join(dir,'reports.json'),join(dir,'bundle'),join(dir,'schemas')],{cwd:dir,encoding:'utf8',stdio:'pipe'});expect(JSON.parse(consume())).toMatchObject({verified:true,chainedRoute:true,finalByteImport:true});
  const c=read(cases[0]!),path=join(dir,'fixtures',cases[0]!);c.expect[0].state.wall.staminaTicks=0;writeFileSync(path,JSON.stringify(c));(reports.cases[cases[0]!]![0]!.state as any).wall={...((reports.cases[cases[0]!]![0]!.state as WallState).wall!),staminaTicks:0};writeFileSync(join(dir,'reports.json'),JSON.stringify(reports));const index=read('index.json');index.files.find((f:any)=>f.path===cases[0]!).sha256=sha(readFileSync(path));writeFileSync(join(dir,'fixtures/index.json'),JSON.stringify(index));expect(consume).toThrow('independent wall equation');
  cpSync(root,join(dir,'fixtures'),{recursive:true});writeFileSync(join(dir,'reports.json'),JSON.stringify({...reports,cases:Object.fromEntries(cases.map(name=>[name,run(read(name)).map(project)]))}));const exported=join(dir,'bundle/movement/player.movement.json'),forged=JSON.parse(readFileSync(exported,'utf8'));forged.abilities.find((a:any)=>a.kind==='wall').staminaTicks=1;const bytes=canonical(forged);writeFileSync(exported,bytes);const manifestPath=join(dir,'bundle/manifest.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8')),entry=manifest.files.find((f:any)=>f.path==='movement/player.movement.json');entry.sha256=sha(bytes);entry.bytes=Buffer.byteLength(bytes);writeFileSync(manifestPath,canonical(manifest));expect(consume).toThrow('exported wall profile binding');
 }finally{rmSync(dir,{recursive:true,force:true});}
},120000);
