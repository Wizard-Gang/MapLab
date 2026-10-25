import {BlockerSession,type BlockerReply} from './blocker-protocol';
export function createBlockerWorker(){
 const worker=new Worker(new URL('./blocker-worker.ts',import.meta.url),{type:'module'}),session=new BlockerSession(r=>worker.postMessage(r));
 worker.onmessage=(event:MessageEvent<BlockerReply>)=>{session.accept(event.data);};
 worker.onerror=()=>session.invalidate();
 return {session,dispose:()=>{session.dispose();worker.terminate();}};
}
