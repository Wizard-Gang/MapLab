import { compare, integer, mul, type Point } from './integer';
import type { ContactMap, Face, World } from './types';
import type { MovementDocument } from '../contracts/movement-types';
import { validateMapGeometry } from '../contracts/geometry';
import { validateMovement } from '../contracts/movement';
import type { JsonValue } from '../contracts/json';

const point = (p:Point, offset:Point=[0,0]):Point => [integer((p[0]+offset[0])*256),integer((p[1]+offset[1])*256)];
export const faceOrder = (a:Face,b:Face):number => compare(a.bodyId,b.bodyId) || compare(a.shapeId,b.shapeId) || a.edgeIndex-b.edgeIndex || compare(a.supportId??'',b.supportId??'');
/** Input geometry must first pass the normal map loader. No source mutation or runtime overlays. */
export function createWorld(source:ContactMap, profile:MovementDocument):World {
  const p = structuredClone(profile);
  const validated=validateMapGeometry(source as unknown as JsonValue);
  if(!validated.ok)throw new Error('invalidGeometry: '+validated.diagnostics.map(d=>d.code).join(','));
  const map=validated.document;
  if (!validateMovement(p as unknown as JsonValue).ok) throw new Error('invalidProfile');
  if (p.controller.key!=='maplab.reference-controller' || p.controller.version!==1 || p.collider.kind!=='rect' || p.support!=='fullFootprint' || map.collisionContract.key!=='maplab.collision' || map.collisionContract.version!==1) throw new Error('unsupported');
  const compatible=(v:{category:string;mask:readonly string[]}):boolean=>p.mask.includes(v.category)&&v.mask.includes(p.category);
  const bodies=map.bodies.filter(b=>b.enabled&&compatible(b));
  if(bodies.some(b=>b.mobility!=='static'||b.motion!==null)) throw new Error('unsupported: moving bodies');
  const faces:Face[]=[],solids:Point[][]=[];
  const walkable=(a:Point,b:Point):boolean=>b[0]>a[0]&&mul(Math.abs(b[1]-a[1]),p.ground.maxSlope.run)<=mul(b[0]-a[0],p.ground.maxSlope.rise);
  for(const body of bodies) for(const shape of body.shapes) {
    const ps:readonly Point[]=shape.kind==='segment'?[shape.a,shape.b]:shape.kind==='polygon'?shape.points:(()=>{const [x,y,w,h]=shape.rect;return [[x,y],[x+w,y],[x+w,y+h],[x,y+h]] as Point[];})();
    const points=ps.map(v=>point(v,body.position));
    if(shape.kind!=='segment') solids.push(points);
    const count=shape.kind==='segment'?1:points.length;
    for(let i=0;i<count;i++) {
      const a=points[i]!,b=points[(i+1)%points.length]!,normal:Point=[b[1]-a[1],a[0]-b[0]];
      const f=map.footholds.find(f=>f.enabled&&compatible(f)&&f.mode==='solid'&&f.solidEdge?.bodyId===body.id&&f.solidEdge.shapeId===shape.id&&f.solidEdge.edgeIndex===i);
      const support=shape.kind!=='segment'&&walkable(a,b);
      faces.push({bodyId:body.id,shapeId:shape.id,edgeIndex:i,a,b,normal,twoSided:shape.kind==='segment',support,supportId:support?(f?.id??`unregistered:${body.id}/${shape.id}/${i}`):null,registered:!!f,materialId:f?.materialId??body.materialId,planeId:f?.planeId??null,links:f?[...f.connections.a,...f.connections.b].map(l=>l.footholdId):[]});
    }
  }
  for(const f of map.footholds.filter(f=>f.enabled&&compatible(f)&&f.mode==='oneWay')) {
    const owner=f.ownerBodyId?map.bodies.find(b=>b.id===f.ownerBodyId):null;
    if(owner&&!owner.enabled)continue;
    if(owner&&(owner.mobility!=='static'||owner.motion))throw new Error('unsupported: moving support');
    const a=point(f.a,owner?.position),b=point(f.b,owner?.position);
    if(!walkable(a,b))continue; // RC3: steep one-way surfaces are ignored.
    faces.push({bodyId:'',shapeId:'',edgeIndex:0,a,b,normal:[b[1]-a[1],a[0]-b[0]],twoSided:false,support:true,supportId:f.id,registered:true,materialId:f.materialId,planeId:f.planeId,links:[...f.connections.a,...f.connections.b].map(l=>l.footholdId)});
  }
  faces.sort(faceOrder);
  const half=integer(p.collider.width*128),height=integer(p.collider.height*256);
  return {source:map,profile:p,faces,solids,half,height,defaultPlane:map.layers.find(l=>l.kind==='actors')?.id??null};
}
