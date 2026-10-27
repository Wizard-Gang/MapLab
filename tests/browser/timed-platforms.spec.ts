import {test,expect} from '@playwright/test';import {readFileSync,readdirSync} from 'node:fs';
import {resetLibrary,libraryFile,writeLibraryFile,sha256,openEditor,openMap} from './support';
const root='conformance/timed-platforms/',read=(f:string):any=>JSON.parse(readFileSync(root+f,'utf8'));
test('periodic worker retains absolute phase and replays complete finite-body routes in both browsers',async({page})=>{
 resetLibrary();await page.goto('/');const cases=read('cases.json').map((c:any)=>({...c,map:read(c.map),profile:read(c.profile)}));
 const result=await page.evaluate(async cases=>{
  const client='/src/platforms/client.ts',replay='/src/platforms/replay.ts',timing='/src/platforms/timing.ts';
  const {createTimedWorker}=await import(client),{replayTimed,followTimed}=await import(replay),{phases}=await import(timing),runtime=createTimedWorker();
  try{const out=[];for(const c of cases){
   await runtime.session.solve(c.map,c.profile,c.query,1,c.settings);await new Promise<void>((resolve,reject)=>{const done=()=>{const v=runtime.session.getSnapshot();if(v.phase==='complete'){stop();resolve();}else if(v.phase==='failed'){stop();reject(Error(v.error));}};const stop=runtime.session.subscribe(done);done();});
   const proof=runtime.session.getSnapshot().proof,ok=proof.status==='verified reachable with replay witness';out.push({proof,replayed:ok?replayTimed(c.map,c.profile,c.query.initial,proof.frames):null,drift:ok?followTimed(c.map,c.profile,c.query.initial,proof.frames,0,c.query.initial,{tick:0,phases:phases(c.map,1)}).status:null});
  }return out;}finally{runtime.dispose();}
 },cases);
 for(let i=0;i<cases.length;i++){const r=result[i]!;expect(r.proof.status,r.proof.diagnostics.join(';')).toBe(cases[i].status);if(cases[i].costTicks!==undefined){expect(r.proof.costTicks).toBe(cases[i].costTicks);expect(r.replayed).toEqual(r.proof.frames);expect(r.drift).toBe('replan');}else expect(r.proof.frames).toEqual([]);}
});
test('editor timed route replays in Test, requests replan on phase drift and discards edited queries',async({page})=>{
 resetLibrary();const index=JSON.parse(libraryFile('maplab.project.json').toString());index.documents=[];index.defaults.movementId='movement.timed-platform';
 for(const name of ['elevator.map.json','player.movement.json']){const d=read(name),kind=d.format.slice(7),path=(kind==='map'?'maps/':'movement/')+name,bytes=JSON.stringify(d)+'\n';writeLibraryFile(path,bytes);index.documents.push({id:d.id,kind,path,sha256:sha256(bytes)});}writeLibraryFile('maplab.project.json',JSON.stringify(index)+'\n');
 const before=libraryFile('maps/elevator.map.json');await openEditor(page);await openMap(page,'map.timed-platform');await page.getByRole('button',{name:'Navigation mode',exact:true}).click();
 const panel=page.getByRole('region',{name:'Timed platform navigation',exact:true});await panel.getByLabel('Timed profile',{exact:true}).selectOption('movement.timed-platform');await panel.getByLabel('Timed goal support',{exact:true}).selectOption('fh.a-exit');
 await panel.getByRole('button',{name:'Find timed platform route',exact:true}).click();await expect(panel.getByLabel('Timed platform status',{exact:true})).toHaveText('verified reachable with replay witness');await expect(panel.getByLabel('Timed transitions',{exact:true})).toContainText('board');await expect(panel.getByLabel('Timed transitions',{exact:true})).toContainText('exit');
 await panel.getByRole('button',{name:'Replay timed witness in Test',exact:true}).click();await expect(panel.getByLabel('Timed platform notice',{exact:true})).toHaveText('Timed platform Test replay verified');
 await panel.getByRole('button',{name:'Check phase feedback',exact:true}).click();await expect(panel.getByLabel('Timed platform notice',{exact:true})).toHaveText('Phase feedback matches; follow next tick');
 await panel.getByLabel('Observed phase shift',{exact:true}).fill('1');await panel.getByRole('button',{name:'Check phase feedback',exact:true}).click();await expect(panel.getByLabel('Timed platform notice',{exact:true})).toContainText('Replan required: Platform phase drift');
 await panel.getByLabel('Timed start tick',{exact:true}).fill('1');await expect(panel.getByLabel('Timed platform status',{exact:true})).toHaveCount(0);await expect(panel.getByRole('button',{name:'Replay timed witness in Test',exact:true})).toBeDisabled();
 await panel.getByRole('button',{name:'Find timed platform route',exact:true}).click();await expect(panel.getByLabel('Timed platform status',{exact:true})).toHaveText('verified reachable with replay witness');
 await page.getByLabel('Map name',{exact:true}).fill('Timed source edited');await page.getByLabel('Map name',{exact:true}).blur();await expect(panel.getByLabel('Timed platform status',{exact:true})).toHaveCount(0);expect(libraryFile('maps/elevator.map.json')).toEqual(before);
});
