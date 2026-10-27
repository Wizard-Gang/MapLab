import {createActionEndpoint,type ActionRequest} from './protocol';
const endpoint=createActionEndpoint(r=>postMessage(r));
addEventListener('message',(e:MessageEvent<ActionRequest>)=>{void endpoint(e.data);});
