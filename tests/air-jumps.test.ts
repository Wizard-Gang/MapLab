import {beforeAll,test,expect} from 'vitest';
import {readFileSync,readdirSync,mkdtempSync,realpathSync,cpSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {step,airJumpCount} from '../src/air-jumps/runtime';import {AIR_JUMP_SHA256,AIR_PRIMITIVE_SHA256} from '../src/air-jumps/identity';
import {createWorld,replayBytes,digest,type ClimbState,type State,type ContactMap,type Step} from '../src/physics-reference';
import {Navigation,replayRouteActions,physicalStateKey,type RouteProof} from '../src/navigation/routes';
import {buildAirborneActions,AIR_DEFAULTS} from '../src/navigation/airborne';import {RoutingSession,type RoutingRequest,type RouteQuery} from '../src/navigation/routing-protocol';
import {TestSession,NEUTRAL} from '../src/test-runtime/session';import {platformStep} from '../src/platforms/runtime';
import {canonical,validateSourceGraph,type MapDocument,type MovementDocument,type JsonValue} from '../src/contracts';import {exportLibrary} from '../src/library/export';
const root='conformance/air-jumps',read=(f:string):any=>JSON.parse(readFileSync(join(root,f),'utf8')),sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const map=(f='chain'):MapDocument&ContactMap=>read(f+'.map.json'),profile=(f='player'):MovementDocument=>read(f+'.movement.json'),cases:string[]=read('cases.json').cases;
const project=(f:Step)=>({status:f.status,state:f.state});
function run(c:any,start:State=c.initial,ticks=c.ticks){const m=read(c.map),p=read(c.profile),w=createWorld(m,p),frames:Step[]=[];let s=start;for(let n=0;n<ticks;n++){const {fromTick:_,...control}=c.input.filter((i:any)=>i.fromTick<=s.tick).at(-1);const f=step(w,s,control);frames.push(f);s=f.state;if(f.status!=='ok')break;}return frames;}
let nav:Navigation,proof:RouteProof,groundProof:RouteProof;
beforeAll(async()=>{nav=await Navigation.build(map(),profile(),1,undefined,undefined,async()=>{});proof=await nav.route(nav.sourceState('start.air-jumps'),read('cases.json').route.goal,'astar',undefined,async()=>{});const ground=await Navigation.build(map(),profile('ground'),1,undefined,undefined,async()=>{});groundProof=await ground.route(ground.sourceState('start.air-jumps'),read('cases.json').route.goal,'astar',undefined,async()=>{});},120000);
test('final-byte CC0 inventory and selected implementation identities are exact',()=>{
 const ix=read('index.json');expect(ix.license).toBe('CC0-1.0');expect(ix.files.map((f:any)=>f.path).sort()).toEqual(readdirSync(root).filter(f=>f!=='index.json').sort());for(const f of ix.files)expect(sha(readFileSync(join(root,f.path))),f.path).toBe(f.sha256);
 expect(sha(readFileSync('src/air-jumps/runtime.ts'))).toBe(AIR_JUMP_SHA256);expect(sha(readFileSync('src/navigation/air-jumps.ts'))).toBe(AIR_PRIMITIVE_SHA256);
 expect(validateSourceGraph([map(),profile(),profile('ground'),profile('two')] as unknown as JsonValue[]).ok).toBe(true);
});
test.each(cases)('exact charge/hold/exhaust/reset/edge-fall trace, repeat and resume: %s',name=>{
 const c=read(name),before=replayBytes(c),frames=run(c);expect(frames.map(project)).toEqual(c.expect);expect(run(c)).toEqual(frames);expect(replayBytes(c)).toBe(before);
 for(let i=1;i<frames.length;i+=7)expect(run(c,frames[i-1]!.state,frames.length-i)).toEqual(frames.slice(i));
 const events:any[]=[];let old=c.initial;for(const f of frames){if(f.state.resources!.airJumps<old.resources.airJumps)events.push({tick:f.state.tick,kind:'airJump',remaining:f.state.resources!.airJumps});if(f.state.mode==='ground'&&old.resources.airJumps<f.state.resources!.airJumps)events.push({tick:f.state.tick,kind:'groundReset',remaining:f.state.resources!.airJumps});old=f.state;}expect(events).toEqual(c.events);
});
test('malformed resources, replaced old fields, overlap and unsupported capability bounds fail atomically',()=>{
 const c=read(cases[1]!),w=createWorld(read(c.map),profile());
 for(const state of [{...c.initial,resources:{...c.initial.resources,airJumps:-1}},{...c.initial,resources:{...c.initial.resources,airJumps:2}},{...c.initial,resources:{...c.initial.resources,airJumps:.5}},{...c.initial,ticksSinceJump:-1},{...c.initial,jumpReleased:'bad'}]){const f=step(w,state, {...NEUTRAL,jump:true});expect(f.status).toBe('invalidState');expect(f.state).toBe(state);}
 const unsafe={...c.initial,vy:Number.MAX_SAFE_INTEGER+1};expect(step(w,unsafe,{...NEUTRAL,jump:true})).toMatchObject({status:'unsafeInteger',state:unsafe});
 const p=profile();expect(step(createWorld(read(c.map),{...p,abilities:p.abilities.map(a=>a.kind==='jump'?{...a,airJumps:17}:a)}),c.initial,NEUTRAL).status).toBe('unsupported');
});
test('a requested jump is validated on its selected trajectory, before a forbidden falling landing',()=>{
 const m:any=map('flat');m.materials=[{...m.materials[0]!,tags:['hazard']}];const c=read(cases[1]!),s={...c.initial,y:47*256,vy:512};
 const f=step(createWorld(m,profile()),s,{...NEUTRAL,jump:true});expect(f.status).toBe('ok');expect(f.state).toMatchObject({y:45*256,mode:'air',resources:{airJumps:0}});
});
test('RC4 climb attach and jump-off take priority without spending an airborne charge',()=>{
 const m:any=map('flat'),p=profile(),c=read(cases[1]!);m.traversals=[{id:'traversal.air',kind:'ladder',points:[[6,16],[6,48]],grabRadius:4,direction:'both',requiredAbilities:['climb.ladder'],visualId:null,planeId:null,access:[{id:'access.air',pathU:.5,anchor:{kind:'world',point:[6,32]},entry:'airborne',exit:'none',conditions:[]}]}];
 const climbing={...p,abilityTags:[...p.abilityTags,'climb.ladder'],abilities:[...p.abilities,{kind:'climb' as const,version:1 as const,speed:256,ladder:true,rope:false,jumpOff:[0,-256] as const}]};
 const w=createWorld(m,climbing),f=step(w,c.initial,{...NEUTRAL,moveY:1,jump:true});expect(f.status).toBe('ok');expect(f.state).toMatchObject({mode:'air',y:31*256,vy:-192,climbReady:false,resources:{airJumps:1}});
 expect(step(w,c.initial,{...NEUTRAL,moveY:1}).state).toMatchObject({mode:'climb',resources:{airJumps:1}});
});
test('real Test recording and platform integration retain charges and replay exact states',()=>{
 const c=read(cases[0]!),session=new TestSession(read(c.map),profile(),c.initial),before=replayBytes(session.source);
 for(let n=0;n<c.ticks;n++){const {fromTick:_,...control}=c.input.filter((i:any)=>i.fromTick<=n).at(-1);session.advance(control);}expect(session.getSnapshot().frames.map(project)).toEqual(c.expect);const rec=session.recording();session.reset();session.replay(rec);expect(session.getSnapshot().frames.map(project)).toEqual(c.expect);expect(replayBytes(session.source)).toBe(before);
 const m:any=map('flat'),motion=JSON.parse(readFileSync('conformance/platforms/elevator.map.json','utf8')).bodies[0].motion;m.bodies=[{...m.bodies[0]!,mobility:'kinematic',motion:{...motion,points:[[0,0],[0,-1]],legTicks:[4],departure:'none'}}];
 const a=platformStep(m,profile(),c.initial,{...NEUTRAL,jump:true});expect(a.status).toBe('ok');expect(a.state.resources!.airJumps).toBe(1);const b=platformStep(m,profile(),a.state,NEUTRAL);const d=platformStep(m,profile(),b.state,{...NEUTRAL,jump:true});expect(d.status).toBe('ok');expect(d.state.resources!.airJumps).toBe(0);
});
test('player-only entire-route chains consume and reset at both gaps; no-charge profiles cannot borrow them',async()=>{
 expect(nav.status).toBe('candidate');expect(proof.status).toBe('verified reachable with replay witness');expect(proof.terminal).toMatchObject({supportId:'fh.east',resources:{airJumps:1}});expect(proof.frames.filter((f,i)=>f.state.resources!.airJumps<(i?proof.frames[i-1]!.state.resources!.airJumps:1)).length).toBeGreaterThanOrEqual(2);
 expect(replayRouteActions(createWorld(map(),profile()),proof.initial!,proof.actions)?.frames).toEqual(proof.frames);expect(['budget','no route found within declared search/sampling budget']).toContain(groundProof.status);expect(groundProof).toMatchObject({frames:[],actions:[],canCertify:false});
 const d=await nav.route(nav.sourceState('start.air-jumps'),read('cases.json').route.goal,'dijkstra',undefined,async()=>{});expect(d.status).toBe(proof.status);expect(d.costTicks).toBe(proof.costTicks);
 const forged=structuredClone(proof.actions);(forged[0]!.initial.resources as {airJumps:number}).airJumps=0;expect(replayRouteActions(createWorld(map(),profile()),proof.initial!,forged)).toBeNull();
},120000);
test('airborne continuation and derived cache distinguish actual remaining resources',async()=>{
 const {initial:s,goal}=read('cases.json').continuation as {initial:ClimbState;goal:import('../src/navigation/routes').Goal},yes=await nav.route(s,goal,'astar',undefined,async()=>{}),empty={...s,resources:{...s.resources,airJumps:0}};
 expect(yes.status).toBe('verified reachable with replay witness');expect((await nav.route(empty,goal,'astar',undefined,async()=>{})).status).not.toBe('verified reachable with replay witness');expect(physicalStateKey(s)).not.toBe(physicalStateKey(empty));
 const requests:RoutingRequest[]=[],session=new RoutingSession(r=>requests.push(r));const q:RouteQuery={kind:'route',sourceId:'start.air-jumps',initial:s,goal,algorithm:'astar'};await session.solve(map(),profile(),1,q);const first=requests.at(-1)!;if(first.kind!=='solve')throw Error('missing solve');expect(session.accept({kind:'proof',job:first.job,requestSha256:await digest(q),proof:yes})).toBe(true);
 await session.solve(map(),profile(),1,{...q,initial:empty});expect(requests.at(-1)!.kind).toBe('solve');expect(session.getSnapshot().phase).toBe('building');expect(session.accept({kind:'proof',job:first.job,requestSha256:await digest(q),proof:yes})).toBe(false);session.dispose();
},120000);
test('state/replay/action/clearance budgets and cancellation publish no partial witness',async()=>{
 for(const settings of [{...AIR_DEFAULTS,maxAirStates:1},{...AIR_DEFAULTS,maxReplayTicks:1},{...AIR_DEFAULTS,maxTicks:1},{...AIR_DEFAULTS,maxClearanceSamples:1},{...AIR_DEFAULTS,maxCandidates:1,spacingSu:1}])expect(await buildAirborneActions(map(),profile(),1,settings,undefined,async()=>{})).toMatchObject({status:'budget',edges:[],intervals:[]});
 expect(await buildAirborneActions(map(),profile(),1,AIR_DEFAULTS,()=>true)).toMatchObject({status:'cancelled',edges:[]});await expect(buildAirborneActions(map(),profile(),1,{...AIR_DEFAULTS,airStepTicks:1})).rejects.toThrow('primitive settings');
 const noAir=await buildAirborneActions(map(),profile(),1,{...AIR_DEFAULTS,maxAirActions:0},undefined,async()=>{});expect(noAir.edges.every(e=>e.frames.every(f=>f.state.resources!.airJumps===1))).toBe(true);
});
test('drop and fall families survive selecting extra jumps and respect authored family forbids',async()=>{
 const m=map('drop'),p=profile(),g=await buildAirborneActions(m,p,1,undefined,undefined,async()=>{});expect(g.status).toBe('candidate');expect(g.edges.some(e=>e.kind==='drop'&&e.terminal.supportId==='fh.lower'&&e.input.some(c=>c.drop))).toBe(true);
 const blocked={...m,regions:[{id:'region.forbid',name:'Forbid',role:'trigger' as const,shape:{kind:'rect' as const,rect:m.bounds}}],navigation:{...m.navigation,overrides:[{id:'nav.forbid',regionId:'region.forbid',profileIds:[p.id],actions:['drop','fall','jump'],policy:'forbid' as const,penaltyTicks:0}]}};
 expect(await buildAirborneActions(blocked,p,1,undefined,undefined,async()=>{})).toMatchObject({status:'no route found within declared search/sampling budget',edges:[]});
 const jumpOnly={...blocked,navigation:{...blocked.navigation,overrides:blocked.navigation.overrides.map(o=>({...o,actions:['jump']}))}};
 const legal=await buildAirborneActions(jumpOnly,p,1,undefined,undefined,async()=>{});expect(legal.status).toBe('candidate');expect(legal.edges.some(e=>e.kind==='drop')).toBe(true);expect(legal.edges.every(e=>e.frames.every(f=>f.state.resources!.airJumps===1))).toBe(true);
},120000);
test('a fall-family replay keeps jump restrictions after the airborne input pulse has ended',()=>{
 const c=read('fall-consume.fixture.json'),m=map('flat'),p=profile(),initial=c.initial as ClimbState;
 const input=[{...c.input[0],jump:true},{...c.input[0],fromTick:1,jump:false}],frames=run({...c,input});
 const action={key:'owned-fall-jump',kind:'fall',initial,terminal:frames.at(-1)!.state as ClimbState,input,frames,durationTicks:frames.length,penaltyTicks:0,refinedFrom:null};
 expect(replayRouteActions(createWorld(m,p),initial,[action])?.frames).toEqual(frames);
 const restricted={...m,regions:[{id:'region.later',name:'Later jump forbid',role:'trigger' as const,shape:{kind:'rect' as const,rect:[0,19,12,1] as [number,number,number,number]}}],navigation:{...m.navigation,overrides:[{id:'nav.later',regionId:'region.later',profileIds:[p.id],actions:['jump'],policy:'forbid' as const,penaltyTicks:0}]}};
 // The first pulse stays below this region; only later coast frames enter it.
 expect(frames[0]!.state.y-p.collider.height*256).toBeGreaterThan(20*256);
 expect(replayRouteActions(createWorld(restricted,p),initial,[action])).toBeNull();
});
test('separate final-byte importer and equation oracle reject rehashed semantic corruption',async()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'maplab-air-jump-consumer-')));try{
 const library=join(dir,'library');cpSync('placeholder-library',library,{recursive:true});const ix=JSON.parse(readFileSync(join(library,'maplab.project.json'),'utf8'));ix.documents=[];ix.defaults.movementId=profile().id;
 for(const d of [{doc:map(),kind:'map',path:'maps/chain.map.json'},...['player','ground','two'].map(n=>({doc:profile(n),kind:'movement',path:'movement/'+n+'.movement.json'}))]){const bytes=JSON.stringify(d.doc);writeFileSync(join(library,d.path),bytes);ix.documents.push({id:d.doc.id,kind:d.kind,path:d.path,sha256:sha(bytes)});}writeFileSync(join(library,'maplab.project.json'),JSON.stringify(ix));
 const selected={dir:library,label:'Owned airborne jumps',placeholder:false},expected=sha(readFileSync(join(library,'maps/chain.map.json'))),bundle=await exportLibrary(selected,map().id,expected);expect((await exportLibrary(selected,map().id,expected)).zip).toEqual(bundle.zip);
 for(const [path,bytes] of bundle.files){mkdirSync(dirname(join(dir,'bundle',path)),{recursive:true});writeFileSync(join(dir,'bundle',path),bytes);}cpSync(root,join(dir,'fixtures'),{recursive:true});cpSync('schemas',join(dir,'schemas'),{recursive:true});cpSync('tests/consumer/reader',join(dir,'reader'),{recursive:true});cpSync('tests/consumer/air-jumps.mjs',join(dir,'consumer.mjs'));
 const reports={cases:Object.fromEntries(cases.map(n=>[n,run(read(n)).map(project)])),proof,groundProof};writeFileSync(join(dir,'reports.json'),JSON.stringify(reports));const consume=()=>execFileSync(process.execPath,[join(dir,'consumer.mjs'),join(dir,'fixtures'),join(dir,'reports.json'),join(dir,'bundle'),join(dir,'schemas')],{cwd:dir,encoding:'utf8',stdio:'pipe'});expect(JSON.parse(consume())).toMatchObject({verified:true,cases:cases.length,chainedRoute:true});
 const path=join(dir,'fixtures',cases[0]!),c=read(cases[0]!);c.expect[0].state.resources.airJumps=0;writeFileSync(path,JSON.stringify(c));(reports.cases[cases[0]!]![0]!.state.resources as {airJumps:number}).airJumps=0;writeFileSync(join(dir,'reports.json'),JSON.stringify(reports));const index=read('index.json');index.files.find((f:any)=>f.path===cases[0]!).sha256=sha(readFileSync(path));writeFileSync(join(dir,'fixtures/index.json'),JSON.stringify(index));expect(consume).toThrow('independent airborne equation');
 cpSync(root,join(dir,'fixtures'),{recursive:true});writeFileSync(join(dir,'reports.json'),JSON.stringify({...reports,cases:Object.fromEntries(cases.map(n=>[n,run(read(n)).map(project)]))}));const exported=join(dir,'bundle/movement/player.movement.json'),forged=JSON.parse(readFileSync(exported,'utf8'));forged.abilities[0].airJumps=0;const bytes=canonical(forged);writeFileSync(exported,bytes);const manifestPath=join(dir,'bundle/manifest.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8')),entry=manifest.files.find((f:any)=>f.path==='movement/player.movement.json');entry.sha256=sha(bytes);entry.bytes=Buffer.byteLength(bytes);writeFileSync(manifestPath,canonical(manifest));expect(consume).toThrow('exported profile binding');
 }finally{rmSync(dir,{recursive:true,force:true});}
},120000);
