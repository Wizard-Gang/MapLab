import {test,expect} from '@playwright/test';import {readFileSync} from 'node:fs';
import type {MapDocument,MovementDocument} from '../../src/contracts';import type {State} from '../../src/physics-reference';
import {Navigation,type Goal,type RouteProof} from '../../src/navigation/routes';
import {resetLibrary,libraryFile,writeLibraryFile,sha256,openEditor,openMap} from './support';
const read=<T=any>(f:string):T=>JSON.parse(readFileSync('conformance/dash/'+f,'utf8'));
const cases=read('cases.json');
test('browser runtime and Test recording reproduce every integer dash fixture',async({page})=>{
 const vectors=cases.cases.map((name:string)=>{const c=read(name);return {c,map:read<MapDocument>(c.map),profile:read<MovementDocument>(c.profile)};});await page.goto('/');
 const actual=await page.evaluate(async vectors=>{
  const physics='/src/physics-reference/index.ts',adapter='/src/dash/runtime.ts',sessionPath='/src/test-runtime/session.ts';
  const {createWorld}=await import(physics),{step}=await import(adapter),{TestSession}=await import(sessionPath);
  return vectors.map(({c,map,profile}:any)=>{const world=createWorld(map,profile),frames=[];let s=c.initial;for(let n=0;n<c.ticks;n++){const {fromTick:_,...input}=c.input.filter((i:any)=>i.fromTick<=s.tick).at(-1);const f=step(world,s,input);frames.push({status:f.status,state:f.state});s=f.state;}
   const session=new TestSession(map,profile,c.initial);session.replay({initial:c.initial,input:c.input,ticks:c.ticks});const first=session.getSnapshot().frames,recording=session.recording();session.reset();session.replay(recording);return {frames,session:first.map((f:any)=>({status:f.status,state:f.state})),repeat:JSON.stringify(first)===JSON.stringify(session.getSnapshot().frames)};
  });
 },vectors);for(let i=0;i<vectors.length;i++)expect(actual[i]).toEqual({frames:vectors[i].c.expect,session:vectors[i].c.expect,repeat:true});
});
test('route worker preserves final proof bytes and rejects a spent air-dash continuation',async({page})=>{
 test.setTimeout(180000);const map=read<MapDocument>('chain.map.json'),profile=read<MovementDocument>('player.movement.json'),goal=cases.route.goal;
 const nav=await Navigation.build(map,profile,1,undefined,undefined,async()=>{}),expected=await nav.route(nav.sourceState('start.dash'),goal,'astar',undefined,async()=>{});expect(expected.status).toBe('verified reachable with replay witness');await page.goto('/');
 const actual=await page.evaluate(async({map,profile,goal,continuation})=>{
  const path='/src/navigation/routing-client.ts';const {createRoutingWorker}=await import(path),runtime=createRoutingWorker(),session=runtime.session;
  const solve=async(initial:State|null,target:Goal):Promise<RouteProof>=>{await session.solve(map,profile,1,{kind:'route',sourceId:'start.dash',initial,goal:target,algorithm:'astar'});return new Promise((resolve,reject)=>{const deadline=Date.now()+100000,timer=setInterval(()=>{const view=session.getSnapshot();if(view.phase==='complete'){clearInterval(timer);resolve(view.proof);}else if(view.phase==='failed'||Date.now()>deadline){clearInterval(timer);reject(Error(view.error||'dash worker timeout'));}},20);});};
  try{const proof=await solve(null,goal),full=await solve(continuation.initial,continuation.goal),s=structuredClone(continuation.initial);s.resources.dashCharges-=s.dash.remaining.air;s.dash.remaining.air=0;const spent=await solve(s,continuation.goal);return {proof,full,spent};}finally{runtime.dispose();}
 },{map,profile,goal,continuation:cases.continuation});expect(actual.proof).toEqual(expected);expect(actual.full.status).toBe('verified reachable with replay witness');expect(['budget','no route found within declared search/sampling budget']).toContain(actual.spent.status);expect(actual.spent.frames).toEqual([]);
});
test('integrated X controls, HUD, recording and replay remain ephemeral',async({page})=>{
 resetLibrary();const project=JSON.parse(libraryFile('maplab.project.json').toString()),source=read<MapDocument>('flat.map.json');
 const files:{id:string;kind:string;path:string;doc:MapDocument|MovementDocument}[]=['player','timer','fast','one','none'].map(n=>({id:read<MovementDocument>(n+'.movement.json').id,kind:'movement',path:'movement/dash-'+n+'.movement.json',doc:read<MovementDocument>(n+'.movement.json')}));
 const map={...source,dependencies:source.dependencies.map(d=>({...d,path:files.find(f=>f.id===d.id)!.path}))};files.push({id:map.id,kind:'map',path:'maps/dash.map.json',doc:map});for(const f of files){const bytes=JSON.stringify(f.doc)+'\n';writeLibraryFile(f.path,bytes);project.documents.push({id:f.id,kind:f.kind,path:f.path,sha256:sha256(bytes)});}writeLibraryFile('maplab.project.json',JSON.stringify(project)+'\n');const before=libraryFile('maps/dash.map.json'),index=libraryFile('maplab.project.json');
 await openEditor(page);await openMap(page,map.id);await page.getByLabel('Test movement profile',{exact:true}).selectOption('movement.dash');await page.getByRole('button',{name:'Start Test snapshot',exact:true}).click();const hud=page.getByLabel('Test movement HUD',{exact:true}),stage=page.getByRole('application',{name:'Test stage',exact:true});
 await stage.focus();await page.keyboard.down('KeyX');await page.keyboard.press('KeyN');await expect(hud).toHaveAttribute('data-tick','1');await expect(hud).toHaveAttribute('data-dash-left','2');await expect(hud).toContainText('Dash charges 2');await expect(hud).toContainText('"dash.ground":5');
 await page.keyboard.press('KeyN');await page.keyboard.press('KeyN');await expect(hud).toHaveAttribute('data-dash-left','0');await page.keyboard.press('KeyN');await expect(hud).toHaveAttribute('data-dash-left','0');await page.keyboard.up('KeyX');
 await page.getByRole('button',{name:'Use recorded input',exact:true}).click();const recording=JSON.parse(await page.getByLabel('Test replay input',{exact:true}).inputValue());expect(recording.input[0].dash).toBe(true);
 const c=read(cases.cases[1]);await page.getByLabel('Test replay input',{exact:true}).fill(JSON.stringify({initial:c.initial,input:c.input,ticks:c.ticks}));await page.getByRole('button',{name:'Replay Test',exact:true}).click();await expect(page.getByLabel('Test notice',{exact:true})).toHaveText('Replay complete; paused');await expect(hud).toHaveAttribute('data-tick',String(c.ticks));await expect(hud).toContainText('Dash charges '+c.expect.at(-1).state.resources.dashCharges);
 await page.getByRole('button',{name:'Reset Test',exact:true}).click();await expect(hud).toHaveAttribute('data-tick','0');await page.getByRole('button',{name:'Stop Test',exact:true}).click();expect(libraryFile('maps/dash.map.json')).toEqual(before);expect(libraryFile('maplab.project.json')).toEqual(index);
});
