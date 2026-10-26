// Forest integration subset: profile-specific volumes and rectangular airborne forbids.
// Penalties, links, mode transitions and other override actions still require their own solver.
import type {MapDocument,MovementDocument} from '../contracts';
import type {State} from '../physics-reference';
export function groundIntentSupported(map:MapDocument,p:MovementDocument):boolean {
 if(map.navigation.links.length||map.navigation.modeVolumes.some(v=>v.profileIds.includes(p.id))||map.navigation.overrides.length>64)return false;
 return map.navigation.overrides.filter(o=>o.profileIds.includes(p.id)).every(o=>o.policy==='forbid'&&o.penaltyTicks===0&&o.actions.length>0&&o.actions.every(a=>['jump','fall','drop'].includes(a))&&map.regions.find(r=>r.id===o.regionId)?.shape.kind==='rect');
}
/** Each controller tick moves X then Y. Test both full-body axis sweeps, not just feet/endpoints.
 * Open interior overlap forbids an action; contact/tangency with the region boundary is legal. */
export function groundMotionAllowed(map:MapDocument,p:MovementDocument,kind:string,from:State,to:State):boolean {
 const action=kind==='land'?'fall':kind;
 const relevant=map.navigation.overrides.filter(o=>o.profileIds.includes(p.id)&&o.actions.includes(action));
 if(!relevant.length)return true;if(!groundIntentSupported(map,p)||p.collider.kind!=='rect')return false;
 const half=p.collider.width*128,height=p.collider.height*256;
 const intersects=(x0:number,y0:number,x1:number,y1:number,r:readonly number[])=>Math.max(x0,x1)+half>r[0]!*256&&Math.min(x0,x1)-half<(r[0]!+r[2]!)*256&&Math.max(y0,y1)>r[1]!*256&&Math.min(y0,y1)-height<(r[1]!+r[3]!)*256;
 return relevant.every(o=>{const region=map.regions.find(r=>r.id===o.regionId)!;if(region.shape.kind!=='rect')return false;return !intersects(from.x,from.y,to.x,from.y,region.shape.rect)&&!intersects(to.x,from.y,to.x,to.y,region.shape.rect);});
}
