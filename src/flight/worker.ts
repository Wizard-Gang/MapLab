import {createFlightEndpoint,type FlightRequest} from './protocol';
const endpoint=createFlightEndpoint(reply=>postMessage(reply));
self.onmessage=(event:MessageEvent<FlightRequest>)=>{void endpoint(event.data);};
