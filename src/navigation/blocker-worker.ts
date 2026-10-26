import {createBlockerEndpoint,type BlockerRequest} from './blocker-protocol';
const endpoint=createBlockerEndpoint(reply=>globalThis.postMessage(reply));
globalThis.onmessage=(event:MessageEvent<BlockerRequest>)=>{void endpoint(event.data);};
