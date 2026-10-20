import { compare, cross, expanded, floorDiv, fractionOrder, integer, mul, section, strictlyInside, type Fraction, type Point } from './integer';
import { faceOrder } from './world';
import type { Contact, Face, Input, State, Step, World } from './types';

export function groundY(face:Face,x:number):number {
  return integer(face.a[1]+floorDiv(mul(x-face.a[0],face.b[1]-face.a[1]),face.b[0]-face.a[0]));
}
function chain(world:World,seed:Face):Face[] {
  const found=new Set<Face>([seed]),queue=[seed];
  for(const f of queue) for(const next of world.faces) {
    if(!next.support||found.has(next))continue;
    const welded=f.links.includes(next.supportId!)&&next.links.includes(f.supportId!);
    const sameBody=!f.registered&&!next.registered&&f.bodyId!==''&&f.bodyId===next.bodyId&&f.shapeId===next.shapeId;
    const touches=(f.a[0]===next.b[0]&&f.a[1]===next.b[1])||(f.b[0]===next.a[0]&&f.b[1]===next.a[1]);
    if(touches&&(welded||sameBody)){found.add(next);queue.push(next);}
  }
  return queue;
}
export interface Stance {readonly y:number;readonly face:Face;readonly point:Point}
/** Full coverage is required; only reciprocal compatible welds combine their coverage. */
export function resolveStance(world:World,x:number,seedId?:string):Stance[] {
  integer(x);const left=integer(x-world.half),right=integer(x+world.half),out:Stance[]=[];
  const seeds=world.faces.filter(f=>f.support&&(seedId===undefined||f.supportId===seedId));
  const seen=new Set<Face>();
  for(const seed of seeds){
    if(seen.has(seed))continue;
    const fs=chain(world,seed);fs.forEach(f=>seen.add(f));
    const spans=fs.filter(f=>f.a[0]<right&&f.b[0]>left).sort((a,b)=>a.a[0]-b.a[0]||faceOrder(a,b));
    let end=left;for(const f of spans){if(f.a[0]>end)break;end=Math.max(end,f.b[0]);}
    if(end<right)continue;
    const candidates=spans.map(f=>{const a=Math.max(left,f.a[0]),b=Math.min(right,f.b[0]);const px=f.b[1]>=f.a[1]?a:b;return {y:groundY(f,px),face:f,point:[px,groundY(f,px)] as Point};});
    candidates.sort((a,b)=>a.y-b.y||supportOrder(a.face,b.face));
    if(candidates[0])out.push(candidates[0]);
  }
  return out.sort((a,b)=>a.y-b.y||supportOrder(a.face,b.face));
}
const supportOrder=(a:Face,b:Face):number=>a.registered&&b.registered?compare(a.supportId!,b.supportId!):faceOrder(a,b);
function insidePolygon(p:Point,ps:readonly Point[]):boolean {
  let inside=false;
  for(let i=0;i<ps.length;i++){
    const a=ps[i]!,b=ps[(i+1)%ps.length]!;
    if(cross(a,b,p)===0&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]))return false;
    if((a[1]>p[1])!==(b[1]>p[1])){
      const side=cross(a,b,p);if((b[1]>a[1]&&side>0)||(b[1]<a[1]&&side<0))inside=!inside;
    }
  }
  return inside;
}
export function overlaps(world:World,x:number,y:number):boolean {
  const p:Point=[x,y];
  return world.faces.some(f=>f.bodyId!==''&&strictlyInside(p,expanded(f.a,f.b,world.half,world.height))) || world.solids.some(poly=>insidePolygon([x,y-floorDiv(world.height,2)],poly));
}
interface Hit {coordinate:number;at:Fraction;face:Face}
const sameHit=(a:Hit,b:Hit|undefined):boolean=>b!==undefined&&fractionOrder(a.at,b.at)===0;
function sweep(world:World,s:State,axis:0|1,delta:number,includeSupport=false):Hit[] {
  if(delta===0)return [];
  const start=axis===0?s.x:s.y,finish=integer(start+delta),hits:Hit[]=[];
  for(const f of world.faces){
    if(f.support&&(!includeSupport||f.bodyId===''))continue;
    const n=f.normal[axis];
    if(!f.twoSided&&mul(n,delta)>=0)continue;
    const bounds=section(expanded(f.a,f.b,world.half,world.height),axis===0?s.y:s.x,axis);
    if(!bounds)continue;
    const c=delta>0?bounds.low:bounds.high;
    if(delta>0?c>=start&&c<=finish:c<=start&&c>=finish)hits.push({coordinate:c,at:delta>0?bounds.lowAt:bounds.highAt,face:f});
  }
  return hits.sort((a,b)=>(delta>0?fractionOrder(a.at,b.at):fractionOrder(b.at,a.at))||faceOrder(a.face,b.face));
}
function contact(f:Face,axis:'x'|'y',s:State,point?:Point):Contact {
  let normal=f.normal;
  if(f.twoSided){const d=axis==='x'?s.vx:s.vy;const n=normal[axis==='x'?0:1];if(mul(n,d)>0)normal=[integer(-normal[0]),integer(-normal[1])];}
  // Unnormalized exact normal: no floating point normalization enters the trace.
  return {axis,bodyId:f.bodyId,shapeId:f.shapeId,edgeIndex:f.edgeIndex,supportId:f.supportId,normal,
    point:point??[s.x,s.y],kind:f.support?(f.registered?'support':'unregisteredSupport'):'blocking'};
}
// Quantize an actual face witness at the finite rectangle, never its remote midpoint.
// Conservative sweep rounding can leave a gap below 1 su; floor-quantizing the
// rational witness adds less than 1 su in its interpolated coordinate.
function blockingContact(world:World,f:Face,axis:'x'|'y',s:State):Contact {
  const left=integer(s.x-world.half),right=integer(s.x+world.half),top=integer(s.y-world.height);
  const points:Point[]=[f.a,f.b];
  for(const axis of [0,1] as const){
    let a=f.a,b=f.b;if(a[axis]>b[axis])[a,b]=[b,a];
    if(a[axis]===b[axis])continue;
    const other=axis===0?1:0;
    for(const bound of axis===0?[left,right]:[top,s.y]){
      const v=Math.max(a[axis],Math.min(bound,b[axis]));
      const value=integer(a[other]+floorDiv(mul(v-a[axis],b[other]-a[other]),b[axis]-a[axis]));
      points.push(axis===0?[v,value]:[value,v]);
    }
  }
  const distance=([x,y]:Point):number=>Math.max(left-x,0,x-right,top-y,y-s.y);
  points.sort((a,b)=>distance(a)-distance(b)||a[0]-b[0]||a[1]-b[1]);
  return {...contact(f,axis,s),kind:'blocking',point:points[0]!};
}
const approach=(v:number,target:number,amount:number):number=>v<target?Math.min(integer(v+amount),target):Math.max(integer(v-amount),target);

