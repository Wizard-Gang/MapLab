import {GrappleSession,type GrappleReply} from './protocol';
export function createGrappleWorker(){const worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'}),session=new GrappleSession(r=>worker.postMessage(r));worker.addEventListener('message',(e:MessageEvent<GrappleReply>)=>session.accept(e.data));return {session,dispose(){session.dispose();worker.terminate();}};}
