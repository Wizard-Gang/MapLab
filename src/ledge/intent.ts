import {groundIntentSupported as baseSupported,groundMotionAllowed as baseAllowed,wallMotionAllowed} from '../wall/intent';
import {hasLedge,type LedgeState} from './runtime';
import type {MapDocument,MovementDocument} from '../contracts';
import type {State} from '../physics-reference';
export {wallMotionAllowed};
const ledge=(a:string)=>a==='ledge'||a==='ledgeGrab'||a==='ledgeClimb';
export function groundIntentSupported(map:MapDocument,p:MovementDocument):boolean {
 if(!hasLedge(p))return baseSupported(map,p);
 return baseSupported({...map,navigation:{...map.navigation,overrides:map.navigation.overrides.map(o=>({...o,actions:o.actions.map(a=>ledge(a)?'jump':a)}))}},p);
}
export function groundMotionAllowed(map:MapDocument,p:MovementDocument,kind:string,from:State,to:State):boolean {
 if(!hasLedge(p))return baseAllowed(map,p,kind,from,to);
 if(!groundIntentSupported(map,p))return false;
 const overrides=ledge(kind)?map.navigation.overrides.filter(o=>o.actions.some(ledge)).map(o=>({...o,actions:['jump']})):map.navigation.overrides.map(o=>({...o,actions:o.actions.filter(a=>!ledge(a))})).filter(o=>o.actions.length);
 return baseAllowed({...map,navigation:{...map.navigation,overrides}},p,ledge(kind)?'jump':kind,from,to);
}
// Check actual state transitions, including a forged split labelled as fall/align.
export function ledgeMotionAllowed(map:MapDocument,p:MovementDocument,from:State,to:State):boolean {
 return !(from as LedgeState).ledge?.attachment&&!(to as LedgeState).ledge?.action||groundMotionAllowed(map,p,'ledge',from,to);
}
