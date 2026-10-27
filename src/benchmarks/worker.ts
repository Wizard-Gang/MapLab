// Real module-worker event-loop probe around the production graph endpoint.
import { createGraphWorker, type Request } from '../navigation/protocol';
const endpoint=createGraphWorker(reply=>postMessage(reply));
onmessage=(e:MessageEvent<Request|{kind:'ping';id:number}>)=>{
  if(e.data.kind==='ping'){postMessage({kind:'pong',id:e.data.id});return;}
  void endpoint(e.data);
};
postMessage({kind:'ready'});
