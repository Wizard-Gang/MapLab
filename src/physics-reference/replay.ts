import { step } from './controller';
import { createWorld } from './world';
import { integer } from './integer';
import { movementProfileDigest } from '../contracts/movement';
import type { MovementDocument } from '../contracts/movement-types';
import type { ContactMap, RunInput, State, Step, Trace } from './types';

/** Stable object-key serialization. Arrays retain their semantic order. */
export function replayBytes(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(replayBytes).join(',')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+replayBytes((value as Record<string,unknown>)[k])).join(',')+'}';
  const result=JSON.stringify(value);if(result===undefined)throw new Error('non-JSON replay');return result;
}
export async function digest(value:unknown):Promise<string> {
  const bytes=new TextEncoder().encode(replayBytes(value));
  const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
/** Run-length inputs are absolute ticks. Failed frames terminate without advancing state. */
export async function replay(map:ContactMap,profile:MovementDocument,initial:State,input:readonly RunInput[],ticks:number):Promise<Trace> {
  integer(ticks);if(ticks<0||ticks>100_000)throw new RangeError('replay tick budget');
  if(input.length===0||input[0]!.fromTick!==initial.tick||input.some((v,i)=>!Number.isSafeInteger(v.fromTick)||(i>0&&v.fromTick<=input[i-1]!.fromTick)))throw new Error('invalid input schedule');
  const world=createWorld(map,profile),schedule=structuredClone(input),start=structuredClone(initial),frames:Step[]=[];let state=start,index=0;
  for(let n=0;n<ticks;n++){
    while(schedule[index+1]&&schedule[index+1]!.fromTick<=state.tick)index++;
    const {fromTick:_,...controls}=schedule[index]!;
    const frame=step(world,state,controls);frames.push(frame);state=frame.state;
    if(frame.status!=='ok')break;
  }
  const body={format:'maplab.contact-replay' as const,version:1 as const,scope:'contact' as const,canCertify:false as const,
    controller:{key:'maplab.reference-controller' as const,version:1 as const},collision:{key:'maplab.collision' as const,version:1 as const},
    sourceSha256:await digest(world.source),profileSha256:await movementProfileDigest(world.profile),initial:start,input:schedule,frames};
  return {...body,traceSha256:await digest(body)};
}
