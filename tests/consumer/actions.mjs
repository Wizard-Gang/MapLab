// Independent integer rectangle oracle. Reads only final exported bytes and the
// owned fixture corpus; imports no MapLab motor, planner, editor or domain code.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {readBundle} from './reader/read-bundle.mjs';
const [folder,reportsPath,bundle,schemas]=process.argv.slice(2),read=f=>JSON.parse(readFileSync(join(folder,f),'utf8'));
const reports=JSON.parse(readFileSync(reportsPath,'utf8')),sha=v=>createHash('sha256').update(v).digest('hex');
const jcs=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(jcs).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+jcs(v[k])).join(',')+'}',digest=v=>sha(jcs(v)),copy=v=>structuredClone(v),sorted=a=>[...a].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
for(const f of read('index.json').files)assert.equal(sha(readFileSync(join(folder,f.path))),f.sha256,'fixture bytes');
const imported=readBundle(bundle,schemas);assert(imported.ok,'independent final-byte import: '+JSON.stringify(imported.diagnostics));
const manifest=JSON.parse(readFileSync(join(bundle,'manifest.json'),'utf8')),docs=manifest.documents.map(d=>JSON.parse(readFileSync(join(bundle,d.path),'utf8')));
for(const f of read('index.json').files.filter(f=>/\.(map|movement|catalog)\.json$/.test(f.path)&&f.path!=='unknown.movement.json')){const d=read(f.path);assert.deepEqual(docs.find(v=>v.id===d.id),d,'exported action document binding');}
const document=f=>{const fixture=read(f);return docs.find(v=>v.id===fixture.id)??fixture;},contracts=read('contracts.json');
function identity(map,p,state,settings){
 const entities=sorted(map.entities).map(e=>({id:e.id,enabled:e.enabled,anchor:e.anchor,...('movementId'in e?{movementId:e.movementId}:{}),...('ai'in e?{ai:e.ai}:{})}));
 const worldSha256=digest({id:map.id,bounds:map.bounds,collisionContract:map.collisionContract,bodies:sorted(map.bodies),footholds:sorted(map.footholds),materials:sorted(map.materials),traversals:sorted(map.traversals),regions:sorted(map.regions),navigation:{...map.navigation,modeVolumes:sorted(map.navigation.modeVolumes)},environment:map.environment.zones.filter(z=>z.kind==='movementModifier'||z.kind==='launch'),entities,waypoints:sorted(map.waypoints),routes:sorted(map.routes)});
 const id={key:'maplab.reference-actions',version:1,worldSha256,profileSha256:digest(p),stateSha256:digest(state),controllerSha256:digest({base:digest({collision:contracts.collision,flight:contracts.flight}),motor:contracts.motor,modifiers:contracts.modifiers,visibility:contracts.visibility}),settingsSha256:digest({planner:contracts.planner,settings,semantics:'teleport-launch-multiply-once-clamp@1'})};return {...id,cacheKey:digest(id)};
}
const fields=['ground.walkSpeed','ground.runSpeed','ground.acceleration','ground.braking','air.gravity','air.maxFall','air.acceleration','air.maxSpeed'];
function effective(p,active){const result=copy(p);for(const field of fields){const [g,n]=field.split('.');let num=BigInt(p[g][n]),den=1n;for(const a of active.filter(a=>a.field===field)){num*=BigInt(a.num);den*=BigInt(a.den);}result[g][n]=Number(num/den>8192n?8192n:num/den);}return result;}
const profileHash=(p,s)=>digest({profile:effective(p,s.modifiers),active:sorted(s.modifiers)});
function boxes(m,p){return sorted(m.bodies).filter(b=>b.enabled&&p.mask.includes(b.category)&&b.mask.includes(p.category)).flatMap(b=>b.shapes.map(s=>({body:b.id,shape:s.id,r:[(s.rect[0]+b.position[0])*256,(s.rect[1]+b.position[1])*256,s.rect[2]*256,s.rect[3]*256]})));}
const overlap=(a,b)=>a[0]<b[0]+b[2]&&a[0]+a[2]>b[0]&&a[1]<b[1]+b[3]&&a[1]+a[3]>b[1];
function safe(m,p,s){const half=p.collider.width*128,h=p.collider.height*256,r=[s.x-half,s.y-h,half*2,h],b=m.bounds.map(v=>v*256);return r[0]>=b[0]&&r[1]>=b[1]&&r[0]+r[2]<=b[0]+b[2]&&r[1]+r[3]<=b[1]+b[3]&&!boxes(m,p).some(b=>overlap(r,b.r));}
const support=(m,p,s)=>boxes(m,p).find(b=>s.x-p.collider.width*128>=b.r[0]&&s.x+p.collider.width*128<=b.r[0]+b.r[2]&&s.y===b.r[1]);
const supportId=b=>'unregistered:'+b.body+'/'+b.shape+'/0';
// Exact rational slab intersection, independently written from the production
// segment/triangle geometry. Closed obstacle tangency blocks line of sight.
function ray(a,b,r){let lo=[0n,1n],hi=[1n,1n];const frac=(n,d)=>d<0n?[-n,-d]:[n,d],cmp=(x,y)=>x[0]*y[1]-y[0]*x[1];for(let k=0;k<2;k++){const d=BigInt(b[k]-a[k]);if(!d){if(a[k]<r[k]||a[k]>r[k]+r[k+2])return false;continue;}let l=frac(BigInt(r[k]-a[k]),d),h=frac(BigInt(r[k]+r[k+2]-a[k]),d);if(cmp(l,h)>0n)[l,h]=[h,l];if(cmp(l,lo)>0n)lo=l;if(cmp(h,hi)<0n)hi=h;if(cmp(lo,hi)>0n)return false;}return true;}
function oracle(m,p,old,u){
 const bad=status=>({status,state:old,contacts:[]});
 if(p.abilities.some(a=>a.kind==='modifier'&&a.allowed.some(r=>r.key!=='maplab.modifier.kinematic'||r.version!==1)))return bad('unsupported');
 const next={...copy(old),tick:old.tick+1,cooldownTicks:Math.max(0,old.cooldownTicks-1),modifiers:old.modifiers.filter(a=>a.ticksLeft>1).map(a=>({...a,ticksLeft:a.ticksLeft-1}))},contacts=[];
 if(u.kind==='teleport'){
  const a=p.abilities.find(a=>a.kind==='teleport');if(!a)return bad('unsupported');if(old.cooldownTicks)return bad('blocked');const [x,y]=u.target,dx=BigInt(x-old.x),dy=BigInt(y-old.y),range=BigInt(a.range*256);
  if(dx*dx+dy*dy>range*range||!safe(m,p,{x,y}))return bad('blocked');
  if(a.target==='anchor'){const anchor=m.waypoints.find(w=>w.id===u.anchorId)?.anchor;if(!anchor||anchor.kind!=='world'||anchor.point[0]*256!==x||anchor.point[1]*256!==y)return bad('unsupported');}
  else if(boxes(m,p).some(b=>ray([old.x,old.y-p.collider.height*128],[x,y-p.collider.height*128],b.r)))return bad('blocked');
  const at=support(m,p,{x,y});Object.assign(next,{x,y,vx:0,vy:0,mode:at?'ground':'air',supportId:at?supportId(at):null,launched:false,cooldownTicks:a.cooldownTicks});
 }else if(u.kind==='modifier'){
  const a=p.abilities.find(a=>a.kind==='modifier'),c=u.definition,v=c.params;
  if(!a||c.key!=='maplab.modifier.kinematic'||c.version!==1||!a.allowed.some(r=>r.key===c.key&&r.version===c.version))return bad('unsupported');
  next.modifiers=next.modifiers.filter(e=>e.id!==u.id&&(a.stacking!=='replace'||e.field!==v.field));next.modifiers.push({id:u.id,key:c.key,version:1,field:v.field,num:v.num,den:v.den,ticksLeft:v.durationTicks});next.modifiers=sorted(next.modifiers);
 }else{
  const e=effective(p,old.modifiers),a=p.abilities.find(a=>a.kind==='launch');let move=u.kind==='coast'?u.moveX:0,launched=old.launched,mode=old.mode,vx=old.vx,vy=old.vy;
  if(u.kind==='launch'){if(!a)return bad('unsupported');if(Math.abs(u.impulse[0])+Math.abs(u.impulse[1])>a.maxImpulse)return bad('blocked');vx=u.impulse[0]+(u.mode==='add'?vx:0);vy=u.impulse[1]+(u.mode==='add'?vy:0);mode='air';launched=true;}
  if(launched&&a){e.air.acceleration=a.canRecover?Number(BigInt(e.air.acceleration)*BigInt(a.airControl.num)/BigInt(a.airControl.den)):0;if(!a.canRecover)move=0;}
  const target=move*(mode==='ground'?e.ground.runSpeed:e.air.maxSpeed),accel=mode==='ground'?(move?e.ground.acceleration:e.ground.braking):e.air.acceleration;
  vx+=Math.sign(target-vx)*Math.min(Math.abs(target-vx),accel);
  const half=p.collider.width*128,h=p.collider.height*256,bs=boxes(m,p);let x=old.x+vx,y=old.y;
  const side=bs.filter(b=>old.y>b.r[1]&&old.y-h<b.r[1]+b.r[3]).map(b=>({b,c:vx>0?b.r[0]-half:b.r[0]+b.r[2]+half})).filter(v=>vx>0?v.c>=old.x&&v.c<=x:vx<0&&v.c<=old.x&&v.c>=x).sort((a,b)=>vx>0?a.c-b.c:b.c-a.c)[0];
  const hit=(b,edge,axis,px,py)=>{const r=b.r,normal=edge===0?[0,-r[2]]:edge===1?[r[3],0]:edge===2?[0,r[2]]:[-r[3],0];return {axis,bodyId:b.body,shapeId:b.shape,edgeIndex:edge,supportId:edge===0?supportId(b):null,normal,pose:{x:px,y:py},point:axis==='x'?[edge===3?r[0]:r[0]+r[2],Math.max(r[1],Math.min(py-h,r[1]+r[3]))]:[px-half,py],kind:edge===0?'unregisteredSupport':'blocking'};};
  if(side){x=side.c;contacts.push(hit(side.b,vx>0?3:1,'x',x,y));vx=0;}
  let at=mode==='ground'?support(m,p,{x,y}):null;
  if(!at){mode='air';const end=y+vy;if(vy>=0){const land=bs.filter(b=>x-half>=b.r[0]&&x+half<=b.r[0]+b.r[2]&&y<=b.r[1]&&end>=b.r[1]).sort((a,b)=>a.r[1]-b.r[1])[0];if(land){y=land.r[1];vy=0;mode='ground';at=land;}else y=end;}
   else{const ceiling=bs.filter(b=>x+half>b.r[0]&&x-half<b.r[0]+b.r[2]&&y-h>=b.r[1]+b.r[3]&&end-h<=b.r[1]+b.r[3]).sort((a,b)=>b.r[1]+b.r[3]-a.r[1]-a.r[3])[0];if(ceiling){y=ceiling.r[1]+ceiling.r[3]+h;contacts.push(hit(ceiling,2,'y',x,y));vy=0;}else y=end;}}
  if(mode==='air')vy=Math.min(e.air.maxFall,vy+e.air.gravity);else if(at)contacts.push(hit(at,0,'y',x,y));
  Object.assign(next,{x,y,vx,vy,mode,supportId:mode==='ground'?supportId(at):null,launched:launched&&mode==='air',facing:move||old.facing});
 }
 if(!safe(m,p,next))return bad('blocked');return {status:'ok',state:next,contacts};
}
function checkFrame(m,p,s,u,f){assert.deepEqual(f.input,u,'bound control');const expected=oracle(m,p,s,u);assert.equal(f.status,expected.status,'oracle status');assert.deepEqual(f.state,expected.state,'integer runtime state');assert.deepEqual(f.contacts,expected.contacts,'semantic contacts');return f.state;}
for(const c of read('steps.json')){const f=reports.steps[c.id];assert.equal(f.status,c.status);checkFrame(document(c.map),document(c.profile),c.initial,c.input,f);}
for(const c of read('traces.json')){let s=c.initial;assert.equal(reports.traces[c.id].length,c.inputs.length);for(let i=0;i<c.inputs.length;i++){s=checkFrame(document(c.map),document(c.profile),s,c.inputs[i],reports.traces[c.id][i]);assert.deepEqual(s,c.expected[i],'owned checkpoint');}}
for(const c of read('cases.json')){
 const proof=reports.plans[c.id],m=document(c.map),p=document(c.profile),q=c.query;
 assert.equal(proof.status,c.status);assert.equal(proof.canCertify,false);assert.equal(proof.complete,false);assert.equal(proof.heuristic,'zero');assert.deepEqual(proof.identity,identity(m,p,q.initial,proof.settings));assert.equal(proof.querySha256,digest(q));assert.deepEqual(proof.initial,q.initial);
 if(c.costTicks===undefined){assert.deepEqual(proof.frames,[]);assert.equal(proof.terminal,null);continue;}
 let s=q.initial;const hashes=[profileHash(p,s)];for(const f of proof.frames){assert(f.input.kind==='coast'&&[-1,0,1].includes(f.input.moveX)||q.actions.some(u=>jcs(u)===jcs(f.input)),'sampled control');s=checkFrame(m,p,s,f.input,f);hashes.push(profileHash(p,s));}
 assert.deepEqual(hashes,proof.effectiveProfileHashes,'effective-profile identity');assert.deepEqual(s,proof.terminal);assert.equal(proof.costTicks,c.costTicks);assert.equal(proof.frames.length,c.costTicks);assert(Math.abs(s.x-q.goal.x)<=q.goal.toleranceSu&&Math.abs(s.y-q.goal.y)<=q.goal.toleranceSu&&s.mode===q.goal.mode&&(!q.goal.rest||!s.vx&&!s.vy),'goal');
}
process.stdout.write(JSON.stringify({verified:true,finalByteImport:true,oracle:'independent integer rectangles and rational profiles'})+'\n');
