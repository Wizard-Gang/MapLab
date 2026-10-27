import {test,expect} from '@playwright/test';
import {readFileSync,readdirSync} from 'node:fs';
import {resetLibrary,libraryFile,writeLibraryFile,sha256,openEditor} from './support';
const root='conformance/actions/',read=(f:string):any=>JSON.parse(readFileSync(root+f,'utf8'));
test('stateful worker witnesses replay with identical integer checkpoints in both browsers',async({page})=>{
 resetLibrary();await page.goto('/');
 const cases=read('cases.json').map((c:any)=>({...c,map:read(c.map),profile:read(c.profile)})),traces=read('traces.json').map((c:any)=>({...c,map:read(c.map),profile:read(c.profile)}));
 const result=await page.evaluate(async({cases,traces})=>{
  const client='/src/actions/client.ts',motor='/src/actions/controller.ts',replay='/src/actions/replay.ts';
  const {createActionWorker}=await import(client),{ActionWorld}=await import(motor),{ActionTestSession,replayActions}=await import(replay),runtime=createActionWorker();
  try{const plans=[];for(const c of cases){await runtime.session.solve(c.map,c.profile,c.query,1);await new Promise<void>((resolve,reject)=>{const done=()=>{const v=runtime.session.getSnapshot();if(v.phase==='complete'){stop();resolve();}else if(v.phase==='failed'){stop();reject(Error(v.error));}};const stop=runtime.session.subscribe(done);done();});const proof=runtime.session.getSnapshot().proof;plans.push({proof,replayed:proof.status==='verified reachable with replay witness'?replayActions(new ActionWorld(c.map,c.profile),c.query.initial,proof.frames):null});}
   const checkpoints=traces.map((c:any)=>{const session=new ActionTestSession(new ActionWorld(c.map,c.profile),c.initial);return c.inputs.map((u:any)=>session.tick(u));});return {plans,checkpoints};
  }finally{runtime.dispose();}
 },{cases,traces});
 for(let i=0;i<cases.length;i++){const r=result.plans[i]!;expect(r.proof.status,r.proof.diagnostics.join(';')).toBe(cases[i].status);expect(r.proof.heuristic).toBe('zero');if(r.replayed)expect(r.replayed).toEqual(r.proof.frames);}
 for(let i=0;i<traces.length;i++){expect(result.checkpoints[i]!.every((f:any)=>f.status==='ok')).toBe(true);expect(result.checkpoints[i]!.map((f:any)=>f.state)).toEqual(traces[i].expected);}
});
test('action navigation UI replays a teleport and discards edited queries and source',async({page})=>{
 resetLibrary();const index=JSON.parse(libraryFile('maplab.project.json').toString());index.documents=[];index.defaults.movementId='movement.actions';
 for(const name of readdirSync(root).filter(f=>/\.(map|movement|catalog)\.json$/.test(f))){const doc=read(name),kind=doc.format.slice(7),path=(kind==='map'?'maps/':kind==='catalog'?'catalogs/':'movement/')+name,bytes=JSON.stringify(doc)+'\n';writeLibraryFile(path,bytes);index.documents.push({id:doc.id,kind,path,sha256:sha256(bytes)});}writeLibraryFile('maplab.project.json',JSON.stringify(index)+'\n');const before=libraryFile('maps/open.map.json');
 await openEditor(page);await page.getByRole('button',{name:'Open map.actions',exact:true}).click();await expect(page.getByRole('region',{name:'Document map.actions',exact:true})).toBeVisible();await page.getByRole('button',{name:'Navigation mode',exact:true}).click();
 const panel=page.getByRole('region',{name:'Stateful action navigation',exact:true});await panel.getByLabel('Action profile',{exact:true}).selectOption('movement.actions');await panel.getByRole('button',{name:'Find action route',exact:true}).click();await expect(panel.getByLabel('Action status',{exact:true})).toHaveText('verified reachable with replay witness');await panel.getByRole('button',{name:'Replay action witness in Test',exact:true}).click();await expect(panel.getByLabel('Action notice',{exact:true})).toHaveText('Action Test replay verified');expect(libraryFile('maps/open.map.json')).toEqual(before);
 await panel.getByLabel('Action goal X',{exact:true}).fill('49');await expect(panel.getByLabel('Action status',{exact:true})).toHaveCount(0);await panel.getByLabel('Action goal X',{exact:true}).fill('48');await panel.getByRole('button',{name:'Find action route',exact:true}).click();await expect(panel.getByLabel('Action status',{exact:true})).toHaveText('verified reachable with replay witness');
 await page.getByLabel('Map name',{exact:true}).fill('Action source edited');await page.getByLabel('Map name',{exact:true}).blur();await expect(panel.getByLabel('Action status',{exact:true})).toHaveCount(0);
});
