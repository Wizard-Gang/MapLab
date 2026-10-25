// Ephemeral engine-state preview. Authored maps, static witnesses and history are never mutated.
import type {MapDocument} from '../contracts/document-types';
import type {MovementDocument} from '../contracts/movement-types';
import type {CollisionBody} from '../contracts/geometry-types';
import {digest} from '../physics-reference';
import {airborneIdentity,buildAirborneActions,AIR_DEFAULTS,type AirResult,type AirSettings,type Witness} from './airborne';
export type Bounds=readonly[number,number,number,number]; // closed min/max in integer su
export interface Blocker {readonly id:string;readonly boundsSu:Bounds}
export const BLOCKER_LIMITS=Object.freeze({count:128,coordinateSu:256_000_000,regions:1024});
export const intersects=(a:Bounds,b:Bounds):boolean=>a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];
const union=(a:Bounds,b:Bounds):Bounds=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])];
const mapBounds=(m:MapDocument):Bounds=>[m.bounds[0]*256,m.bounds[1]*256,(m.bounds[0]+m.bounds[2])*256,(m.bounds[1]+m.bounds[3])*256];
export function blockers(value:readonly Blocker[]):readonly Blocker[]{
 if(!Array.isArray(value)||value.length>BLOCKER_LIMITS.count)throw Error('Runtime blocker count limit');const ids=new Set<string>();
 for(const b of value){if(!b||Object.keys(b).sort().join(',')!=='boundsSu,id'||typeof b.id!=='string'||!/^runtime\.[A-Za-z0-9_-]{1,48}$/.test(b.id)||ids.has(b.id))throw Error('Invalid runtime blocker identity');ids.add(b.id);
 const a=b.boundsSu;if(!Array.isArray(a)||a.length!==4||a.some(n=>!Number.isSafeInteger(n)||Math.abs(n)>BLOCKER_LIMITS.coordinateSu)||a[0]!>=a[2]!||a[1]!>=a[3]!)throw Error('Invalid runtime blocker bounds');}
 return structuredClone([...value].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0));
}
export function dirtyBounds(before:readonly Blocker[],after:readonly Blocker[]):Bounds|null{
 let dirty:Bounds|null=null;for(const b of [...before,...after]){const peer=(before.includes(b)?after:before).find(p=>p.id===b.id);if(!peer||JSON.stringify(peer.boundsSu)!==JSON.stringify(b.boundsSu))dirty=dirty?union(dirty,b.boundsSu):b.boundsSu;}return dirty;
}
/** Physical regions are independent of render chunks. Huge extents collapse to a conservative global region. */
export function regionKeys(b:Bounds):readonly string[]{
 const size=64*256,x0=Math.floor(b[0]/size),x1=Math.floor(b[2]/size),y0=Math.floor(b[1]/size),y1=Math.floor(b[3]/size);
 if((x1-x0+1)*(y1-y0+1)>BLOCKER_LIMITS.regions)return ['*'];const keys:string[]=[];for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)keys.push(`${x},${y}`);return keys;
}
/** Sorted physical broadphase; empty space in every swept body volume is indexed too. */
export class WitnessIndex {
 private readonly entries:readonly Witness[];
 constructor(edges:readonly Witness[]){this.entries=[...edges].sort((a,b)=>a.dependencies.sweptBoundsSu[0]-b.dependencies.sweptBoundsSu[0]||a.key.localeCompare(b.key));}
 query(bounds:Bounds):readonly string[]{const found:string[]=[];for(const e of this.entries){if(e.dependencies.sweptBoundsSu[0]>bounds[2])break;if(intersects(bounds,e.dependencies.sweptBoundsSu))found.push(e.key);}return found.sort();}
}
export function overlayMap(source:MapDocument,p:MovementDocument,value:readonly Blocker[]):MapDocument {
 const bs=blockers(value),map=structuredClone(source);if(!bs.length)return map;
 if(!map.materials[0]||!p.mask[0])throw Error('Runtime blockers require a supported collision material/category');
 const bodies:CollisionBody[]=bs.map(b=>({id:b.id,name:'Runtime blocker',position:[0,0],enabled:true,mobility:'static',category:p.mask[0]!,mask:[p.category],materialId:map.materials[0]!.id,motion:null,shapes:[{id:b.id+'.shape',kind:'rect',rect:[b.boundsSu[0]/256,b.boundsSu[1]/256,(b.boundsSu[2]-b.boundsSu[0])/256,(b.boundsSu[3]-b.boundsSu[1])/256]}]}));
 if(bodies.some(b=>map.bodies.some(s=>s.id===b.id)||map.bodies.some(s=>s.shapes.some(t=>t.id===b.shapes[0]!.id))))throw Error('Runtime blocker ID collides with source');
 return {...map,bodies:[...map.bodies,...bodies]};
}
/** The generator's horizontal displacement envelope, plus collider and critical-X lattice expansion.
 * Full map height is retained: no unsupported vertical reach assumption or moving-platform rendezvous. */
