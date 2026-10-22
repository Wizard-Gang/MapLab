import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resetLibrary,index,writeLibraryFile,libraryFile,sha256,openEditor,openMap,saveElsewhere} from './support';
const read=(f:string)=>JSON.parse(readFileSync('conformance/routes/'+f,'utf8'));
function fixture(){
 resetLibrary();const project=JSON.parse(libraryFile('maplab.project.json').toString('utf8')),map=read('forest.map.json');
 const files=[{id:'movement.routes.player',kind:'movement',path:'movement/routes-player.movement.json',doc:read('player.movement.json')},{id:'movement.routes.enemy',kind:'movement',path:'movement/routes-enemy.movement.json',doc:read('enemy.movement.json')}];
 for(const dep of map.dependencies){const file=files.find(f=>f.id===dep.id);dep.path=file?.path??project.documents.find((d:{id:string})=>d.id===dep.id).path;}
 files.push({id:map.id,kind:'map',path:'maps/routes.map.json',doc:map});
 for(const f of files){const bytes=JSON.stringify(f.doc,null,2)+'\n';writeLibraryFile(f.path,bytes);project.documents.push({id:f.id,kind:f.kind,path:f.path,sha256:sha256(Buffer.from(bytes))});}
 writeLibraryFile('maplab.project.json',JSON.stringify(project,null,2)+'\n');
}
test.beforeEach(fixture);
test('Navigation mode verifies the complete player gap and own-profile enemy loop without editing source',async({page})=>{
 test.setTimeout(120000);const before=libraryFile('maps/routes.map.json');await openEditor(page);await openMap(page,'map.routes.forest');
 await page.getByRole('button',{name:'Navigation mode',exact:true}).click();
 await expect(page.getByLabel('Pick mode')).toHaveValue('Navigation');
 await page.getByLabel('Navigation profile').selectOption('movement.routes.player');await page.getByLabel('Navigation source').selectOption('spawn.player');
 await page.getByLabel('Navigation target support').selectOption('fh.east');await page.getByLabel('Navigation target X').fill('660');
 await page.getByRole('button',{name:'Find reference route',exact:true}).click();
 await expect(page.getByLabel('Reference route status')).toHaveText('verified reachable with replay witness',{timeout:90000});
 await expect(page.getByLabel('Route breakdown')).toContainText('jump');await expect(page.getByLabel('Reference route overlay')).toBeVisible();
 await page.getByLabel('Navigation source').selectOption('spawn.ground');await page.getByRole('button',{name:'Find reference route',exact:true}).click();
 await expect(page.getByLabel('Reference route status')).toHaveText('no route found within declared search/sampling budget',{timeout:90000});
 await page.getByRole('button',{name:'Verify enemy patrol',exact:true}).click();
 await expect(page.getByLabel('Reference route status')).toHaveText('verified reachable with replay witness',{timeout:90000});await expect(page.getByLabel('Route breakdown')).toContainText('wait');
 expect(libraryFile('maps/routes.map.json')).toEqual(before);await expect(page.getByText('Saved',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Exit Navigation',exact:true}).click();await expect(page.getByLabel('Reference route status')).toHaveCount(0);
});
test('a cancelled or source-invalidated Navigation job never publishes an old proof',async({page})=>{
 test.setTimeout(120000);await openEditor(page);await openMap(page,'map.routes.forest');await page.getByRole('button',{name:'Navigation mode',exact:true}).click();
 await page.getByLabel('Navigation profile').selectOption('movement.routes.player');await page.getByLabel('Navigation target support').selectOption('fh.east');await page.getByLabel('Navigation target X').fill('660');
 await page.getByRole('button',{name:'Find reference route',exact:true}).click();await page.getByRole('button',{name:'Cancel navigation',exact:true}).click();await expect(page.getByLabel('Reference route status')).toHaveCount(0);
 const map=JSON.parse(libraryFile('maps/routes.map.json').toString());map.bodies.find((b:{id:string})=>b.id==='body.east').enabled=false;map.footholds.find((f:{id:string})=>f.id==='fh.east').enabled=false;
 saveElsewhere('maps/routes.map.json',JSON.stringify(map,null,2)+'\n');await page.getByRole('button',{name:'Find reference route',exact:true}).click();
 // A reload disposes the old document's worker, even if its digest/build is pending.
 await page.reload();await openMap(page,'map.routes.forest');await expect(page.getByLabel('Reference route status')).toHaveCount(0);
 expect(index().documents.some(d=>d.id==='map.routes.forest')).toBe(true);
});
test('the route worker produces identical final proof bytes in Chromium and WebKit',async({page})=>{
 test.setTimeout(120000);await page.goto('/');
 const proof=await page.evaluate(async({map,profile})=>{
  const path='/src/navigation/routing-client.ts';const {createRoutingWorker}=await import(path),runtime=createRoutingWorker(),session=runtime.session;
  try{
   await session.solve(map,profile,1,{kind:'route',sourceId:'spawn.player',initial:null,goal:{supportId:'fh.east',x:660*256,toleranceSu:128,vx:0},algorithm:'astar'});
   return await new Promise((resolve,reject)=>{const end=Date.now()+100000;const timer=setInterval(()=>{const view=session.getSnapshot();if(view.phase==='complete'){clearInterval(timer);resolve(view.proof);}else if(view.phase==='failed'||Date.now()>end){clearInterval(timer);reject(Error(view.error||'route worker timeout'));}},20);});
  }finally{runtime.dispose();}
 },{map:read('forest.map.json'),profile:read('player.movement.json')});
 expect(proof).toEqual(read('player-gap.proof.json'));
});
