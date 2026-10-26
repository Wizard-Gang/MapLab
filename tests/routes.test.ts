import {beforeAll,test,expect} from 'vitest';
import {readFileSync,readdirSync,mkdtempSync,cpSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Navigation,ROUTE_DEFAULTS,physicalStateKey,replayRouteActions,routingIdentity,anchorState,regionContains,type RouteProof,type Goal} from '../src/navigation/routes';
import {searchCostGraph,type CostGraph} from '../src/navigation/search';
import {RoutingSession,type RoutingRequest,type RouteQuery} from '../src/navigation/routing-protocol';
import {createWorld,digest,replayBytes,type ContactMap,type ClimbState} from '../src/physics-reference';
import type {MapDocument} from '../src/contracts/document-types';
import type {MovementDocument} from '../src/contracts/movement-types';
import {validateSourceGraph,type JsonValue} from '../src/contracts';
const folder=join(process.cwd(),'conformance/routes'),read=<T>(file:string):T=>JSON.parse(readFileSync(join(folder,file),'utf8'));
const map=read<MapDocument>('forest.map.json'),player=read<MovementDocument>('player.movement.json'),enemy=read<MovementDocument>('enemy.movement.json');
const gap:Goal={supportId:'fh.east',x:660*256,toleranceSu:128,vx:0},walk:Goal={supportId:'fh.west',x:160*256,toleranceSu:128,vx:0};
let p:Navigation,e:Navigation,initial:ClimbState,gapProof:RouteProof;
beforeAll(async()=>{p=await Navigation.build(map,player,1,undefined,undefined,async()=>{});e=await Navigation.build(map,enemy,1,undefined,undefined,async()=>{});initial=p.sourceState('spawn.player');gapProof=await p.route(initial,gap,'astar',undefined,async()=>{});},120000);
test('owned fixture maps/profiles/catalog form a valid source graph',()=>{
 const result=validateSourceGraph([map,player,enemy,read('core.catalog.json')] as unknown as JsonValue[]);
 expect(result.diagnostics.filter(d=>d.severity==='error')).toEqual([]);
});
test('A* equals Dijkstra on weighted directed graphs, including a zero-cost portal shortcut',async()=>{
 for(const c of read<{graph:CostGraph;cost:number;from:string;to:string}[]>('cost-cases.json')){
  const a=await searchCostGraph(c.graph,c.from,c.to,'astar'),d=await searchCostGraph(c.graph,c.from,c.to,'dijkstra');
  expect(a.status).toBe('candidate');expect(a.cost).toBe(c.cost);expect(a.cost).toBe(d.cost);
  expect(await searchCostGraph(c.graph,c.to,c.from,'astar')).toMatchObject({status:'no route',path:[]});
  const corrupt=structuredClone(c.graph);(corrupt.edges[0] as {penalty:number}).penalty=-1;await expect(searchCostGraph(corrupt,c.from,c.to,'astar')).rejects.toThrow();
 }
});
test('player gap refines incompatible launch states and replays the entire actual route',async()=>{
 expect(p.status).toBe('candidate');expect(gapProof.status).toBe('verified reachable with replay witness');expect(gapProof.refinements).toBeGreaterThan(0);
 expect(gapProof.terminal).toMatchObject({supportId:'fh.east',mode:'ground',vx:0,vy:0});expect(gapProof.actions.some(a=>a.kind==='jump')).toBe(true);
 expect(replayRouteActions(createWorld(map as unknown as ContactMap,player),initial,gapProof.actions)).toMatchObject({frames:gapProof.frames,terminal:gapProof.terminal});
 const d=await p.route(initial,gap,'dijkstra',undefined,async()=>{});expect(d.status).toBe(gapProof.status);expect(d.costTicks).toBe(gapProof.costTicks);
 const bad=structuredClone(gapProof.actions);(bad[1]!.initial as {vx:number}).vx=0;
 expect(replayRouteActions(createWorld(map as unknown as ContactMap,player),initial,bad)).toBeNull();
 expect(physicalStateKey({...initial,vx:1024})).not.toBe(physicalStateKey(initial));expect(physicalStateKey({...initial,tick:99})).toBe(physicalStateKey(initial));
 expect(physicalStateKey({...initial,jumpHeldPrev:true})).not.toBe(physicalStateKey(initial));expect(physicalStateKey({...initial,resources:{...initial.resources,airJumps:1}})).not.toBe(physicalStateKey(initial));
},120000);
test('bounded no-route is distinct from a proven missing legal goal stance; no-jump profile cannot borrow player actions',async()=>{
 const failed=await e.route(e.sourceState('spawn.ground'),gap,'astar',undefined,async()=>{});expect(failed).toMatchObject({status:'no route found within declared search/sampling budget',actions:[],frames:[],complete:false});expect(failed.diagnostics).toContain('no jump ability');
 const impossible=await p.route(initial,{...gap,x:0},'astar',undefined,async()=>{});expect(impossible).toMatchObject({status:'proven unreachable',frames:[]});
 expect(await p.route(initial,{...gap,supportId:'fh.fake'})).toMatchObject({status:'unsupported',frames:[]});
 expect(await p.patrol('spawn.ground')).toMatchObject({status:'unsupported',frames:[]});
},120000);
test('an actual airborne source retains its velocity, input flags and absolute tick',async()=>{
 const airborne=gapProof.frames.find(f=>f.state.mode==='air')!.state as ClimbState;
 const result=await p.route(airborne,gap,'astar',undefined,async()=>{});expect(result.status).toBe('verified reachable with replay witness');expect(result.actions.every(a=>a.kind==='wait'?a.durationTicks<=3600:a.durationTicks<=result.settings.maxActionTicks)).toBe(true);expect(result.initial).toEqual(airborne);
 expect(result.input[0]!.fromTick).toBe(airborne.tick);expect(result.terminal!.tick-airborne.tick).toBe(result.durationTicks);
 expect(await p.route({...initial,supportId:'fh.fake'},walk,'astar',undefined,async()=>{})).toMatchObject({status:'unsupported',frames:[]});
},120000);
test('bounded rect/circle/polygon region goals verify the actual terminal foot and never promote sample failure to unreachable',async()=>{
 for(const id of ['region.routes.landing','region.routes.circle','region.routes.triangle']){
  const result=await p.region(initial,id,'astar',undefined,async()=>{});expect(result.status).toBe('verified reachable with replay witness');expect(result.actions.every(a=>a.kind==='wait'?a.durationTicks<=3600:a.durationTicks<=result.settings.maxActionTicks)).toBe(true);expect(result.targetRegionId).toBe(id);
  expect(regionContains(map.regions.find(r=>r.id===id)!.shape,result.terminal!.x,result.terminal!.y)).toBe(true);
 }
 const failed=await e.region(e.sourceState('spawn.ground'),'region.routes.landing','astar',undefined,async()=>{});expect(failed.status).toBe('no route found within declared search/sampling budget');expect(failed.frames).toEqual([]);
 expect(await p.region(initial,'region.fake')).toMatchObject({status:'unsupported',frames:[]});
 expect(regionContains({kind:'circle',center:[0,0],radius:8},8*256,0)).toBe(true);expect(regionContains({kind:'circle',center:[0,0],radius:8},8*256+1,0)).toBe(false);
 expect(regionContains({kind:'polygon',points:[[0,0],[8,0],[0,8]]},4*256,4*256)).toBe(true);expect(regionContains({kind:'polygon',points:[[0,0],[8,0],[0,8]]},5*256,5*256)).toBe(false);
},120000);
test('caller goal/source edits during a yield cannot alter the owned route query',async()=>{
 const goal={...gap},source={...structuredClone(initial)},before=replayBytes(source);
 const result=await p.route(source,goal,'astar',undefined,async()=>{goal.x=0;source.vx=9999;});
 expect(result.status).toBe('verified reachable with replay witness');expect(result.actions.every(a=>a.kind==='wait'?a.durationTicks<=3600:a.durationTicks<=result.settings.maxActionTicks)).toBe(true);expect(result.goals).toEqual([gap]);expect(replayBytes(result.initial)).toBe(before);
 expect(Object.isFrozen(result.settings)).toBe(true);expect(Object.isFrozen(result.settings.air)).toBe(true);
},120000);
test('opposing directional permissions cannot turn an existing geometric stance into proven unreachable',async()=>{
 const input=JSON.parse(readFileSync('conformance/surface/three-direction.map.json','utf8')) as MapDocument;
 const m={...input,footholds:input.footholds.map(f=>({...f,direction:f.id==='fh.a'?'aToB' as const:f.id==='fh.c'?'bToA' as const:f.direction}))};
 const world=createWorld(m as unknown as ContactMap,enemy),start=anchorState(world,{kind:'world',point:[64,300]}),nav=await Navigation.build(m,enemy,1,undefined,undefined,async()=>{});
 const result=await nav.route(start,{supportId:'fh.a',x:102*256,toleranceSu:128,vx:0},'astar',undefined,async()=>{});
 expect(result.status).toBe('no route found within declared search/sampling budget');expect(result.diagnostics.join(' ')).toContain('geometric stance exists');expect(result.frames).toEqual([]);
},120000);
test('author links, dynamic bodies, advanced abilities and unknown patrol conditions cannot fabricate a feasible route',async()=>{
 const link={id:'nav.fake',from:{kind:'world' as const,point:[64,300] as const},to:{kind:'world' as const,point:[660,300] as const},action:{key:'core.teleport',version:1,params:{}},requiredAbilities:[],conditions:[],bidirectional:true,extraCostTicks:0};
 for(const [m,profile] of [[{...map,navigation:{...map.navigation,links:[link]}},player],[{...map,bodies:map.bodies.map(b=>({...b,mobility:'kinematic' as const}))},player],[map,{...player,abilities:player.abilities.map(a=>a.kind==='jump'?{...a,airJumps:17}:a)}]] as const){
  const nav=await Navigation.build(m,profile,1,undefined,undefined,async()=>{});expect(await nav.route(initial,gap)).toMatchObject({status:'unsupported',actions:[],frames:[]});
 }
 const actor=map.entities.find(e=>e.id==='spawn.ground')!;
 const conditional={...map,entities:[...map.entities,{...actor,id:'spawn.ghost',...('ai' in actor?{ai:{...actor.ai,routeId:'route.ghost'}}:{})}],flags:[{id:'flag.runtime',initial:true}],routes:[...map.routes.map(r=>({...r,conditions:[{kind:'flag' as const,id:'flag.runtime',equals:true}]})),{...map.routes[0]!,id:'route.ghost',requiredAbilities:['locomotion.jump']}]};
 const nav=await Navigation.build(conditional,enemy,1,undefined,undefined,async()=>{});expect(await nav.patrol('spawn.ground')).toMatchObject({status:'unsupported',frames:[]});expect(await nav.patrol('spawn.ghost')).toMatchObject({status:'unsupported',frames:[]});
},120000);
test('a full enemy loop includes waits, all legs, the return and compatible repeated cycle state',async()=>{
 const result=await e.patrol('spawn.ground','astar',undefined,async()=>{});expect(result.status).toBe('verified reachable with replay witness');expect(result.actions.every(a=>a.kind==='wait'?a.durationTicks<=3600:a.durationTicks<=result.settings.maxActionTicks)).toBe(true);
 const waits=result.actions.filter(a=>a.kind==='wait');expect(waits.map(a=>a.durationTicks)).toEqual([3,2,3,2,3]);
 expect(physicalStateKey(waits[2]!.terminal)).toBe(physicalStateKey(waits[4]!.terminal));expect(result.actions.some(a=>a.input.some(c=>c.jump||c.drop))).toBe(false);
 expect(replayRouteActions(createWorld(map as unknown as ContactMap,enemy),result.initial!,result.actions)?.frames).toEqual(result.frames);
 const ping={...map,routes:map.routes.map(r=>({...r,mode:'pingPong' as const}))};const nav=await Navigation.build(ping,enemy,1,undefined,undefined,async()=>{});expect((await nav.patrol('spawn.ground','astar',undefined,async()=>{})).status).toBe('verified reachable with replay witness');
},120000);
test('climb routes use a zero heuristic and replay the exit/input-ready join before returning',async()=>{
 const m=JSON.parse(readFileSync('conformance/surface/ladder.map.json','utf8')) as MapDocument,profile=JSON.parse(readFileSync('conformance/surface/climber.movement.json','utf8')) as MovementDocument;
 const world=createWorld(m as unknown as ContactMap,profile),start=anchorState(world,{kind:'world',point:[100,300]}),nav=await Navigation.build(m,profile,1,undefined,undefined,async()=>{});
 const up=await nav.route(start,{supportId:'fh.elevated',x:100*256,toleranceSu:128,vx:0},'astar',undefined,async()=>{});
 expect(up.status).toBe('verified reachable with replay witness');expect(up.heuristic).toBe('zero');expect(up.actions.some(a=>a.kind==='climb')).toBe(true);
 const down=await nav.route(up.terminal!,{supportId:'fh.floor',x:100*256,toleranceSu:128,vx:0},'astar',undefined,async()=>{});
 expect(down.status).toBe('verified reachable with replay witness');expect(down.initial).toEqual(up.terminal);
 expect(replayRouteActions(world,start,[...up.actions,...down.actions])?.terminal).toEqual(down.terminal);
},120000);
test('budget/cancel/depth/duration exhaustion publishes no partial proof',async()=>{
 for(const settings of [{maxExpanded:1},{maxReplayTicks:1},{maxDepth:1},{maxRouteTicks:1}]){
  const nav=await p.withSearchLimits(settings);expect(await nav.route(initial,gap,'astar',undefined,async()=>{})).toMatchObject({status:'budget',actions:[],input:[],frames:[],terminal:null});
 }
 expect(await p.route(initial,gap,'astar',()=>true)).toMatchObject({status:'cancelled',frames:[]});
 let cancel=false;expect(await p.route(initial,gap,'astar',()=>cancel,async()=>{cancel=true;})).toMatchObject({status:'cancelled',frames:[]});
 await expect(Navigation.build(map,player,-1)).rejects.toThrow();await expect(Navigation.build(map,player,1,{...ROUTE_DEFAULTS,penaltyTicks:-1})).rejects.toThrow();
},120000);
test('route intent, physics, profile and sampling identity invalidate; art-only edits and source ordering stay warm',async()=>{
 const id=await routingIdentity(map,player,ROUTE_DEFAULTS);
 for(const changed of [{...map,bodies:[]},{...map,waypoints:map.waypoints.map(w=>({...w,waitTicks:w.waitTicks+1}))},{...map,routes:map.routes.map(r=>({...r,mode:'once' as const}))}])expect((await routingIdentity(changed,player,ROUTE_DEFAULTS)).cacheKey).not.toBe(id.cacheKey);
 expect((await routingIdentity(map,{...player,air:{...player.air,gravity:97}},ROUTE_DEFAULTS)).cacheKey).not.toBe(id.cacheKey);
 expect((await routingIdentity(map,player,{...ROUTE_DEFAULTS,maxDepth:15})).cacheKey).not.toBe(id.cacheKey);
 expect((await routingIdentity({...map,visuals:[],metadata:{...map.metadata,name:'Art rename'},entities:map.entities.map(e=>({...e,name:'Art name'}))},player,ROUTE_DEFAULTS)).cacheKey).toBe(id.cacheKey);
 expect((await routingIdentity({...map,entities:[...map.entities].reverse(),waypoints:[...map.waypoints].reverse()},player,ROUTE_DEFAULTS)).cacheKey).toBe(id.cacheKey);
});
test('Navigation publication rejects stale revision, query and physical identity; warm results remain derived',async()=>{
 const sent:RoutingRequest[]=[],session=new RoutingSession(r=>sent.push(r)),query:RouteQuery={kind:'route',sourceId:'spawn.player',initial:null,goal:gap,algorithm:'astar'},before=replayBytes([map,player]);
 await session.solve(map,player,1,query);const first=sent.find(r=>r.kind==='solve')!;session.invalidate();expect(session.accept({kind:'proof',job:first.job,requestSha256:await digest(query),proof:gapProof})).toBe(false);
 await session.solve(map,player,2,query);const request=sent.at(-1)!;const reply={kind:'proof' as const,job:request.job,requestSha256:await digest(query),proof:{...gapProof,revision:2}};
 expect(session.accept({...reply,requestSha256:'0'.repeat(64)})).toBe(false);expect(session.accept({...reply,proof:{...reply.proof,identity:{...gapProof.identity,cacheKey:'0'.repeat(64)}}})).toBe(false);
 expect(session.accept(reply)).toBe(true);await session.solve({...map,metadata:{...map.metadata,name:'Art'}},player,3,query);expect(session.getSnapshot().proof?.revision).toBe(3);
 expect(replayBytes([map,player])).toBe(before);session.dispose();expect(session.accept(reply)).toBe(false);await expect(session.solve(map,player,4,query)).rejects.toThrow();
});
test('every owned final proof is deterministic and consumed in isolation; rehashed input corruption fails',async()=>{
 const cases=read<{id:string;kind:string;profile:string;goal?:Goal;regionId?:string}[]>('cases.json');
 for(const c of cases){const nav=c.profile==='player.movement.json'?p:e,source=nav.sourceState(c.profile==='player.movement.json'?'spawn.player':'spawn.ground'),proof=c.kind==='patrol'?await nav.patrol('spawn.ground','astar',undefined,async()=>{}):c.kind==='region'?await nav.region(source,c.regionId!,'astar',undefined,async()=>{}):await nav.route(source,c.goal!,'astar',undefined,async()=>{});expect(replayBytes(proof)+'\n').toBe(readFileSync(join(folder,c.id+'.proof.json'),'utf8'));}
 const index=read<{files:{path:string;sha256:string}[]}>('index.json');expect(index.files.map(f=>f.path).sort()).toEqual(readdirSync(folder).filter(f=>f!=='index.json').sort());for(const f of index.files)expect(createHash('sha256').update(readFileSync(join(folder,f.path))).digest('hex')).toBe(f.sha256);
 const temp=mkdtempSync(join(tmpdir(),'maplab-route-consumer-'));
 try{cpSync(folder,join(temp,'fixtures'),{recursive:true});cpSync('tests/consumer/routes.mjs',join(temp,'consumer.mjs'));const run=()=>execFileSync(process.execPath,[join(temp,'consumer.mjs'),join(temp,'fixtures')],{cwd:temp,encoding:'utf8',stdio:['ignore','pipe','pipe']});expect(JSON.parse(run()).verified).toBe(true);
  const f=join(temp,'fixtures/player-gap.proof.json'),proof=JSON.parse(readFileSync(f,'utf8'));proof.input[0].jump=!proof.input[0].jump;proof.dependencies.sha256=await digest({identity:proof.identity,initial:proof.initial,goals:proof.goals,actions:proof.actions,frames:proof.frames});writeFileSync(f,JSON.stringify(proof)+'\n');const ix=JSON.parse(readFileSync(join(temp,'fixtures/index.json'),'utf8'));ix.files.find((f:{path:string})=>f.path==='player-gap.proof.json').sha256=createHash('sha256').update(readFileSync(f)).digest('hex');writeFileSync(join(temp,'fixtures/index.json'),JSON.stringify(ix));expect(run).toThrow();
 }finally{rmSync(temp,{recursive:true,force:true});}
},120000);
