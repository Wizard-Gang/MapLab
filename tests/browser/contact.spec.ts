import { expect,test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { replay } from '../../src/physics-reference';
import type { ContactMap,State,RunInput } from '../../src/physics-reference';
import type { MovementDocument } from '../../src/contracts/movement-types';

// Same module is the consumer entry point in V8 and JavaScriptCore. No app/simulation UI is added.
test('reference contact replay matches final fixture bytes in the browser engine',async({page})=>{
 const cases=JSON.parse(readFileSync('conformance/contact/cases.json','utf8')) as {cases:string[]};
 const vectors=[];
 for(const file of cases.cases){
  const c=JSON.parse(readFileSync('conformance/contact/'+file,'utf8')) as {map:string;profile:string;initial:State;input:RunInput[];ticks:number;expect:{traceSha256:string}};
  const map=JSON.parse(readFileSync('conformance/contact/'+c.map,'utf8')) as ContactMap,p=JSON.parse(readFileSync('conformance/contact/'+c.profile,'utf8')) as MovementDocument;
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
