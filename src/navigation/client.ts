import { GraphSession, type Reply } from './protocol';
/** One module worker per ephemeral consumer. Close it when its document closes. */
export function createNavigationWorker(){
 const worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
 const session=new GraphSession(message=>worker.postMessage(message));
 worker.onmessage=(event:MessageEvent<Reply>)=>{session.accept(event.data);};
 worker.onerror=()=>session.invalidate();
 return {session,dispose:()=>{session.dispose();worker.terminate();}};
}
