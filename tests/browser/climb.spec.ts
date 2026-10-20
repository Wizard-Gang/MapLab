import { command, libraryFile, openEditor, openMap, resetLibrary } from './support';
import { expect,test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { replay } from '../../src/physics-reference';
import type { ContactMap,State,RunInput } from '../../src/physics-reference';
import type { MovementDocument } from '../../src/contracts/movement-types';

// Same module is the consumer entry point in V8 and JavaScriptCore. No app/simulation UI is added.
test('reference climb replay matches final fixture bytes in the browser engine',async({page})=>{
 const cases=JSON.parse(readFileSync('conformance/climb/cases.json','utf8')) as {cases:string[]};
 const vectors=[];
 for(const file of cases.cases){
  const c=JSON.parse(readFileSync('conformance/climb/'+file,'utf8')) as {map:string;profile:string;initial:State;input:RunInput[];ticks:number;expect:{traceSha256:string}};
  const map=JSON.parse(readFileSync('conformance/climb/'+c.map,'utf8')) as ContactMap,p=JSON.parse(readFileSync('conformance/climb/'+c.profile,'utf8')) as MovementDocument;
  expect((await replay(map,p,c.initial,c.input,c.ticks)).traceSha256).toBe(c.expect.traceSha256);
  vectors.push({map,p,c});
 }
 await page.goto('/');
 const output=await page.evaluate(async raw=>{
  const vectors=JSON.parse(raw) as {map:ContactMap;p:MovementDocument;c:{initial:State;input:RunInput[];ticks:number}}[];
  const path='/src/physics-reference/index.ts';
  const module=await import(/* @vite-ignore */ path) as typeof import('../../src/physics-reference');
  const hashes=[];
  for(const {map,p,c} of vectors){
   const a=await module.replay(map,p,c.initial,c.input,c.ticks),b=await module.replay(map,p,c.initial,c.input,c.ticks);
   if(module.replayBytes(a)!==module.replayBytes(b))throw new Error('nonrepeatable trace');
   hashes.push(a.traceSha256);
  }
  return hashes;
 },JSON.stringify(vectors));
 expect(output).toEqual(vectors.map(v=>v.c.expect.traceSha256));
});

test('climb path authoring edits save/reopen and undo atomically; invalid anchor leaves source intact',async({page})=>{
 resetLibrary();await openEditor(page);await openMap(page,'map.forest');await page.getByText('Ladders and ropes',{exact:true}).click();
 const original=libraryFile('maps/forest.map.json');
 await page.getByLabel('Existing climb path',{exact:true}).selectOption('traversal.ladder');
 await page.getByLabel('Climb grab radius',{exact:true}).fill('8');await page.getByLabel('Climb direction',{exact:true}).selectOption('up');
 await page.getByRole('button',{name:'Apply climb path',exact:true}).click();await expect(page.getByLabel('Edit notice',{exact:true})).toHaveText('Edit climb path');
 expect(libraryFile('maps/forest.map.json')).toEqual(original);
 await command(page,'Undo').click();await expect(command(page,'Undo')).toBeDisabled();await command(page,'Redo').click();
 await command(page,'Save').click();await expect(page.getByRole('status')).toContainText('Saved');
 const saved=JSON.parse(libraryFile('maps/forest.map.json').toString());expect(saved.traversals.find((t:any)=>t.id==='traversal.ladder')).toMatchObject({grabRadius:8,direction:'up'});
 await page.getByLabel('Climb access points',{exact:true}).fill('[{"id":"access.bad","pathU":2,"anchor":{"kind":"world","point":[0,0]},"entry":"either","exit":"either","conditions":[]}]');
 await page.getByRole('button',{name:'Apply climb path',exact:true}).click();await expect(page.getByLabel('Edit notice',{exact:true})).toContainText('refused');expect(JSON.parse(libraryFile('maps/forest.map.json').toString())).toEqual(saved);
 await page.reload();await openMap(page,'map.forest');await page.getByText('Ladders and ropes',{exact:true}).click();await page.getByLabel('Existing climb path',{exact:true}).selectOption('traversal.ladder');await expect(page.getByLabel('Climb grab radius',{exact:true})).toHaveValue('8');await expect(page.getByLabel('Climb direction',{exact:true})).toHaveValue('up');
});
