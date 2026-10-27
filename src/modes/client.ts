import {ModeSession,type ModeReply} from './protocol';
export function createModeWorker(){const worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'}),session=new ModeSession(r=>worker.postMessage(r));worker.addEventListener('message',(e:MessageEvent<ModeReply>)=>session.accept(e.data));return {session,dispose(){session.dispose();worker.terminate();}};}
