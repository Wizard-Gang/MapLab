// Real module-worker realm around the production graph endpoint.
import { createGraphWorker, type Request } from '../navigation/protocol';
const endpoint=createGraphWorker(reply=>postMessage(reply));
onmessage=(e:MessageEvent<Request>)=>{void endpoint(e.data);};
postMessage({kind:'ready'});
