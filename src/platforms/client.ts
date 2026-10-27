import {TimedSession,type TimedReply} from './protocol';
export function createTimedWorker(){const worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'}),session=new TimedSession(r=>worker.postMessage(r));worker.addEventListener('message',(e:MessageEvent<TimedReply>)=>session.accept(e.data));return {session,dispose(){session.dispose();worker.terminate();}};}
