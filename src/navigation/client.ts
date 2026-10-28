import { GraphSession, type Reply } from './protocol';
import type { Identity } from './surface';
/** Hard cancellation stops preprocessing as well as cooperative replay. A later request starts a fresh realm. */
export function createNavigationWorker(makeWorker=()=>new Worker(new URL('./worker.ts',import.meta.url),{type:'module'})){
 let worker:Worker|null=null,serial=0;
 const pending=new Map<number,(identity:Identity|null)=>void>();
 const cancel=()=>{const old=worker;worker=null;old?.terminate();for(const resolve of pending.values())resolve(null);pending.clear();};
 const ensure=()=>{
  if(worker)return worker;
  const owner=makeWorker();worker=owner;
  owner.onmessage=(event:MessageEvent<Reply|{kind:'identified';job:number;identity:Identity|null}>)=>{
   if(worker!==owner)return;
   if(event.data.kind==='identified'){const reply=event.data;pending.get(reply.job)?.(reply.identity);pending.delete(reply.job);}
   else session.accept(event.data);
  };
  owner.onerror=()=>{if(worker===owner)session.invalidate();};return owner;
 };
 const session=new GraphSession(message=>{if(message.kind==='cancel')cancel();else ensure().postMessage(message);},
  (map,profile,settings)=>new Promise(resolve=>{const job=++serial;pending.set(job,resolve);ensure().postMessage({kind:'identify',job,map,profile,settings});}),cancel);
 return {session,dispose:()=>{session.dispose();cancel();}};
}
