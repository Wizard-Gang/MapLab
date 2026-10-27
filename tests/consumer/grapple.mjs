// Independent rectangle/straight-rope oracle. No MapLab solver or editor imports.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';import {readBundle} from './reader/read-bundle.mjs';
const [folder,reportsPath,bundle,schemas]=process.argv.slice(2),read=f=>JSON.parse(readFileSync(join(folder,f),'utf8')),reports=JSON.parse(readFileSync(reportsPath,'utf8'));
const sha=v=>createHash('sha256').update(v).digest('hex'),jcs=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(jcs).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+jcs(v[k])).join(',')+'}',digest=v=>sha(jcs(v));
for(const f of read('index.json').files)assert.equal(sha(readFileSync(join(folder,f.path))),f.sha256,'fixture bytes');const imported=readBundle(bundle,schemas);assert(imported.ok,'independent final-byte import: '+JSON.stringify(imported.diagnostics));
const manifest=JSON.parse(readFileSync(join(bundle,'manifest.json'),'utf8')),docs=manifest.documents.map(d=>JSON.parse(readFileSync(join(bundle,d.path),'utf8')));
for(const f of read('index.json').files.filter(f=>(f.path.endsWith('.map.json')||f.path.endsWith('.movement.json'))&&f.path!=='unknown.movement.json')){const d=read(f.path);assert.deepEqual(docs.find(v=>v.id===d.id),d,'exported grapple document binding');}assert(!docs.some(d=>d.id==='movement.unknown'),'unknown solver is outside the accepted export closure');
const contracts=read('contracts.json'),sorted=a=>[...a].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
function identity(map,p,settings){
 const entities=sorted(map.entities).map(e=>({id:e.id,enabled:e.enabled,anchor:e.anchor,...('movementId'in e?{movementId:e.movementId}:{}),...('ai'in e?{ai:e.ai}:{})})),worldSha256=digest({id:map.id,bounds:map.bounds,collisionContract:map.collisionContract,bodies:sorted(map.bodies),footholds:sorted(map.footholds),materials:sorted(map.materials),traversals:sorted(map.traversals),regions:sorted(map.regions),navigation:{...map.navigation,modeVolumes:sorted(map.navigation.modeVolumes)},environment:map.environment.zones.filter(z=>z.kind==='movementModifier'||z.kind==='launch'),entities,waypoints:sorted(map.waypoints),routes:sorted(map.routes)});
 const id={key:'maplab.reference-grapple',version:1,worldSha256,profileSha256:digest(p),controllerSha256:digest({base:digest({collision:contracts.collision,flight:contracts.flight}),motor:contracts.motor,geometry:contracts.geometry}),settingsSha256:digest({planner:contracts.planner,settings,semantics:'integer-straight-rope-project@1'})};return {...id,cacheKey:digest(id)};
}
const clone=v=>structuredClone(v),sq=(x,y)=>BigInt(x)*BigInt(x)+BigInt(y)*BigInt(y),trunc=(a,b)=>Number(a/b);
function sqrtCeil(n){if(n<2n)return n;let r=n/2n+1n,next=(r+n/r)/2n;while(next<r){r=next;next=(r+n/r)/2n;}return r*r===n?r:r+1n;}
const fraction=(n,d)=>d<0n?[-n,-d]:[n,d],cmp=(a,b)=>a[0]*b[1]-b[0]*a[1];
// Slab clipping computes the complete closed intersection interval independently.
function segmentHits(a,b,r,pivot){
 let lo=[0n,1n],hi=[1n,1n];
 for(let axis=0;axis<2;axis++){const delta=BigInt(b[axis]-a[axis]);if(!delta){if(a[axis]<r[axis]||a[axis]>r[axis]+r[axis+2])return false;continue;}
  let x=fraction(BigInt(r[axis]-a[axis]),delta),y=fraction(BigInt(r[axis]+r[axis+2]-a[axis]),delta);if(cmp(x,y)>0n)[x,y]=[y,x];if(cmp(x,lo)>0n)lo=x;if(cmp(y,hi)<0n)hi=y;if(cmp(lo,hi)>0n)return false;
 }
 if(a[0]===b[0]&&a[1]===b[1])return a[0]!==pivot[0]||a[1]!==pivot[1];
 if(cmp(lo,hi)<0n)return true;
 return [0,1].some(i=>BigInt(a[i])*lo[1]+BigInt(b[i]-a[i])*lo[0]!==BigInt(pivot[i])*lo[1]);
}
const cross=(a,b,c)=>BigInt(b[0]-a[0])*BigInt(c[1]-a[1])-BigInt(b[1]-a[1])*BigInt(c[0]-a[0]);
function ropeSafe(pivot,a,b,boxes){
 for(const r of boxes){if([[pivot,a],[a,b],[b,pivot]].some(([x,y])=>segmentHits(x,y,r,pivot)))return false;
  if(cross(pivot,a,b)!==0n)for(const p of [[r[0],r[1]],[r[0]+r[2],r[1]],[r[0]+r[2],r[1]+r[3]],[r[0],r[1]+r[3]]]){const cs=[cross(pivot,a,p),cross(a,b,p),cross(b,pivot,p)];if(cs.every(v=>v>0n)||cs.every(v=>v<0n))return false;}
 }return true;
}
const overlap=(a,b)=>a[0]<b[0]+b[2]&&a[0]+a[2]>b[0]&&a[1]<b[1]+b[3]&&a[1]+a[3]>b[1];
function oracle(map,p){
 const ability=p.abilities.find(a=>a.kind==='grapple');assert(ability&&ability.solver.key==='maplab.reference-grapple'&&ability.solver.version===1&&p.abilities.length===1,'independent supported solver');assert(p.collider.kind==='rect'&&p.grabHeight<=p.collider.height);
 const solids=map.bodies.filter(b=>b.enabled&&p.mask.includes(b.category)&&b.mask.includes(p.category)).flatMap(b=>b.shapes.map(s=>{assert.equal(s.kind,'rect');return {bodyId:b.id,shapeId:s.id,rect:[(s.rect[0]+b.position[0])*256,(s.rect[1]+b.position[1])*256,s.rect[2]*256,s.rect[3]*256]};})),boxes=solids.map(s=>s.rect),bound=map.bounds.map(n=>n*256),foot=s=>[s.x-p.collider.width*128,s.y-p.collider.height*256,p.collider.width*256,p.collider.height*256],harness=s=>[s.x,s.y-p.grabHeight*256];
 const safe=s=>{const r=foot(s);return r[0]>=bound[0]&&r[1]>=bound[1]&&r[0]+r[2]<=bound[0]+bound[2]&&r[1]+r[3]<=bound[1]+bound[3]&&!boxes.some(b=>overlap(r,b));};
 function anchor(a){const t=map.traversals.find(t=>t.kind==='grapple'&&t.id===a.anchorId),body=map.bodies.find(b=>b.id===t?.edge.bodyId);assert(t&&body?.enabled&&t.requiredAbilities.every(v=>p.abilityTags.includes(v)));const point=t.points[a.pointIndex];assert(point);return {pivot:[(point[0]+body.position[0])*256,(point[1]+body.position[1])*256],approach:map.regions.find(r=>r.id===t.approachRegionId).shape.rect.map(n=>n*256)};}
 const valid=s=>{assert([s.x,s.y,s.vx,s.vy,s.tick].every(Number.isSafeInteger)&&safe(s));if(s.attachment){const a=s.attachment,{pivot}=anchor(a),h=harness(s);assert(a.length>=ability.lengthRange[0]*256&&a.length<=ability.lengthRange[1]*256);assert(sq(h[0]-pivot[0],h[1]-pivot[1])<=sq(a.length,0)&&ropeSafe(pivot,h,h,boxes));}};
 function contactSequence(from,next,axis){const delta=next[axis]-from[axis];if(!delta)return [];const list=[];
  for(const solid of solids){const r=solid.rect,extent=axis==='x'?[from.y-p.collider.height*256,from.y]:[from.x-p.collider.width*128,from.x+p.collider.width*128],start=axis==='x'?r[1]:r[0],size=axis==='x'?r[3]:r[2];if(extent[0]>=start+size||extent[1]<=start)continue;
   const coordinate=axis==='x'?(delta>0?r[0]-p.collider.width*128:r[0]+r[2]+p.collider.width*128):(delta>0?r[1]:r[1]+r[3]+p.collider.height*256),edgeIndex=axis==='x'?(delta>0?3:1):(delta>0?0:2);if(delta>0?coordinate<from[axis]||coordinate>next[axis]:coordinate>from[axis]||coordinate<next[axis])continue;list.push({coordinate,bodyId:solid.bodyId,shapeId:solid.shapeId,edgeIndex,axis});
  }list.sort((a,b)=>(delta>0?a.coordinate-b.coordinate:b.coordinate-a.coordinate)||(a.bodyId<b.bodyId?-1:a.bodyId>b.bodyId?1:a.shapeId<b.shapeId?-1:a.shapeId>b.shapeId?1:a.edgeIndex-b.edgeIndex));return list.filter(v=>v.coordinate===list[0]?.coordinate).map(({coordinate,...contact})=>contact);
 }
 function step(old,u){valid(old);assert(['attach','coast','release'].includes(u.action)&&[-1,0,1].includes(u.moveX)&&[-1,0,1].includes(u.reel));let s=clone(old);s.tick++;const contacts=[],blocked=()=>({status:'blocked',state:old,contacts});
  if(u.action==='attach'){assert(!s.attachment&&u.moveX===0&&u.reel===0);const {pivot,approach:r}=anchor(u),h=harness(s),d=sq(h[0]-pivot[0],h[1]-pivot[1]),length=Number(sqrtCeil(d));if(s.x<r[0]||s.x>r[0]+r[2]||s.y<r[1]||s.y>r[1]+r[3]||d>sq(ability.range*256,0)||length<ability.lengthRange[0]*256||length>ability.lengthRange[1]*256||!ropeSafe(pivot,h,h,boxes))return blocked();s.attachment={anchorId:u.anchorId,pointIndex:u.pointIndex,length};return {status:'ok',state:s,contacts};}
  if(u.action==='release'){assert(s.attachment&&u.moveX===0&&u.reel===0);s.attachment=null;return {status:'ok',state:s,contacts};}
  assert(s.attachment||u.reel===0);let vx=old.vx,vy=Math.min(p.air.maxFall,old.vy+(s.attachment?trunc(BigInt(p.air.gravity)*BigInt(ability.swingGravity.num),BigInt(ability.swingGravity.den)):p.air.gravity));if(u.moveX){const delta=u.moveX*p.air.maxSpeed-vx;vx+=Math.sign(delta)*Math.min(Math.abs(delta),p.air.acceleration);}s.x+=vx;s.y+=vy;
  let pivot=null;
  if(s.attachment){const a=s.attachment;pivot=anchor(a).pivot;a.length=Math.max(ability.lengthRange[0]*256,Math.min(ability.lengthRange[1]*256,a.length+u.reel*ability.reelSpeed));let [hx,hy]=harness(s),dx=hx-pivot[0],dy=hy-pivot[1],d=sq(dx,dy);if(d>sq(a.length,0)){const root=sqrtCeil(d);dx=trunc(BigInt(dx)*BigInt(a.length),root);dy=trunc(BigInt(dy)*BigInt(a.length),root);s.x=pivot[0]+dx;s.y=pivot[1]+dy+p.grabHeight*256;}const norm=sq(dx,dy),dot=BigInt(vx)*BigInt(dx)+BigInt(vy)*BigInt(dy);if(norm&&d>=sq(a.length,0)&&dot>0n){vx-=trunc(dot*BigInt(dx),norm);vy-=trunc(dot*BigInt(dy),norm);}}
  const corner=harness({x:s.x,y:old.y}),cap=pivot?Math.max(old.attachment.length,s.attachment.length):0,axes=pivot&&sq(corner[0]-pivot[0],corner[1]-pivot[1])>sq(cap,0)?['y','x']:['x','y'];
  let prior=old;for(const axis of axes){const next={...prior,[axis]:s[axis]},r=foot({x:Math.min(next.x,prior.x),y:Math.min(next.y,prior.y)});r[2]+=Math.abs(next.x-prior.x);r[3]+=Math.abs(next.y-prior.y);contacts.push(...contactSequence(prior,next,axis));if(!safe(next)||boxes.some(b=>overlap(r,b)))return blocked();if(pivot){const h=harness(next);if(sq(h[0]-pivot[0],h[1]-pivot[1])>sq(cap,0)||!ropeSafe(pivot,harness(prior),h,boxes))return blocked();}prior=next;}
  s.vx=vx;s.vy=vy;valid(s);return {status:'ok',state:s,contacts};
 }return {step,valid};
}
let routes=0,checkpoints=0,negatives=0;
for(const c of read('traces.json')){const engine=oracle(read(c.map),read(c.profile)),frames=reports.traces[c.id];assert.equal(frames.length,c.inputs.length);let s=c.initial;for(let i=0;i<frames.length;i++){assert.deepEqual(frames[i].input,c.inputs[i],'independent control binding');const f=engine.step(s,c.inputs[i]);assert.equal(f.status,'ok');assert.deepEqual(frames[i].contacts,f.contacts,'independent grapple contacts');assert.deepEqual(frames[i].state,f.state,'independent grapple equation');assert.deepEqual(f.state,c.expected[i],'independent checkpoint');s=f.state;checkpoints++;}}
for(const c of read('steps.json')){const f=oracle(read(c.map),read(c.profile)).step(c.initial,c.input),actual=reports.steps[c.id];assert.equal(f.status,c.status,'independent collision outcome');assert.equal(actual.status,f.status);assert.deepEqual(f.contacts,c.expectedContacts,'independent contact fixture');assert.deepEqual(actual.contacts,f.contacts,'independent collision contacts');assert.deepEqual(actual.state,f.state);assert.deepEqual(actual.input,c.input);if(f.status!=='ok')negatives++;}
for(const c of read('cases.json')){
 const map=read(c.map),p=read(c.profile),r=reports.plans[c.id];assert(r);assert.deepEqual(r.initial,c.query.initial);assert.equal(r.querySha256,digest(c.query));assert.deepEqual(r.identity,identity(map,p,r.settings));assert.equal(r.canCertify,false);assert.equal(r.complete,false);assert.deepEqual(r.solver,{key:'maplab.reference-grapple',version:1});assert(r.replayTicks<=r.settings.maxReplayTicks&&r.samples<=r.settings.maxSamples&&r.expanded<=r.settings.maxExpanded);
 if(c.status!=='verified reachable with replay witness'){assert((c.allowedStatuses??[c.status]).includes(r.status));assert.deepEqual(r.frames,[]);assert.equal(r.terminal,null);continue;}
 assert.equal(r.status,c.status);assert(r.frames.length>0&&r.frames.length<=r.settings.maxRouteTicks);const engine=oracle(map,p);let s=c.query.initial;for(const f of r.frames){const actual=engine.step(s,f.input);assert.equal(f.status,'ok');assert.equal(actual.status,'ok');assert.deepEqual(f.contacts,actual.contacts,'independent planned contacts');assert.deepEqual(f.state,actual.state,'independent planned grapple equation');s=actual.state;}
 assert.deepEqual(s,r.terminal);const g=c.query.goal;assert(Math.abs(s.x-g.x)<=g.toleranceSu&&Math.abs(s.y-g.y)<=g.toleranceSu&&(g.mode==='attached')===(s.attachment!==null));assert.equal(r.costTicks,r.frames.length);routes++;
}
assert(routes>=4&&negatives>=6&&checkpoints>=20);console.log(JSON.stringify({verified:true,finalByteImport:true,routes,checkpoints,negatives,qualification:'owned static rectangles; named integer straight-rope solver only'}));
