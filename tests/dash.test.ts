import {beforeAll,test,expect} from 'vitest';
import {readFileSync,readdirSync,mkdtempSync,realpathSync,cpSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {step,initialDash,initialResources,type DashInput,type DashState} from '../src/dash/runtime';
import {DASH_RUNTIME_SHA256,DASH_PRIMITIVE_SHA256} from '../src/dash/identity';
import {createWorld,replayBytes,type ClimbState,type State,type ContactMap,type Step} from '../src/physics-reference';
import {Navigation,replayRouteActions,physicalStateKey,type RouteProof} from '../src/navigation/routes';
import {buildAirborneActions,AIR_DEFAULTS} from '../src/navigation/airborne';
import {buildDashActions} from '../src/navigation/dash';
import {RoutingSession,type RoutingRequest,type RouteQuery} from '../src/navigation/routing-protocol';
import {TestSession,NEUTRAL,parseRecording} from '../src/test-runtime/session';
import {canonical,validateSourceGraph,type MapDocument,type MovementDocument,type JsonValue} from '../src/contracts';import {exportLibrary} from '../src/library/export';
const root='conformance/dash',read=(f:string):any=>JSON.parse(readFileSync(join(root,f),'utf8')),sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const map=(f='chain'):MapDocument&ContactMap=>read(f+'.map.json'),profile=(f='player'):MovementDocument=>read(f+'.movement.json'),cases:string[]=read('cases.json').cases;
const project=(f:Step)=>({status:f.status,state:f.state});
function run(c:any,start:State=c.initial,ticks=c.ticks){const w=createWorld(read(c.map),read(c.profile)),frames:Step[]=[];let s=start;for(let n=0;n<ticks;n++){const {fromTick:_,...control}=c.input.filter((i:any)=>i.fromTick<=s.tick).at(-1);const f=step(w,s,control);frames.push(f);s=f.state;if(f.status!=='ok')break;}return frames;}
let nav:Navigation,proof:RouteProof,noneProof:RouteProof;
beforeAll(async()=>{nav=await Navigation.build(map(),profile(),1,undefined,undefined,async()=>{});proof=await nav.route(nav.sourceState('start.dash'),read('cases.json').route.goal,'astar',undefined,async()=>{});const none=await Navigation.build(map(),profile('none'),1,undefined,undefined,async()=>{});noneProof=await none.route(none.sourceState('start.dash'),read('cases.json').route.goal,'astar',undefined,async()=>{});},120000);
test('owned final-byte inventory, selected implementation identities and source contracts',()=>{
 const ix=read('index.json');expect(ix.license).toBe('CC0-1.0');expect(ix.files.map((f:any)=>f.path).sort()).toEqual(readdirSync(root).filter(f=>f!=='index.json').sort());for(const f of ix.files)expect(sha(readFileSync(join(root,f.path))),f.path).toBe(f.sha256);
 expect(sha(readFileSync('src/dash/runtime.ts'))).toBe(DASH_RUNTIME_SHA256);expect(sha(readFileSync('src/navigation/dash.ts'))).toBe(DASH_PRIMITIVE_SHA256);
 expect(validateSourceGraph([map(),...['player','timer','fast','one','none'].map(profile)] as unknown as JsonValue[])).toMatchObject({ok:true});
});
test.each(cases)('exact dash charge/duration/cooldown/reset trace, repeat and resume: %s',name=>{
 const c=read(name),before=replayBytes(c),frames=run(c);expect(frames.map(project)).toEqual(c.expect);expect(run(c)).toEqual(frames);expect(replayBytes(c)).toBe(before);
 for(let i=1;i<frames.length;i+=3)expect(run(c,frames[i-1]!.state,frames.length-i)).toEqual(frames.slice(i));
});
test('thin wall is swept to first finite-body contact, with no tunneling',()=>{
 const c=read('thin-wall.fixture.json'),frames=run(c);expect(frames[0]!.state.x).toBe(19*256);expect(frames[0]!.contacts.some(c=>c.kind==='blocking'&&c.bodyId==='body.wall')).toBe(true);expect((frames[0]!.state as DashState).dash!.active).toBeNull();expect(frames.every(f=>f.state.x<=19*256)).toBe(true);
});
test('malformed active controls/resources and stale durations reject atomically',()=>{
 const c=read(cases[0]!),w=createWorld(read(c.map),profile()),active=run(c)[0]!.state as DashState;
 for(const input of [{...NEUTRAL,dash:'bad'},{...NEUTRAL,moveX:2},{...NEUTRAL,moveY:2},{...NEUTRAL,jump:'bad'},{...NEUTRAL,drop:1},{...NEUTRAL,run:1}]){const f=step(w,active,input as DashInput);expect(f.status).toBe('invalidState');expect(f.state).toBe(active);}
 for(const s of [{...active,resources:{...active.resources!,dashCharges:99}},{...active,dash:{...active.dash!,remaining:{ground:-1,air:1}}},{...active,dash:{...active.dash!,active:{mode:'ground',direction:1,ticksLeft:100}}},{...active,resources:{...active.resources!,cooldowns:{'dash.air':-1,'dash.ground':0}}}]){const f=step(w,s as State,NEUTRAL);expect(f.status).toBe('invalidState');expect(f.state).toBe(s);}
 const unsafe={...active,vx:Number.MAX_SAFE_INTEGER+1};expect(step(w,unsafe,NEUTRAL)).toMatchObject({status:'unsafeInteger',state:unsafe});
});
test('real Test controls, recording parser, reset and replay preserve exact dash state',()=>{
 const c=read(cases[0]!),session=new TestSession(read(c.map),profile(),c.initial),before=replayBytes(session.source);
 for(let n=0;n<c.ticks;n++){const {fromTick:_,...control}=c.input.filter((i:any)=>i.fromTick<=n).at(-1);session.advance(control);}expect(session.getSnapshot().frames.map(project)).toEqual(c.expect);const rec=parseRecording(session.recording());session.reset();session.replay(rec);expect(session.getSnapshot().frames.map(project)).toEqual(c.expect);expect(replayBytes(session.source)).toBe(before);
 expect(()=>parseRecording({...rec,input:rec.input.map((c,i)=>i?c:{...c,dash:1})})).toThrow('Invalid input schedule');
});
test('whole chained route retains resources and uses admissible zero heuristic',async()=>{
 expect(nav.status).toBe('candidate');expect(proof.status).toBe('verified reachable with replay witness');expect(proof.heuristic).toBe('zero');expect(proof.canCertify).toBe(false);expect(proof.actions.some(a=>a.kind==='dash')).toBe(true);
 expect(replayRouteActions(createWorld(map(),profile()),proof.initial!,proof.actions)?.frames).toEqual(proof.frames);
 const dijkstra=await nav.route(nav.sourceState('start.dash'),read('cases.json').route.goal,'dijkstra',undefined,async()=>{});expect(dijkstra.status).toBe(proof.status);expect(dijkstra.costTicks).toBe(proof.costTicks);
 const forged=structuredClone(proof.actions);(forged[0]!.initial as any).resources.dashCharges=0;expect(replayRouteActions(createWorld(map(),profile()),proof.initial!,forged)).toBeNull();
 expect(['budget','no route found within declared search/sampling budget']).toContain(noneProof.status);expect(noneProof.frames).toEqual([]);
},120000);
test('one-tick ground reset still publishes dash witnesses; schedules retain neutral and run-up samples',async()=>{
 const result=await buildAirborneActions(map('flat'),profile('one'),1,{...AIR_DEFAULTS,maxTicks:24},undefined,async()=>{});expect(result.status).toBe('candidate');expect(result.edges.some(e=>e.kind==='dash'&&e.frames.length===1)).toBe(true);expect(result.edges.some(e=>e.initial.vx!==0)).toBe(true);
});
test('budget and cancellation discard partial edges, including tiny lattice spacing',async()=>{
 for(const limits of [{maxCandidates:1},{maxReplayTicks:1},{maxAirStates:1}]){const result=await buildAirborneActions(map(),profile(),1,{...AIR_DEFAULTS,...limits},undefined,async()=>{});expect(result.status).toBe('budget');expect(result.edges).toEqual([]);}
 const bounded=await buildAirborneActions(map('flat'),profile(),1,{...AIR_DEFAULTS,spacingSu:1,maxCandidates:1},undefined,async()=>{});expect(bounded.status).toBe('budget');
 const cancelled=await buildAirborneActions(map(),profile(),1,AIR_DEFAULTS,()=>true,async()=>{});expect(cancelled.status).toBe('cancelled');expect(cancelled.edges).toEqual([]);
 const limit=await nav.withSearchLimits({maxReplayTicks:1});expect((await limit.route(nav.sourceState('start.dash'),read('cases.json').route.goal,'astar',undefined,async()=>{})).status).toBe('budget');
});
test('cache query and state keys preserve spent charges, cooldown, active duration and input edge',async()=>{
 const s=nav.sourceState('start.dash'),sent:RoutingRequest[]=[],session=new RoutingSession(r=>sent.push(r)),query:RouteQuery={kind:'route',sourceId:'start.dash',initial:s,goal:read('cases.json').route.goal,algorithm:'astar'};
 const changed={...s,...initialDash(profile()),resources:initialResources(profile())} as ClimbState&{dash:any};changed.dash={...changed.dash,held:true};expect(physicalStateKey(changed)).not.toBe(physicalStateKey(s));
 await session.solve(map(),profile(),1,query);const first=sent.at(-1)!;await session.solve(map(),profile(),1,{...query,initial:changed});expect(sent.at(-1)).not.toEqual(first);
});
test('dash forbid applies to every frame of a route action',()=>{
 const c=read(cases[0]!),frames=run({...c,ticks:3}),initial=c.initial as ClimbState,action={key:'owned-dash',kind:'dash',initial,terminal:frames.at(-1)!.state as ClimbState,input:c.input.filter((i:any)=>i.fromTick<3),frames,durationTicks:3,penaltyTicks:0,refinedFrom:null};
 expect(replayRouteActions(createWorld(read(c.map),profile()),initial,[action])).not.toBeNull();
 const m:any=read(c.map);m.regions=[{id:'region.dash',name:'Dash forbid',role:'trigger',shape:{kind:'rect',rect:[25,40,1,8]}}];m.navigation.overrides=[{id:'nav.dash',regionId:'region.dash',profileIds:[profile().id],actions:['dash'],policy:'forbid',penaltyTicks:0}];expect(replayRouteActions(createWorld(m,profile()),initial,[action])).toBeNull();
});
test('last-tick active dash continuations cannot bypass a forbidden swept region',async()=>{
 const m:any=map('flat'),p=profile(),c=read('air-exhaust-landing-reset.fixture.json');
 const s:ClimbState&{dash:any}={...c.initial,x:20*256,y:48*256,resources:{airJumps:0,dashCharges:1,cooldowns:{'dash.ground':0,'dash.air':4}},dash:{held:false,remaining:{ground:1,air:0},active:{mode:'air',direction:1,ticksLeft:1}}};
 const f=step(createWorld(m,p),s,NEUTRAL),a={key:'active-last-tick',kind:'land',initial:s,terminal:f.state as ClimbState,input:[{...NEUTRAL,fromTick:s.tick}],frames:[f],durationTicks:1,penaltyTicks:0,refinedFrom:null};expect(f.status).toBe('ok');expect(replayRouteActions(createWorld(m,p),s,[a])).not.toBeNull();
 m.regions=[{id:'region.active',name:'Active dash forbid',role:'trigger',shape:{kind:'rect',rect:[25,40,1,8]}}];m.navigation.overrides=[{id:'nav.active',regionId:'region.active',profileIds:[p.id],actions:['dash'],policy:'forbid',penaltyTicks:0}];expect(replayRouteActions(createWorld(m,p),s,[a])).toBeNull();
 const generated=await buildDashActions(m,p,createWorld(m,p),1,{...AIR_DEFAULTS,maxTicks:24},nav.identity,[{key:'owned-flat',supportId:'fh.west',materialId:'material.ground',direction:'both',minX:256,maxX:159*256}],()=>false,async()=>{},undefined,s);expect(generated.edges).toEqual([]);
});
test('additional airborne jump and dash pools coexist without replenishing each other',()=>{
 const p=profile(),combined={...p,abilities:p.abilities.map(a=>a.kind==='jump'?{...a,airJumps:2,holdTicks:4}:a)},c=read('air-exhaust-landing-reset.fixture.json'),w=createWorld(read(c.map),combined);
 let s:State={...c.initial,resources:initialResources(combined),...initialDash(combined)};
 const start=step(w,s,{...NEUTRAL,dash:true,jump:true});expect(start.status).toBe('ok');expect(start.state.resources!.airJumps).toBe(2);expect(start.state.resources!.dashCharges).toBe(1);s=start.state;
 for(let n=0;n<2;n++){const f=step(w,s,NEUTRAL);expect(f.status).toBe('ok');s=f.state;}
 const before=s as DashState,next=step(w,s,{...NEUTRAL,jump:true});expect(next.status).toBe('ok');expect(next.state.resources!.airJumps).toBe(1);expect((next.state as DashState).dash!.remaining).toEqual(before.dash!.remaining);expect(next.state.resources!.dashCharges).toBe(before.resources!.dashCharges);expect(next.state.resources!.cooldowns['dash.air']).toBe(before.resources!.cooldowns['dash.air']!-1);
});
test('separate final-byte consumer verifies equations and rejects rehashed corruption',async()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'maplab-dash-consumer-')));try{
 const library=join(dir,'library');cpSync('placeholder-library',library,{recursive:true});const ix=JSON.parse(readFileSync(join(library,'maplab.project.json'),'utf8'));ix.documents=[];ix.defaults.movementId=profile().id;
 for(const d of [{doc:map(),kind:'map',path:'maps/chain.map.json'},...['player','timer','fast','one','none'].map(n=>({doc:profile(n),kind:'movement',path:'movement/'+n+'.movement.json'}))]){const bytes=JSON.stringify(d.doc);writeFileSync(join(library,d.path),bytes);ix.documents.push({id:d.doc.id,kind:d.kind,path:d.path,sha256:sha(bytes)});}writeFileSync(join(library,'maplab.project.json'),JSON.stringify(ix));
 const selected={dir:library,label:'Owned dash',placeholder:false},expected=sha(readFileSync(join(library,'maps/chain.map.json'))),bundle=await exportLibrary(selected,map().id,expected);expect((await exportLibrary(selected,map().id,expected)).zip).toEqual(bundle.zip);
 for(const [path,bytes] of bundle.files){mkdirSync(dirname(join(dir,'bundle',path)),{recursive:true});writeFileSync(join(dir,'bundle',path),bytes);}cpSync(root,join(dir,'fixtures'),{recursive:true});cpSync('schemas',join(dir,'schemas'),{recursive:true});cpSync('tests/consumer/reader',join(dir,'reader'),{recursive:true});cpSync('tests/consumer/dash.mjs',join(dir,'consumer.mjs'));cpSync('tests/consumer/dash-equations.mjs',join(dir,'dash-equations.mjs'));
 const reports={cases:Object.fromEntries(cases.map(n=>[n,run(read(n)).map(project)])),proof,noneProof};writeFileSync(join(dir,'reports.json'),JSON.stringify(reports));const consume=()=>execFileSync(process.execPath,[join(dir,'consumer.mjs'),join(dir,'fixtures'),join(dir,'reports.json'),join(dir,'bundle'),join(dir,'schemas')],{cwd:dir,encoding:'utf8',stdio:'pipe'});expect(JSON.parse(consume())).toMatchObject({verified:true,chainedRoute:true,finalByteImport:true});
 const path=join(dir,'fixtures',cases[0]!),c=read(cases[0]!);c.expect[0].state.resources.dashCharges=0;writeFileSync(path,JSON.stringify(c));(reports.cases[cases[0]!]![0]!.state.resources as any).dashCharges=0;writeFileSync(join(dir,'reports.json'),JSON.stringify(reports));const index=read('index.json');index.files.find((f:any)=>f.path===cases[0]!).sha256=sha(readFileSync(path));writeFileSync(join(dir,'fixtures/index.json'),JSON.stringify(index));expect(consume).toThrow('independent dash equation');
 cpSync(root,join(dir,'fixtures'),{recursive:true});writeFileSync(join(dir,'reports.json'),JSON.stringify({...reports,cases:Object.fromEntries(cases.map(n=>[n,run(read(n)).map(project)]))}));const exported=join(dir,'bundle/movement/player.movement.json'),forged=JSON.parse(readFileSync(exported,'utf8'));forged.abilities.find((a:any)=>a.kind==='dash').speed=256;const bytes=canonical(forged);writeFileSync(exported,bytes);const manifestPath=join(dir,'bundle/manifest.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8')),entry=manifest.files.find((f:any)=>f.path==='movement/player.movement.json');entry.sha256=sha(bytes);entry.bytes=Buffer.byteLength(bytes);writeFileSync(manifestPath,canonical(manifest));expect(consume).toThrow('exported profile binding');
 }finally{rmSync(dir,{recursive:true,force:true});}
},120000);
