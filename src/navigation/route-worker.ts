import { createRoutingEndpoint, type RoutingRequest } from './routing-protocol';
const endpoint=createRoutingEndpoint(reply=>postMessage(reply));
self.onmessage=(event:MessageEvent<RoutingRequest>)=>{void endpoint(event.data);};
