// Separate reference-flight motor. Ground step/surface graphs never participate.
import type {MapDocument,MovementDocument,JsonValue} from '../contracts';
import {validateDocumentSchema,validateMovement} from '../contracts';
import {createWorld,overlaps,type World,type State as ContactState} from '../physics-reference';
import {sweep} from '../physics-reference/controller';
export interface FlightState {readonly x:number;readonly y:number;readonly vx:number;readonly vy:number;readonly tick:number;readonly mode:'fly'}
export interface FlightInput {readonly targetVx:number;readonly targetVy:number}
export interface FlightFrame {readonly status:'ok'|'blocked'|'unsupported';readonly state:FlightState;readonly reason:string}
export type Rect=readonly [number,number,number,number];
export const own=<T>(v:T):T=>{const out=structuredClone(v);const freeze=(x:unknown):void=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}};freeze(out);return out;};
/** Exact rectangle-union coverage by vertical strips; corners alone cannot prove union containment. */
export function covered(rect:Rect,union:readonly Rect[]):boolean {
 const [x,y,w,h]=rect,x2=x+w,y2=y+h;if(w<=0||h<=0)return false;
 const xs=[x,x2,...union.flatMap(r=>[Math.max(x,r[0]),Math.min(x2,r[0]+r[2])]).filter(v=>v>x&&v<x2)].sort((a,b)=>a-b);
 for(let i=1;i<xs.length;i++){const a=xs[i-1]!,b=xs[i]!;if(a===b)continue;const ys=union.filter(r=>r[0]<=a&&r[0]+r[2]>=b).map(r=>[r[1],r[1]+r[3]] as const).sort((a,b)=>a[0]-b[0]);let end=y;
  for(const [lo,hi] of ys){if(lo>end)break;if(hi>end)end=hi;if(end>=y2)break;}if(end<y2)return false;
 }return true;
}
export class FlightWorld {
 readonly source:MapDocument;readonly profile:MovementDocument;readonly world:World;readonly volumes:readonly Rect[];readonly bound:Rect;
 readonly speed:number;readonly acceleration:number;readonly turnAcceleration:number;
 constructor(source:MapDocument,profile:MovementDocument){
  if(validateDocumentSchema(source as unknown as JsonValue).some(d=>d.severity==='error')||!validateMovement(profile as unknown as JsonValue).ok)throw Error('Invalid flight source/profile');
  const ability=profile.abilities.find(a=>a.kind==='fly');if(!ability||profile.abilities.length!==1||ability.version!==1||!ability.hover||profile.collider.kind!=='rect')throw Error('Unsupported flight capability: rectangular hover/fly only; no mode transitions');
  if(![ability.speed,ability.acceleration,ability.turnAcceleration].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=8192))throw Error('Unsupported flight motor coefficient budget');
  if(source.bodies.reduce((n,b)=>n+b.shapes.length,0)>128||source.bodies.reduce((n,b)=>n+b.shapes.reduce((n,s)=>n+(s.kind==='polygon'?s.points.length:4),0),0)>1024||source.navigation.modeVolumes.length>64||source.footholds.length>256)throw Error('Flight geometry budget');
  if(source.environment.zones.some(z=>z.kind==='movementModifier'||z.kind==='launch')||source.navigation.links.length||source.navigation.overrides.some(o=>o.profileIds.includes(profile.id)))throw Error('Unsupported flight modifier/link/override intent');
  this.source=own(source);this.profile=own(profile);const physical=createWorld(this.source as never,this.profile);
  // No one-way traversal/mode solver: retain every matching authored support as a conservative two-sided barrier.
  const supports=this.source.footholds.filter(f=>f.enabled&&f.mode==='oneWay'&&profile.mask.includes(f.category)&&f.mask.includes(profile.category)).flatMap(f=>{
   const owner=f.ownerBodyId?this.source.bodies.find(b=>b.id===f.ownerBodyId):null;if(owner&&!owner.enabled)return [];
   const point=(p:readonly [number,number])=>[(p[0]+(owner?.position[0]??0))*256,(p[1]+(owner?.position[1]??0))*256] as const,a=point(f.a),b=point(f.b);
   return [{bodyId:'flight-support:'+f.id,shapeId:f.id,edgeIndex:0,a,b,normal:[b[1]-a[1],a[0]-b[0]] as const,twoSided:true,support:false,supportId:f.id,registered:true,materialId:f.materialId,planeId:f.planeId,links:[]}];
  });this.world={...physical,faces:[...physical.faces.filter(f=>f.bodyId!==''),...supports]};this.speed=ability.speed;this.acceleration=ability.acceleration;this.turnAcceleration=ability.turnAcceleration;
  this.bound=source.bounds.map(v=>v*256) as unknown as Rect;
  const bindings=source.navigation.modeVolumes.filter(v=>v.mode==='fly'&&v.profileIds.includes(profile.id));
  this.volumes=own(bindings.length?bindings.map(v=>{const r=source.regions.find(r=>r.id===v.regionId);if(!r||r.shape.kind!=='rect')throw Error('Unsupported flight volume: matching rectangles required');return r.shape.rect.map(v=>v*256) as unknown as Rect;}):[this.bound]);
 }
 footprint(x:number,y:number):Rect{return [x-this.world.half,y-this.world.height,this.world.half*2,this.world.height];}
 valid(s:FlightState):boolean {return s.mode==='fly'&&[s.x,s.y,s.vx,s.vy,s.tick].every(Number.isSafeInteger)&&s.tick>=0&&Math.abs(s.x)<=131072*256&&Math.abs(s.y)<=131072*256&&Math.abs(s.vx)+Math.abs(s.vy)<=this.speed;}
 safe(x:number,y:number):boolean {const r=this.footprint(x,y);return covered(r,[this.bound])&&covered(r,this.volumes)&&!overlaps(this.world,x,y);}
 /** Integer L1 speed and delta budgets are conservative Euclidean bounds. X/Y remainder order is explicit. */
 velocity(s:FlightState,input:FlightInput):readonly [number,number]{
  if(![input.targetVx,input.targetVy].every(Number.isSafeInteger)||Math.abs(input.targetVx)+Math.abs(input.targetVy)>this.speed)throw Error('Invalid flight input');
  const target=[input.targetVx,input.targetVy],old=[s.vx,s.vy],dx=target[0]!-s.vx,dy=target[1]!-s.vy,total=Math.abs(dx)+Math.abs(dy);if(!total)return [s.vx,s.vy];
  const turn=(s.vx!==0||s.vy!==0)&&(s.vx*target[1]!-s.vy*target[0]! !==0||s.vx*target[0]!+s.vy*target[1]!<0),limit=Math.min(total,this.acceleration,turn?this.turnAcceleration:this.acceleration);
  const delta=[Math.trunc(dx*limit/total),Math.trunc(dy*limit/total)],next=[s.vx+delta[0]!,s.vy+delta[1]!];
  if(!delta[0]&&!delta[1]){const axes=[0,1].sort((a,b)=>Number(Math.abs(target[a]!)>=Math.abs(old[a]!))-Number(Math.abs(target[b]!)>=Math.abs(old[b]!))||a-b);for(const i of axes){const sign=Math.sign(target[i]!-old[i]!);if(!sign)continue;const test=[...next];test[i]=test[i]!+sign;if(Math.abs(test[0]!)+Math.abs(test[1]!)<=this.speed){next[i]=test[i]!;break;}}}
  let excess=Math.abs(next[0]!)+Math.abs(next[1]!)-this.speed;
  for(const i of [0,1])if(excess>0&&Math.abs(next[i]!)>Math.abs(old[i]!)){const n=Math.min(excess,Math.abs(next[i]!)-Math.abs(old[i]!));next[i]=next[i]!-Math.sign(next[i]!)*n;excess-=n;}
  return [next[0]!,next[1]!];
 }
 step(state:FlightState,input:FlightInput):FlightFrame {
  const old=own(state),fail=(status:FlightFrame['status'],reason:string):FlightFrame=>own({status,state:old,reason});
  try{
   if(!this.valid(old)||!this.safe(old.x,old.y))return fail('unsupported','Invalid/outside/overlapping initial flight body');
   const [vx,vy]=this.velocity(old,input);let x=old.x,y=old.y;
   for(const [axis,delta] of [[0,vx],[1,vy]] as const){if(!delta)continue;
    const contact={x,y,vx,vy,mode:'air',supportId:null,planeId:null,facing:1,tick:old.tick} as ContactState;
    if(sweep(this.world,contact,axis,delta,true).some(h=>axis===0?h.coordinate!==x+delta:h.coordinate!==y+delta))return fail('blocked','Full-body obstacle sweep');
    const nx=axis===0?x+delta:x,ny=axis===1?y+delta:y,r=this.footprint(Math.min(x,nx),Math.min(y,ny)),swept=[r[0],r[1],r[2]+Math.abs(nx-x),r[3]+Math.abs(ny-y)] as const;
    if(!covered(swept,[this.bound])||!covered(swept,this.volumes)||overlaps(this.world,nx,ny))return fail('blocked','Full swept body leaves bounds/volume union or overlaps solid');x=nx;y=ny;
   }
   const next={x,y,vx,vy,tick:old.tick+1,mode:'fly' as const};if(!this.valid(next))return fail('unsupported','Unsafe flight integer state');return own({status:'ok',state:next,reason:''});
  }catch(e){return fail('unsupported',String(e));}
 }
}
