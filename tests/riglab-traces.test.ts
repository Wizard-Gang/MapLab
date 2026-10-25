import {test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {TestSession,NEUTRAL} from '../src/test-runtime/session';
import {samplePresentation} from '../src/riglab/presentation';
import {verifyRigBundle} from '../src/riglab/bundle';
import {boundMap,binding,armor,rigFiles} from './riglab-fixtures';
import type {MapGeometry} from '../src/contracts/geometry';
import type {MovementDocument} from '../src/contracts/movement-types';
test('baked root translation, art/facing changes, missing clips and unbaked data cannot change complete actor traces',()=>{
 const map=boundMap(),plain=structuredClone(map) as any;plain.presentations=[];plain.assets=[];plain.dependencies=plain.dependencies.filter((d:any)=>d.kind!=='riglab');plain.entities.forEach((e:any)=>e.presentationId=null);
 const profile=JSON.parse(readFileSync('placeholder-library/movement/player.movement.json','utf8')) as MovementDocument,bundle=verifyRigBundle(rigFiles());
 const a=new TestSession(map as unknown as MapGeometry,profile),b=new TestSession(plain,profile),original=JSON.stringify(map),traceA=[],traceB=[];
 for(let tick=0;tick<90;tick++){
  const input={...NEUTRAL,moveX:(tick<30?1:tick<60?-1:0) as -1|0|1,jump:tick===12},art=a.advance(input),debug=b.advance(input);
  const state=art.state,bindingValue=tick>=60?{...binding(),artSlots:[]}:binding();
  samplePresentation(tick%3===0?null:bundle,bindingValue,[armor()],{tick,stateEnterTick:0,semantic:tick<45?'locomotion.idle':'climb.ladder',foot:[state.x/256,state.y/256],facing:state.facing===1?'right':'left'});
  traceA.push({state:art.state,contacts:art.contacts,status:art.status});traceB.push({state:debug.state,contacts:debug.contacts,status:debug.status});
 }
 expect(traceA.every(f=>f.status==='ok')).toBe(true);expect(traceA.at(-1)!.state.tick).toBe(90);expect(traceA).toEqual(traceB);expect(JSON.stringify(map)).toBe(original);expect(a.getSnapshot().input).toEqual(b.getSnapshot().input);
});
