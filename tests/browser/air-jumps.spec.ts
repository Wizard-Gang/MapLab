import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import type {MapDocument,MovementDocument} from '../../src/contracts';
import type {State,RunInput} from '../../src/physics-reference';
import {Navigation,type Goal,type RouteProof} from '../../src/navigation/routes';
import {resetLibrary,libraryFile,writeLibraryFile,sha256,openEditor,openMap} from './support';

const read=<T>(file:string):T=>JSON.parse(readFileSync('conformance/air-jumps/'+file,'utf8'));
interface Fixture {map:string;profile:string;initial:State;input:RunInput[];ticks:number;expect:{status:string;state:State}[]}
const cases=read<{cases:string[];route:{goal:Goal}}>('cases.json');

test('selected browser controller and Test recording match every authored integer charge state',async({page})=>{
 const vectors=cases.cases.map(name=>{const c=read<Fixture>(name);return {c,map:read<MapDocument>(c.map),profile:read<MovementDocument>(c.profile)};});
 await page.goto('/');
 const actual=await page.evaluate(async vectors=>{
  const physicsPath='/src/physics-reference/index.ts',adapterPath='/src/air-jumps/runtime.ts',sessionPath='/src/test-runtime/session.ts';
  const {createWorld}=await import(physicsPath),{step}=await import(adapterPath),{TestSession}=await import(sessionPath);
  return vectors.map(({c,map,profile})=>{
   const before=JSON.stringify([c,map,profile]),world=createWorld(map,profile),frames=[];let state=c.initial;
   for(let n=0;n<c.ticks;n++){
    const {fromTick:_,...input}=c.input.filter(i=>i.fromTick<=state.tick).at(-1)!;
    const frame=step(world,state,input);frames.push({status:frame.status,state:frame.state});state=frame.state;
   }
   const session=new TestSession(map,profile,c.initial);session.replay({initial:c.initial,input:c.input,ticks:c.ticks});
   const recording=session.recording(),first=session.getSnapshot().frames;session.reset();session.replay(recording);
   return {frames,session:first.map((f:{status:string;state:State})=>({status:f.status,state:f.state})),repeat:JSON.stringify(first)===JSON.stringify(session.getSnapshot().frames),unchanged:before===JSON.stringify([c,map,profile])};
  });
 },vectors);
 for(let i=0;i<vectors.length;i++){expect(actual[i]).toEqual({frames:vectors[i]!.c.expect,session:vectors[i]!.c.expect,repeat:true,unchanged:true});}
});

test('route worker matches Node final proof bytes and distinguishes ground-only and spent-charge sources',async({page})=>{
 test.setTimeout(180000);
 const map=read<MapDocument>('chain.map.json'),profile=read<MovementDocument>('player.movement.json'),ground=read<MovementDocument>('ground.movement.json');
 const nav=await Navigation.build(map,profile,1,undefined,undefined,async()=>{}),expected=await nav.route(nav.sourceState('start.air-jumps'),cases.route.goal,'astar',undefined,async()=>{});
 expect(expected.status).toBe('verified reachable with replay witness');
 await page.goto('/');
 const actual=await page.evaluate(async({map,profile,ground,goal})=>{
  const path='/src/navigation/routing-client.ts',routesPath='/src/navigation/routes.ts';
  const {createRoutingWorker}=await import(path),{Navigation}=await import(routesPath),runtime=createRoutingWorker(),session=runtime.session;
  const solve=async(p:MovementDocument,initial:State|null,target:Goal):Promise<RouteProof>=>{
   await session.solve(map,p,1,{kind:'route',sourceId:'start.air-jumps',initial,goal:target,algorithm:'astar'});
   return new Promise((resolve,reject)=>{const deadline=Date.now()+100000;const timer=setInterval(()=>{
    const view=session.getSnapshot();if(view.phase==='complete'){clearInterval(timer);resolve(view.proof as RouteProof);}
    else if(view.phase==='failed'||Date.now()>deadline){clearInterval(timer);reject(Error(view.error||'air-jump worker timeout'));}
   },20);});
  };
  try{
   const proof=await solve(profile,null,goal),repeat=await solve(profile,null,goal),groundProof=await solve(ground,null,goal);
   const n=proof.frames.findIndex((f,i)=>i>0&&f.state.resources!.airJumps<proof.frames[i-1]!.state.resources!.airJumps);
   if(n<1)throw Error('missing airborne consumption');const state=proof.frames[n-1]!.state;
   const continuation={supportId:'fh.middle',x:38*256,toleranceSu:128,vx:0};
   const full=await solve(profile,state,continuation),spent=await solve(profile,{...state,resources:{...state.resources!,airJumps:0}},continuation);
   const direct=await Navigation.build(map,profile,1,undefined,undefined,async()=>{});
   return {proof,repeat,direct:await direct.route(direct.sourceState('start.air-jumps'),goal,'astar',undefined,async()=>{}),ground:groundProof.status,full:full.status,spent:spent.status};
  }finally{runtime.dispose();}
 },{map,profile,ground,goal:cases.route.goal});
 expect(actual.proof).toEqual(expected);expect(actual.repeat).toEqual(expected);expect(actual.direct).toEqual(expected);
 expect(actual.ground).toBe('no route found within declared search/sampling budget');expect(actual.full).toBe('verified reachable with replay witness');expect(actual.spent).not.toBe('verified reachable with replay witness');
});

