import { createGraphWorker, type Request } from './protocol';
import { identity, type Settings } from './surface';
import type { MapDocument } from '../contracts/document-types';
import type { MovementDocument } from '../contracts/movement-types';
const endpoint=createGraphWorker(reply=>globalThis.postMessage(reply));
type Identify={kind:'identify';job:number;map:MapDocument;profile:MovementDocument;settings:Settings};
globalThis.onmessage=(event:MessageEvent<Request|Identify>)=>{
 const request=event.data;
 if(request.kind==='identify'){
  void identity(request.map,request.profile,request.settings).then(value=>postMessage({kind:'identified',job:request.job,identity:value}),()=>postMessage({kind:'identified',job:request.job,identity:null}));
 }else void endpoint(request);
};
