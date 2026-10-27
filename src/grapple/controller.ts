import type {MapDocument,MovementDocument,JsonValue} from '../contracts';
import {validateDocumentSchema} from '../contracts';
import {createWorld,overlaps,type State as ContactState} from '../physics-reference';
import {sweep} from '../physics-reference/controller';
import {own,covered,type Rect} from '../flight/controller';
import {onSegment,ropeClear,rootCeil,squared,type Point} from './geometry';
export const GRAPPLE_SOLVER={key:'maplab.reference-grapple',version:1} as const;
type Ability=Extract<MovementDocument['abilities'][number],{kind:'grapple'}>;
export interface Attachment {readonly anchorId:string;readonly pointIndex:number;readonly length:number}
export interface GrappleState {readonly x:number;readonly y:number;readonly vx:number;readonly vy:number;readonly tick:number;readonly attachment:Attachment|null}
export interface GrappleInput {readonly action:'coast'|'attach'|'release';readonly anchorId:string|null;readonly pointIndex:number;readonly moveX:-1|0|1;readonly reel:-1|0|1}
export interface GrappleContact {readonly bodyId:string;readonly shapeId:string;readonly edgeIndex:number;readonly axis:'x'|'y'}
export interface GrappleFrame {readonly status:'ok'|'blocked'|'invalidState'|'unsupported';readonly state:GrappleState;readonly input:GrappleInput;readonly contacts:readonly GrappleContact[];readonly reason:string}
export interface GrappleAnchor {readonly id:string;readonly pointIndex:number;readonly pivot:Point;readonly approach:Rect}
const keys=(v:object)=>Object.keys(v).sort().join(',');
export const coast=(moveX:-1|0|1=0,reel:-1|0|1=0):GrappleInput=>({action:'coast',anchorId:null,pointIndex:0,moveX,reel});
export class GrappleWorld {
 readonly map:MapDocument;readonly profile:MovementDocument;readonly collision:ReturnType<typeof createWorld>;readonly ability:Ability;readonly anchors:readonly GrappleAnchor[];
 constructor(source:MapDocument,profile:MovementDocument){
  if(validateDocumentSchema(source as unknown as JsonValue).some(d=>d.severity==='error'))throw Error('Invalid grapple map');
  this.map=own(source);this.profile=own(profile);this.collision=createWorld(this.map as never,this.profile);
  const a=this.profile.abilities.find((a):a is Ability=>a.kind==='grapple');
  if(!a||this.profile.abilities.length!==1||a.solver.key!==GRAPPLE_SOLVER.key||a.solver.version!==GRAPPLE_SOLVER.version)throw Error('Unsupported grapple solver/capability combination');
  if(profile.collider.kind!=='rect'||profile.grabHeight<0||profile.grabHeight>profile.collider.height||a.lengthRange[0]<=0)throw Error('Unsupported grapple harness or rope minimum');
  if(![a.reelSpeed,profile.air.gravity,profile.air.maxFall,profile.air.acceleration,profile.air.maxSpeed].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=8192)||a.reelSpeed<1||a.swingGravity.num>16||a.swingGravity.den>16||a.swingGravity.num<0||a.swingGravity.den<1)throw Error('Unsupported grapple coefficient budget');
  if(source.bodies.length>128||source.bodies.some(b=>b.mobility!=='static'||b.motion||b.shapes.some(s=>s.kind!=='rect'))||source.bodies.reduce((n,b)=>n+b.shapes.length,0)>128||source.footholds.some(f=>f.enabled&&f.mode==='oneWay')||source.traversals.reduce((n,t)=>n+('points' in t?t.points.length:0),0)>64)throw Error('Unsupported grapple geometry: bounded static rectangles and solid faces only');
  if(source.environment.zones.some(z=>z.kind==='movementModifier'||z.kind==='launch')||source.navigation.links.length||source.navigation.overrides.some(o=>o.profileIds.includes(profile.id))||source.materials.some(m=>m.tags.some(t=>profile.forbiddenMaterialTags.includes(t))))throw Error('Unsupported grapple intent/material policy');
  this.ability=a;const anchors:GrappleAnchor[]=[];
  for(const t of this.map.traversals){if(t.kind!=='grapple')continue;
   const body=this.map.bodies.find(b=>b.id===t.edge.bodyId),face=this.collision.faces.find(f=>f.bodyId===t.edge.bodyId&&f.shapeId===t.edge.shapeId&&f.edgeIndex===t.edge.edgeIndex),region=this.map.regions.find(r=>r.id===t.approachRegionId);
   if(!body?.enabled||!face||t.requiredAbilities.some(tag=>!profile.abilityTags.includes(tag)))continue;
   if(!region||region.shape.kind!=='rect'||!t.points.length)throw Error('Unsupported grapple anchor approach/points');
   const approach=region.shape.rect.map(n=>n*256) as unknown as Rect;
   t.points.forEach((p,pointIndex)=>{const pivot:Point=[(p[0]+body.position[0])*256,(p[1]+body.position[1])*256];if(!onSegment(pivot,face.a,face.b))throw Error('Grapple point is off its physical face');anchors.push({id:t.id,pointIndex,pivot,approach});});
  }
  this.anchors=own(anchors.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:a.pointIndex-b.pointIndex));
 }
 harness(s:Pick<GrappleState,'x'|'y'>):Point{return [s.x,s.y-this.profile.grabHeight*256];}
 anchor(a:Attachment){return this.anchors.find(p=>p.id===a.anchorId&&p.pointIndex===a.pointIndex);}
 safe(x:number,y:number):boolean {const w=this.collision;return covered([x-w.half,y-w.height,w.half*2,w.height],[this.map.bounds.map(n=>n*256) as unknown as Rect])&&!overlaps(w,x,y);}
 valid(s:GrappleState):boolean {
  if(!s||keys(s)!=='attachment,tick,vx,vy,x,y'||![s.x,s.y,s.vx,s.vy,s.tick].every(Number.isSafeInteger)||s.tick<0||s.tick>=Number.MAX_SAFE_INTEGER-1||Math.abs(s.vx)+Math.abs(s.vy)>65536||Math.abs(s.x)>131072*256||Math.abs(s.y)>131072*256||!this.safe(s.x,s.y))return false;
  if(s.attachment===null)return true;const a=s.attachment;
  if(!a||keys(a)!=='anchorId,length,pointIndex'||!Number.isSafeInteger(a.pointIndex)||!Number.isSafeInteger(a.length)||a.length<this.ability.lengthRange[0]*256||a.length>this.ability.lengthRange[1]*256)return false;
  const anchor=this.anchor(a);if(!anchor)return false;const h=this.harness(s),d=squared(h[0]-anchor.pivot[0],h[1]-anchor.pivot[1]);
  return d>0n&&d<=squared(a.length,0)&&ropeClear(anchor.pivot,h,h,this.collision.faces);
 }
 step(state:GrappleState,input:GrappleInput):GrappleFrame {
  const old=own(state),u=own(input),contacts:GrappleContact[]=[];
  const frame=(status:GrappleFrame['status'],reason:string,next=old):GrappleFrame=>own({status,state:next,input:u,contacts,reason});
  try{
   if(!this.valid(old))return frame('invalidState','Invalid initial body, attachment or integer state');
   if(!u||keys(u)!=='action,anchorId,moveX,pointIndex,reel'||!['coast','attach','release'].includes(u.action)||![-1,0,1].includes(u.moveX)||![-1,0,1].includes(u.reel)||!Number.isSafeInteger(u.pointIndex)||u.action!=='attach'&&(u.anchorId!==null||u.pointIndex!==0)||u.action!=='coast'&&(u.moveX!==0||u.reel!==0))return frame('invalidState','Invalid grapple control');
   if(u.action==='attach'){
    if(old.attachment)return frame('invalidState','Already attached');const anchor=this.anchors.find(a=>a.id===u.anchorId&&a.pointIndex===u.pointIndex);if(!anchor)return frame('unsupported','Missing or forbidden physical anchor');
    const h=this.harness(old),d=squared(h[0]-anchor.pivot[0],h[1]-anchor.pivot[1]),length=Number(rootCeil(d)),r=anchor.approach;
    if(old.x<r[0]||old.x>r[0]+r[2]||old.y<r[1]||old.y>r[1]+r[3]||d>squared(this.ability.range*256,0)||length<this.ability.lengthRange[0]*256||length>this.ability.lengthRange[1]*256)return frame('blocked','Attachment range, approach or rope length');
    if(!ropeClear(anchor.pivot,h,h,this.collision.faces))return frame('blocked','Attachment line occluded');
    const next={...old,tick:old.tick+1,attachment:{anchorId:anchor.id,pointIndex:anchor.pointIndex,length}};return this.valid(next)?frame('ok','',next):frame('invalidState','Invalid attachment');
   }
   if(u.action==='release'){if(!old.attachment)return frame('invalidState','Release requires attachment');const next={...old,tick:old.tick+1,attachment:null};return this.valid(next)?frame('ok','',next):frame('invalidState','Invalid release tick');}
   if(!old.attachment&&u.reel!==0)return frame('invalidState','Reeling requires attachment');
   const a=old.attachment,anchor=a?this.anchor(a)!:null,ratio=a?this.ability.swingGravity:{num:1,den:1};
   let vx=old.vx,vy=Math.min(this.profile.air.maxFall,old.vy+Number(BigInt(this.profile.air.gravity)*BigInt(ratio.num)/BigInt(ratio.den)));
   if(u.moveX){const target=u.moveX*this.profile.air.maxSpeed,delta=target-vx;vx+=Math.sign(delta)*Math.min(Math.abs(delta),this.profile.air.acceleration);}
   let x=old.x+vx,y=old.y+vy;const length=a?Math.max(this.ability.lengthRange[0]*256,Math.min(this.ability.lengthRange[1]*256,a.length+u.reel*this.ability.reelSpeed)):0;
   if(a&&anchor){
    let [hx,hy]=this.harness({x,y}),dx=hx-anchor.pivot[0],dy=hy-anchor.pivot[1];const d=squared(dx,dy);
    if(d>squared(length,0)){const root=rootCeil(d);dx=Number(BigInt(dx)*BigInt(length)/root);dy=Number(BigInt(dy)*BigInt(length)/root);x=anchor.pivot[0]+dx;y=anchor.pivot[1]+dy+this.profile.grabHeight*256;}
    const norm=squared(dx,dy),dot=BigInt(vx)*BigInt(dx)+BigInt(vy)*BigInt(dy);
    if(norm>0n&&d>=squared(length,0)&&dot>0n){vx-=Number(dot*BigInt(dx)/norm);vy-=Number(dot*BigInt(dy)/norm);}
   }
   // Choose the inner axis corner. At least one corner lies within the larger
   // endpoint circle; fixed X-first motion would incorrectly reject a bottom swing.
   const corner=this.harness({x,y:old.y}),cap=a?Math.max(a.length,length):0;
   const axes:readonly (0|1)[]=anchor&&squared(corner[0]-anchor.pivot[0],corner[1]-anchor.pivot[1])>squared(cap,0)?[1,0]:[0,1];
   let from=old;
   for(const axis of axes){const nx=axis===0?x:from.x,ny=axis===1?y:from.y,delta=axis===0?nx-from.x:ny-from.y;
    const contact={...from,mode:'air',supportId:null,planeId:null,facing:1} as ContactState;
    const hits=sweep(this.collision,contact,axis,delta,true);for(const h of hits.filter(h=>h.coordinate===hits[0]?.coordinate))contacts.push({bodyId:h.face.bodyId,shapeId:h.face.shapeId,edgeIndex:h.face.edgeIndex,axis:axis===0?'x':'y'});
    if(hits.some(h=>h.coordinate!==(axis===0?nx:ny))||!this.safe(nx,ny))return frame('blocked','Full-body swing/release sweep blocked');
    if(anchor&&a){const h=this.harness({x:nx,y:ny});if(squared(h[0]-anchor.pivot[0],h[1]-anchor.pivot[1])>squared(Math.max(a.length,length),0)||!ropeClear(anchor.pivot,this.harness(from),h,this.collision.faces))return frame('blocked','Swept straight rope occluded or over length');}
    from={...from,x:nx,y:ny};
   }
   const next={...old,x,y,vx,vy,tick:old.tick+1,attachment:a?{...a,length}:null};return this.valid(next)?frame('ok','',next):frame('invalidState','Invalid resulting integer rope state');
  }catch(e){return frame('unsupported',String(e));}
 }
}
