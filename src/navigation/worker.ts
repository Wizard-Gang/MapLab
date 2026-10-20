import { createGraphWorker, type Request } from './protocol';
const endpoint=createGraphWorker(reply=>globalThis.postMessage(reply));
globalThis.onmessage=(event:MessageEvent<Request>)=>{void endpoint(event.data);};
