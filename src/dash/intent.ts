// Separate dash intent module: existing non-dash solver bytes and identities stay stable.
import {groundIntentSupported as baseSupported,groundMotionAllowed as baseAllowed} from '../navigation/intent';
import {hasDash} from './runtime';
import type {MapDocument,MovementDocument} from '../contracts';
import type {State} from '../physics-reference';
export function groundIntentSupported(map:MapDocument,p:MovementDocument):boolean {
 if(!hasDash(p))return baseSupported(map,p);
 return baseSupported({...map,navigation:{...map.navigation,overrides:map.navigation.overrides.map(o=>({...o,actions:o.actions.map(a=>a==='dash'?'jump':a)}))}},p);
}
export function groundMotionAllowed(map:MapDocument,p:MovementDocument,kind:string,from:State,to:State):boolean {
 if(!hasDash(p))return baseAllowed(map,p,kind,from,to);
 if(!groundIntentSupported(map,p))return false;
 const overrides=kind==='dash'?map.navigation.overrides.filter(o=>o.actions.includes('dash')).map(o=>({...o,actions:['jump']})):map.navigation.overrides.map(o=>({...o,actions:o.actions.filter(a=>a!=='dash')})).filter(o=>o.actions.length>0);
 return baseAllowed({...map,navigation:{...map.navigation,overrides}},p,kind==='dash'?'jump':kind,from,to);
}
