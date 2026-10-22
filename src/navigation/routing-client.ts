import { RoutingSession, type RoutingReply } from './routing-protocol';
export function createRoutingWorker(){
 const worker=new Worker(new URL('./route-worker.ts',import.meta.url),{type:'module'}),session=new RoutingSession(request=>worker.postMessage(request));
 worker.onmessage=(event:MessageEvent<RoutingReply>)=>{session.accept(event.data);};worker.onerror=()=>session.invalidate();
 return {session,dispose:()=>{session.dispose();worker.terminate();}};
}