test('integrated Test HUD shows held consumption and real ground reset without saving runtime state',async({page})=>{
 resetLibrary();const project=JSON.parse(libraryFile('maplab.project.json').toString()),source=read<MapDocument>('flat.map.json');
 const files:{id:string;kind:string;path:string;doc:MapDocument|MovementDocument}[]=['player','ground','two'].map(name=>({id:read<MovementDocument>(name+'.movement.json').id,kind:'movement',path:'movement/air-jumps-'+name+'.movement.json',doc:read<MovementDocument>(name+'.movement.json')}));
 const map={...source,dependencies:source.dependencies.map(dep=>({...dep,path:files.find(f=>f.id===dep.id)!.path}))};
 files.push({id:map.id,kind:'map',path:'maps/air-jumps.map.json',doc:map});
 for(const f of files){const bytes=JSON.stringify(f.doc)+'\n';writeLibraryFile(f.path,bytes);project.documents.push({id:f.id,kind:f.kind,path:f.path,sha256:sha256(bytes)});}
 writeLibraryFile('maplab.project.json',JSON.stringify(project)+'\n');const before=libraryFile('maps/air-jumps.map.json'),index=libraryFile('maplab.project.json');
 await openEditor(page);await openMap(page,map.id);await page.getByLabel('Test movement profile',{exact:true}).selectOption('movement.air-jumps');await page.getByRole('button',{name:'Start Test snapshot',exact:true}).click();
 const c=read<Fixture>(cases.cases[0]!),hud=page.getByLabel('Test movement HUD',{exact:true});
 const ticks=new Set([1,c.ticks]);let prior=c.initial;
 for(const frame of c.expect){if(frame.state.resources!.airJumps!==prior.resources!.airJumps){ticks.add(frame.state.tick);if(frame.state.tick<c.ticks)ticks.add(frame.state.tick+1);}prior=frame.state;}
 for(const tick of [...ticks].sort((a,b)=>a-b)){
  await page.getByLabel('Test replay input',{exact:true}).fill(JSON.stringify({initial:c.initial,input:c.input.filter(i=>i.fromTick<c.initial.tick+tick),ticks:tick}));
  await page.getByRole('button',{name:'Replay Test',exact:true}).click();await expect(page.getByLabel('Test notice',{exact:true})).toHaveText('Replay complete; paused');
  const state=c.expect[tick-1]!.state;await expect(hud).toHaveAttribute('data-tick',String(state.tick));await expect(hud).toHaveAttribute('data-state',state.mode);await expect(hud).toHaveAttribute('data-support',state.supportId??'');await expect(hud).toContainText('Air jumps '+state.resources!.airJumps);
 }
 await page.getByRole('button',{name:'Reset Test',exact:true}).click();await expect(hud).toHaveAttribute('data-tick','0');await expect(hud).toContainText('Air jumps 1');await page.getByRole('button',{name:'Stop Test',exact:true}).click();
 expect(libraryFile('maps/air-jumps.map.json')).toEqual(before);expect(libraryFile('maplab.project.json')).toEqual(index);
});
