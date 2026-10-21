import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import type {MapDocument} from '../../src/contracts/document-types';
import type {MovementDocument} from '../../src/contracts/movement-types';
import type {AirResult} from '../../src/navigation/airborne';
const read=<T>(f:string):T=>JSON.parse(readFileSync('conformance/airborne/'+f,'utf8'));
test('bounded airborne module has the exact same forest witness bytes in each browser',async({page})=>{
 test.setTimeout(120_000);await page.goto('/');
 const actual=await page.evaluate(async({map,profile})=>{
  const path='/src/navigation/airborne.ts';const {buildAirborneActions}=await import(path);
  const before=JSON.stringify([map,profile]),graph=await buildAirborneActions(map,profile,1,undefined,undefined,async()=>{});
  return {graph,unchanged:before===JSON.stringify([map,profile])};
 },{map:read<MapDocument>('forest.map.json'),profile:read<MovementDocument>('player.movement.json')});
 expect(actual.unchanged).toBe(true);expect(actual.graph).toEqual(read<AirResult>('forest.actions.json'));
});