/** ML-017 contact subset of RC4. Jump/drop/climb/dash/sensors are deliberately absent. */
export function step(world:World,old:State,input:Input):Step {
  try{return tick(world,old,input);}catch(e){if(e instanceof RangeError)return {status:'unsafeInteger',state:old,contacts:[],reason:e.message};throw e;}
}
function tick(world:World,old:State,input:Input):Step {
  const fail=(status:Step['status'],reason:string):Step=>({status,state:old,contacts:[],reason});
  for(const n of [old.x,old.y,old.vx,old.vy,old.tick])integer(n);
  if(old.tick<0||!['ground','air'].includes(old.mode)||![-1,1].includes(old.facing)||![-1,0,1].includes(input.moveX)||typeof input.run!=='boolean')return fail('invalidState','state/input');
  if(Object.keys(input).some(k=>!['moveX','run'].includes(k)))return fail('unsupported','only contact moveX/run input is implemented');
  if(overlaps(world,old.x,old.y))return fail('invalidState','initial overlap');
  const p=world.profile,contacts:Contact[]=[];
  let s={...old};
  let support:Stance|undefined;
  if(s.mode==='ground'){
    support=resolveStance(world,s.x,s.supportId??'').find(v=>v.y===s.y);
    if(!support||s.vy!==0)return fail('invalidState','stale or missing support');
  }else if(s.supportId!==null)return fail('invalidState','air support');
  const material=world.source.materials.find(m=>m.id===support?.face.materialId);
  if(material?.tags.some(t=>p.forbiddenMaterialTags.includes(t)))return fail('unsupported','forbidden material');
  const traction=material?.traction??256;
  let target=mul(input.moveX,s.mode==='ground'?(input.run?p.ground.runSpeed:p.ground.walkSpeed):p.air.maxSpeed);
  if(support&&input.moveX!==0&&support.face.b[1]!==support.face.a[1]){const slope=mul(support.face.b[1]-support.face.a[1],input.moveX);const ratio=slope<0?p.ground.uphill:p.ground.downhill;target=target<0?-floorDiv(mul(-target,ratio.num),ratio.den):floorDiv(mul(target,ratio.num),ratio.den);}
  const amount=s.mode==='ground'?floorDiv(mul(input.moveX===0?p.ground.braking:p.ground.acceleration,traction),256):p.air.acceleration;
  s.vx=approach(s.vx,target,amount);
  const dx=integer(s.vx+(s.mode==='ground'?(material?.conveyorSu??0):0));
  const xhits=sweep(world,s,0,dx),xh=xhits[0];
  if(xhits.filter(h=>sameHit(h,xh)).length>8)return fail('contactBudget','x');
  const startX=s.x,startY=s.y;
  s.x=xh?.coordinate??integer(s.x+dx);
  if(xh){for(const h of xhits.filter(h=>sameHit(h,xh)))contacts.push(blockingContact(world,h.face,'x',{...s,vx:dx}));s.vx=0;}
  const stances=resolveStance(world,s.x,s.mode==='ground'?s.supportId??'':undefined);
  let stance:Stance|undefined;
  if(s.mode==='ground')stance=stances.find(v=>v.y-s.y<=p.ground.snapDistance);
  else if(dx!==0)stance=stances.filter(v=>v.y<=s.y&&s.y-v.y<=floorDiv(mul(world.half,p.ground.maxSlope.rise),p.ground.maxSlope.run)+1)
    .find(v=>{const lead=startX+(dx>0?world.half:-world.half);return lead>=v.face.a[0]&&lead<=v.face.b[0]&&startY<=groundY(v.face,lead);});
  if(!stance&&!xh&&s.mode==='air'&&dx!==0){
    const hits=sweep(world,{...s,x:startX},0,dx,true),hit=hits[0];
    if(hits.filter(h=>sameHit(h,hit)).length>8)return fail('contactBudget','x support');
    if(hit){s.x=hit.coordinate;for(const h of hits.filter(h=>sameHit(h,hit)))contacts.push(blockingContact(world,h.face,'x',{...s,vx:dx}));s.vx=0;}
  }
  if(stance){
    // Search the swept footprint through blocker X intervals. Clearance need not be
    // monotone (two separated ceilings), so binary search of the final pose is unsafe.
    const liftBlocked=(x:number,y:number):boolean=>y<old.y&&sweep(world,{...s,x,y:old.y},1,y-old.y).some(h=>h.coordinate>y);
    const at=(x:number):Stance|undefined=>resolveStance(world,x,old.mode==='ground'?old.supportId??'':undefined)
      .find(v=>v.y-old.y<=p.ground.snapDistance);
    const slopes=support?chain(world,support.face).some(f=>f.a[1]!==f.b[1]):stance.y<old.y;
    if(slopes){
      const distance=Math.abs(s.x-startX),sign=s.x>=startX?1:-1;
      const intervals=world.faces.filter(f=>!f.support).map(f=>{
        const a=integer(Math.min(f.a[0],f.b[0])-world.half),b=integer(Math.max(f.a[0],f.b[0])+world.half);
        return sign>0?[Math.max(1,a-startX),Math.min(distance,b-startX)]:[Math.max(1,startX-b),Math.min(distance,startX-a)];
      }).filter(v=>v[0]!<=v[1]!).sort((a,b)=>a[0]!-b[0]!);
      let visited=0,blockedX:number|undefined;
      for(const [begin,end] of intervals){
        for(let n=Math.max(begin!,visited+1);n<=end!;n++){
          const x=integer(startX+sign*n),candidate=at(x);
          if(candidate&&(overlaps(world,x,candidate.y)||liftBlocked(x,candidate.y))){blockedX=x;break;}
          visited=n;
        }
        if(blockedX!==undefined)break;
      }
      if(blockedX!==undefined){
        s.x=integer(blockedX-sign);stance=at(s.x);s.vx=0;
        if(!stance)return fail('invalidState','blocked slope stance');
        const attempted=at(blockedX)!;
        const blocked=world.faces.filter(f=>!f.support&&strictlyInside([blockedX!,attempted.y],expanded(f.a,f.b,world.half,world.height))).sort(faceOrder);
        const liftHits=sweep(world,{...s,x:blockedX,y:old.y},1,attempted.y-old.y).filter(h=>h.coordinate>attempted.y);
        const faces=[...new Set([...blocked,...liftHits.map(h=>h.face)])].sort(faceOrder);
        if(faces.length>8)return fail('contactBudget','slope lift');
        for(const f of faces)contacts.push(blockingContact(world,f,'x',{...s,y:stance.y}));
      }
    }
    if(overlaps(world,s.x,stance.y)||liftBlocked(s.x,stance.y))return fail('invalidState','blocked stance');
    s.y=stance.y;s.mode='ground';s.supportId=stance.face.supportId;s.vy=0;support=stance;
  }else if(s.mode==='ground'){s.mode='air';s.supportId=null;s.vy=0;support=undefined;}
  if(s.mode==='air'){
    if(s.vy<0){
      const hits=sweep(world,s,1,s.vy),hit=hits[0];
      if(hits.filter(h=>sameHit(h,hit)).length>8)return fail('contactBudget','y');
      s.y=hit?.coordinate??integer(s.y+s.vy);
      if(hit){for(const h of hits.filter(h=>sameHit(h,hit)))contacts.push(blockingContact(world,h.face,'y',s));s.vy=0;}
    }else{
      const landing=resolveStance(world,s.x).filter(v=>old.y<=v.y&&s.y<=v.y&&integer(s.y+s.vy)>=v.y).sort((a,b)=>a.y-b.y||supportOrder(a.face,b.face));
      const hit=landing[0];
      // Other blocking faces (including sloped two-sided segments) also stop downward motion.
      const hits=sweep(world,s,1,s.vy),block=hits[0];
      if((hits.filter(h=>sameHit(h,block)).length>8)||(landing.filter(h=>h.y===hit?.y).length>8))return fail('contactBudget','y');
      if(block&&(!hit||block.coordinate<hit.y)){s.y=block.coordinate;for(const h of hits.filter(h=>sameHit(h,block)))contacts.push(blockingContact(world,h.face,'y',s));s.vy=0;}
      else if(hit){s.y=hit.y;s.vy=0;s.mode='ground';s.supportId=hit.face.supportId;support=hit;}
      else s.y=integer(s.y+s.vy);
    }
  }
  if(s.mode==='air')s.vy=Math.min(integer(s.vy+p.air.gravity),p.air.maxFall);
  else if(support){
    if(world.source.materials.find(m=>m.id===support.face.materialId)?.tags.some(t=>p.forbiddenMaterialTags.includes(t)))return fail('unsupported','forbidden material');
    s.planeId=support.face.planeId??world.defaultPlane;contacts.push(contact(support.face,'y',s,support.point));
  }
  if(overlaps(world,s.x,s.y))return fail('invalidState','result overlap');
  if(input.moveX!==0)s.facing=input.moveX;
  s.tick=integer(s.tick+1);
  return {status:'ok',state:s,contacts};
}