export function capabilityRegion(m:MapDocument,p:MovementDocument,s:AirSettings,dirty:Bounds):Bounds {
 const speed=BigInt(Math.max(p.ground.walkSpeed,p.ground.runSpeed,p.air.maxSpeed)),scaled=[p.ground.uphill,p.ground.downhill].map(r=>(speed*BigInt(r.num)+BigInt(r.den)-1n)/BigInt(r.den));
 const fastest=[speed,...scaled].reduce((a,b)=>a>b?a:b)+BigInt(Math.max(0,...m.materials.map(m=>Math.abs(m.conveyorSu))));
 const width=p.collider.kind==='rect'?p.collider.width*256:BLOCKER_LIMITS.coordinateSu;
 const reach=Number(fastest*BigInt(s.maxTicks))+s.spacingSu+width;
 if(!Number.isSafeInteger(reach))throw Error('Runtime capability envelope overflow');const b=mapBounds(m);return [dirty[0]-reach,b[1],dirty[2]+reach,b[3]];
}
export interface BlockerReport {
 readonly format:'maplab.runtime-blocker-preview';readonly version:1;readonly revision:number;readonly sourceKey:string;
 readonly blockers:readonly Blocker[];readonly result:AirResult;readonly dirtyBoundsSu:Bounds|null;readonly regenerationBoundsSu:Bounds|null;
 readonly regionRevisions:Readonly<Record<string,number>>;readonly disabledKeys:readonly string[];
 readonly reusedEdges:number;readonly regeneratedSamples:number;readonly cacheWarm:boolean;readonly assumptions:readonly string[];
}
export async function regenerate(map:MapDocument,p:MovementDocument,revision:number,value:readonly Blocker[],settings:AirSettings=AIR_DEFAULTS,previous:BlockerReport|null=null,cancelled:()=>boolean=()=>false,yieldTask:()=>Promise<void>=()=>new Promise(r=>setTimeout(r,0))):Promise<BlockerReport>{
 if(!Number.isSafeInteger(revision)||revision<0)throw Error('Invalid runtime revision');const bs=blockers(value),source=structuredClone(map),profile=structuredClone(p),options={...settings};
 const base=await airborneIdentity(source,profile,options),compatible=previous?.sourceKey===base.cacheKey;
 const usable=compatible&&['candidate','no route found within declared search/sampling budget'].includes(previous!.result.status);
 const dirty=usable?dirtyBounds(previous!.blockers,bs):mapBounds(source),warm=!!compatible&&!dirty&&['candidate','no route found within declared search/sampling budget'].includes(previous!.result.status);
 const revisions={...(compatible?previous!.regionRevisions:{})};if(dirty)for(const key of regionKeys(dirty))revisions[key]=revision;
 const assumptions=['Temporary blocker snapshot only; engine AI and future door/platform state are unsupported.','Regional single-action candidates retain exact launch preconditions; no complete route or engine-parity claim.','Surface clearance is rebuilt conservatively; only affected airborne launch candidates are regenerated.'];
 const disabledKeys=previous&&dirty?new WitnessIndex(previous.result.edges).query(dirty):[];
 if(warm&&!cancelled())return {...structuredClone(previous!),revision,result:{...structuredClone(previous!.result),revision},dirtyBoundsSu:null,regenerationBoundsSu:null,disabledKeys:[],cacheWarm:true,reusedEdges:previous!.result.edges.length,regeneratedSamples:0};
 const overlaid=overlayMap(source,profile,bs),region=usable&&dirty?capabilityRegion(source,profile,options,dirty):null;
 const partial=await buildAirborneActions(overlaid,profile,revision,options,cancelled,yieldTask,region??undefined);
 const retained:Witness[]=[];
 if(compatible&&region&&['candidate','no route found within declared search/sampling budget'].includes(previous!.result.status)&&['candidate','no route found within declared search/sampling budget'].includes(partial.status)){
  const intervals=new Set(partial.intervals.map(i=>i.key));
  for(const [index,edge] of previous!.result.edges.entries()){if(index%64===0)await yieldTask();if(edge.initial.x>=region[0]&&edge.initial.x<=region[2]||disabledKeys.includes(edge.key)||!intervals.has(edge.fromInterval)||!intervals.has(edge.toInterval))continue;
   if(cancelled())break;const identity=partial.identity,sweptBoundsSu=edge.dependencies.sweptBoundsSu;
   retained.push({...edge,dependencies:{identity,sweptBoundsSu,sha256:await digest({identity,sweptBoundsSu,initial:edge.initial,input:edge.input,frames:edge.frames})}});
  }
 }
 const edges=[...retained,...partial.edges].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 const result=cancelled()?{...partial,status:'cancelled' as const,edges:[],intervals:[]}:retained.length?{...partial,status:'candidate' as const,edges}:partial;
 return {format:'maplab.runtime-blocker-preview',version:1,revision,sourceKey:base.cacheKey,blockers:bs,result,dirtyBoundsSu:dirty,regenerationBoundsSu:region,regionRevisions:revisions,disabledKeys,reusedEdges:retained.length,regeneratedSamples:partial.samples,cacheWarm:false,assumptions};
}
