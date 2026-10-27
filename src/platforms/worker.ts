import {createTimedEndpoint,type TimedRequest} from './protocol';
const endpoint=createTimedEndpoint(r=>postMessage(r));
addEventListener('message',(e:MessageEvent<TimedRequest>)=>{void endpoint(e.data);});
