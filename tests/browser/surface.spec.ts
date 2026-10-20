import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import type {MapDocument} from '../../src/contracts/document-types';
import type {MovementDocument} from '../../src/contracts/movement-types';
const read=<T>(f:string):T=>JSON.parse(readFileSync('conformance/surface/'+f,'utf8'));
test('module worker publishes only current profile/revision and preserves source bytes',async({page})=>{
 await page.goto('/');const map=read<MapDocument>('flat.map.json'),profile=read<MovementDocument>('enemy.movement.json');
 const result=await page.evaluate(async({map,profile})=>{
  const path='/src/navigation/client.ts';const {createNavigationWorker}=await import(path),runtime=createNavigationWorker(),session=runtime.session;
  const before=JSON.stringify([map,profile]);
  const wait=()=>new Promise<void>((resolve,reject)=>{const end=Date.now()+20000;const timer=setInterval(()=>{if(session.graph){clearInterval(timer);resolve();}else if(Date.now()>end){clearInterval(timer);reject(new Error('worker timeout'));}},20);});
  await session.build(map,profile,1);await session.build(map,{...profile,ground:{...profile.ground,walkSpeed:513}},2);session.invalidate();
  await session.build(map,profile,3);await wait();const first=session.graph;
  await session.build({...map,metadata:{...map.metadata,name:'Art only'}},profile,4);const warm=session.graph;
  session.invalidate();const cleared=session.graph===null;runtime.dispose();
  return {first,warm,cleared,sourceUnchanged:before===JSON.stringify([map,profile])};
 },{map,profile});
 expect(result.first).toEqual({...read<Record<string,unknown>>('flat-enemy.graph.json'),revision:3});expect(result.warm).toEqual({...result.first,revision:4});expect(result.cleared).toBe(true);expect(result.sourceUnchanged).toBe(true);
});
