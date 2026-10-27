import {createModeEndpoint,type ModeRequest} from './protocol';
const endpoint=createModeEndpoint(reply=>postMessage(reply));
addEventListener('message',(e:MessageEvent<ModeRequest>)=>{void endpoint(e.data);});
