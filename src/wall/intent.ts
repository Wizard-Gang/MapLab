import {groundIntentSupported as baseSupported,groundMotionAllowed as baseAllowed} from '../dash/intent';
import {hasWall,type WallAction,type WallState} from './runtime';
import type {MapDocument,MovementDocument} from '../contracts';
import type {State} from '../physics-reference';
const isWall=(a:string)=>['wallSlide','wallJump','wallClimb'].includes(a);
export function groundIntentSupported(map:MapDocument,p:MovementDocument):boolean {
 if(!hasWall(p))return baseSupported(map,p);
 return baseSupported({...map,navigation:{...map.navigation,overrides:map.navigation.overrides.map(o=>({...o,actions:o.actions.map(a=>isWall(a)?'jump':a)}))}},p);
}
export function groundMotionAllowed(map:MapDocument,p:MovementDocument,kind:string,from:State,to:State):boolean {
 if(!hasWall(p))return baseAllowed(map,p,kind,from,to);
 if(!groundIntentSupported(map,p))return false;
 const overrides=isWall(kind)?map.navigation.overrides.filter(o=>o.actions.includes(kind)).map(o=>({...o,actions:['jump']})):map.navigation.overrides.map(o=>({...o,actions:o.actions.filter(a=>!isWall(a))})).filter(o=>o.actions.length>0);
 return baseAllowed({...map,navigation:{...map.navigation,overrides}},p,isWall(kind)?'jump':kind,from,to);
}
/** A wall launch's restrictions remain applicable throughout its resulting arc. */
export function wallMotionAllowed(map:MapDocument,p:MovementDocument,from:State,to:State,used:Set<WallAction>):boolean {
 if((from as WallState).wall?.launched||(to as WallState).wall?.launched)used.add('wallJump');
 const a=(to as WallState).wall?.action;if(a)used.add(a);
 return [...used].every(a=>groundMotionAllowed(map,p,a,from,to));
}
