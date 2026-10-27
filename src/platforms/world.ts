import {createWorld,type ContactMap,type World} from '../physics-reference';
import type {MovementDocument} from '../contracts/movement-types';
import {validateMapGeometry} from '../contracts/geometry';
import type {JsonValue} from '../contracts/json';
import {integer,type Point} from '../physics-reference/integer';
import {motionOffset,type Pair} from './motion';
export const PLATFORM_LIMITS=Object.freeze({bodies:16,faces:4096});
const cache=new WeakMap<ContactMap,WeakMap<MovementDocument,World>>();
function basis(source:ContactMap,p:MovementDocument):World{
 let profiles=cache.get(source);if(!profiles){profiles=new WeakMap();cache.set(source,profiles);}const cached=profiles.get(p);if(cached)return cached;
 const checked=validateMapGeometry(source as unknown as JsonValue);if(!checked.ok)throw Error('Invalid moving-platform geometry: '+checked.diagnostics.map(d=>d.code).join(','));
 if(source.bodies.filter(b=>b.mobility==='kinematic').length>PLATFORM_LIMITS.bodies)throw Error('Platform body budget');
 if(source.bodies.some(b=>b.enabled&&b.mobility==='kinematic'&&!b.motion))throw Error('Kinematic platform requires motion');
 const world=createWorld({...source,bodies:source.bodies.map(b=>({...b,mobility:'static',motion:null}))},p);
 if(world.faces.length>PLATFORM_LIMITS.faces)throw Error('Platform face budget');profiles.set(p,world);return world;
}
/** Ephemeral collision snapshot. Static navigation never receives this adapter. */
export function platformWorld(source:ContactMap,p:MovementDocument,tick:number,overrides:ReadonlyMap<string,Pair>=new Map(),omit:ReadonlySet<string>=new Set()):World&{readonly dynamicSnapshot:true}{
 const base=basis(source,p),offsets=new Map(source.bodies.map(b=>[b.id,overrides.get(b.id)??(b.motion?motionOffset(b.motion,tick):[0,0] as Pair)]));
 const owner=(supportId:string|null)=>source.footholds.find(f=>f.id===supportId)?.ownerBodyId??'';
 const shift=(point:Point,offset:Pair):Point=>[integer(point[0]+offset[0]),integer(point[1]+offset[1])];
 const faces=base.faces.filter(f=>!omit.has(f.bodyId||owner(f.supportId))).map(f=>{
  const delta=offsets.get(f.bodyId||owner(f.supportId))??[0,0];return {...f,a:shift(f.a,delta),b:shift(f.b,delta)};
 });
 let index=0;const solids:Point[][]=[];
 for(const b of source.bodies.filter(b=>b.enabled&&p.mask.includes(b.category)&&b.mask.includes(p.category)))for(const shape of b.shapes){
  if(shape.kind==='segment')continue;const points=base.solids[index++]!;if(!omit.has(b.id))solids.push(points.map(v=>shift(v,offsets.get(b.id)!)));
 }
 const snapshot={...base.source,bodies:base.source.bodies.map(b=>({...b,enabled:b.enabled&&!omit.has(b.id),position:[b.position[0]+offsets.get(b.id)![0]/256,b.position[1]+offsets.get(b.id)![1]/256] as Pair}))};
 return {...base,source:snapshot,faces,solids,dynamicSnapshot:true};
}
