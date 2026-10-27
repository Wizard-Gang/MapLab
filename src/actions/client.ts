import {ActionSession,type ActionReply} from './protocol';
export function createActionWorker(){const worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'}),session=new ActionSession(r=>worker.postMessage(r));worker.addEventListener('message',(e:MessageEvent<ActionReply>)=>session.accept(e.data));return {session,dispose(){session.dispose();worker.terminate();}};}
