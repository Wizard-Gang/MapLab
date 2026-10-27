import {createGrappleEndpoint,type GrappleRequest} from './protocol';
const endpoint=createGrappleEndpoint(r=>postMessage(r));
addEventListener('message',(e:MessageEvent<GrappleRequest>)=>{void endpoint(e.data);});
