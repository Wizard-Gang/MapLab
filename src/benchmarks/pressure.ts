import type {MapModel} from '../domain/model';
import {PaintBuffer} from '../domain/paint';
import {commit,openDocument} from '../editor/history';
import {invertTransaction,type Transaction} from '../domain/transaction';
import {decodeImage,ImageLru} from '../render/assets';
import {inspectImage} from '../assets/inspect';
export async function historyPressure(model:MapModel){
  let state=openDocument(model);const buffer=new PaintBuffer(model.terrain!.byLayer.get('layer.tiles')!.cells);
  for(let i=0;i<100000;i++)buffer.write({column:i%5000,row:Math.floor(i/5000),cell:{tileId:'tile.grass',quarterTurns:0,mirrorX:true,mirrorY:false}});
  const forward:Transaction={label:'Owned retained history pressure',ops:[{op:'paint',layerId:'layer.tiles',delta:buffer.delta()!}]};
  const reverse=invertTransaction(forward);const raw=[];
  for(let i=0;i<160;i++){
    const start=performance.now(),result=commit(state,i%2===0?forward:reverse);
    if(result.outcome!=='recorded')throw Error('History pressure refused');state=result.state;
    raw.push({bytes:state.bytes,budget:state.budget,dropped:state.dropped,ms:performance.now()-start});
    if(state.bytes>state.budget)throw Error('Retained history exceeded its budget');
    if(state.dropped>3)break;
    if(i%4===3)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  }
  if(!state.dropped||state.bytes<state.budget*.9)throw Error('History pressure did not saturate and evict');
  return {state,raw};
}
export async function artPressure(){
  const cache=new ImageLru();let closed=0;
  // Original numeric SVG fixture, inspected and decoded through the production image path.
  const bytes=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#80b090"/></svg>');
  const approved=inspectImage(bytes,'image/svg+xml'),signal=new AbortController().signal;
  for(let i=0;i<=cache.budget/(1024*1024*4);i++){
    const decoded=await decodeImage(approved,signal),close=decoded.close.bind(decoded);
    cache.put(String(i),{...decoded,close(){closed++;close();}});
    if(cache.bytes>cache.budget)throw Error('Decoded-art cache exceeded budget');
  }
  if(!closed||cache.get('0'))throw Error('Decoded-art pressure did not evict oldest surface');
  return {cache,get closed(){return closed;}};
}
