// Independent rectangle-corpus consumer: no MapLab runtime/planner imports.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {readBundle} from './reader/read-bundle.mjs';
const [folder,reportsPath,bundle,schemas]=process.argv.slice(2),read=f=>JSON.parse(readFileSync(join(folder,f),'utf8')),reports=JSON.parse(readFileSync(reportsPath,'utf8'));
const hash=v=>createHash('sha256').update(v).digest('hex'),jcs=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(jcs).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+jcs(v[k])).join(',')+'}',digest=v=>hash(jcs(v));
for(const f of read('index.json').files)assert.equal(hash(readFileSync(join(folder,f.path))),f.sha256,'fixture bytes');
assert(readBundle(bundle,schemas).ok,'independent final-byte import');const manifest=JSON.parse(readFileSync(join(bundle,'manifest.json'),'utf8')),docs=manifest.documents.map(d=>JSON.parse(readFileSync(join(bundle,d.path),'utf8')));
assert.deepEqual(docs.find(d=>d.id==='map.modes'),read('water.map.json'),'exported mode map binding');
const sorted=a=>[...a].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),contracts=read('contracts.json');
function identity(map,p,settings){
 const entities=sorted(map.entities).map(e=>({id:e.id,enabled:e.enabled,anchor:e.anchor,...('movementId'in e?{movementId:e.movementId}:{}),...('ai'in e?{ai:e.ai}:{})}));
 const worldSha256=digest({id:map.id,bounds:map.bounds,collisionContract:map.collisionContract,bodies:sorted(map.bodies),footholds:sorted(map.footholds),materials:sorted(map.materials),traversals:sorted(map.traversals),regions:sorted(map.regions),navigation:{...map.navigation,modeVolumes:sorted(map.navigation.modeVolumes)},environment:map.environment.zones.filter(z=>z.kind==='movementModifier'||z.kind==='launch'),entities,waypoints:sorted(map.waypoints),routes:sorted(map.routes)});
 const id={key:'maplab.reference-modes',version:1,worldSha256,profileSha256:digest(p),controllerSha256:digest({flight:digest({collision:contracts.collision,flight:contracts.flight}),motor:contracts.motor}),settingsSha256:digest({solver:contracts.solver,settings,semantics:'bounded-volume-velocity-state@1'})};return {...id,cacheKey:digest(id)};
}
// Subdivide at every union boundary; coverage of each open cell proves rectangle coverage.
function covers(r,union){const cuts=axis=>[...new Set([r[axis],r[axis]+r[axis+2],...union.flatMap(v=>[v[axis],v[axis]+v[axis+2]]).filter(v=>v>r[axis]&&v<r[axis]+r[axis+2])])].sort((a,b)=>a-b),xs=cuts(0),ys=cuts(1);for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++)if(!union.some(v=>v[0]<=xs[i-1]&&v[0]+v[2]>=xs[i]&&v[1]<=ys[j-1]&&v[1]+v[3]>=ys[j]))return false;return true;}
const footprint=(p,s)=>[s.x-p.collider.width*128,s.y-p.collider.height*256,p.collider.width*256,p.collider.height*256];
function volumes(map,p,mode){const binds=map.navigation.modeVolumes.filter(v=>v.mode===mode&&v.profileIds.includes(p.id));if(!binds.length)return mode==='fly'?[map.bounds.map(n=>n*256)]:[];return binds.map(v=>{const r=map.regions.find(r=>r.id===v.regionId);assert.equal(r.shape.kind,'rect');return r.shape.rect.map(n=>n*256);});}
function clear(map,p,a,b,union){
 let prior=a;
 for(const axis of ['x','y']){const next={...prior,[axis]:b[axis]},r=footprint(p,{x:Math.min(prior.x,next.x),y:Math.min(prior.y,next.y)});r[2]+=Math.abs(next.x-prior.x);r[3]+=Math.abs(next.y-prior.y);assert(covers(r,[map.bounds.map(n=>n*256)])&&covers(r,union),'independent full swept volume');
  for(const body of map.bodies.filter(v=>v.enabled&&p.mask.includes(v.category)&&v.mask.includes(p.category)))for(const shape of body.shapes){assert.equal(shape.kind,'rect');const [x,y,w,h]=shape.rect,ob=[(x+body.position[0])*256,(y+body.position[1])*256,w*256,h*256];assert(!(r[0]<ob[0]+ob[2]&&r[0]+r[2]>ob[0]&&r[1]<ob[1]+ob[3]&&r[1]+r[3]>ob[1]),'independent rectangle collision');}prior=next;
 }
}
function velocity(s,u,a){
 assert([u.targetVx,u.targetVy].every(Number.isSafeInteger));assert(Math.abs(u.targetVx)+Math.abs(u.targetVy)<=a.speed);
 const dx=u.targetVx-s.vx,dy=u.targetVy-s.vy,total=Math.abs(dx)+Math.abs(dy);if(!total)return [s.vx,s.vy];const turn=(s.vx||s.vy)&&(s.vx*u.targetVy-s.vy*u.targetVx!==0||s.vx*u.targetVx+s.vy*u.targetVy<0),limit=Math.min(total,a.acceleration,turn?(a.turnAcceleration??a.acceleration):a.acceleration);
 const delta=[Number(BigInt(dx)*BigInt(limit)/BigInt(total)),Number(BigInt(dy)*BigInt(limit)/BigInt(total))],out=[s.vx+delta[0],s.vy+delta[1]],old=[s.vx,s.vy],target=[u.targetVx,u.targetVy];
 if(!delta[0]&&!delta[1]){const axes=[0,1].sort((i,j)=>Number(Math.abs(target[i])>=Math.abs(old[i]))-Number(Math.abs(target[j])>=Math.abs(old[j]))||i-j);for(const i of axes){const sign=Math.sign(target[i]-old[i]);if(!sign)continue;const next=[...out];next[i]+=sign;if(Math.abs(next[0])+Math.abs(next[1])<=a.speed){out[i]=next[i];break;}}}
 let extra=Math.abs(out[0])+Math.abs(out[1])-a.speed;for(const i of [0,1])if(extra>0&&Math.abs(out[i])>Math.abs(old[i])){const n=Math.min(extra,Math.abs(out[i])-Math.abs(old[i]));out[i]-=Math.sign(out[i])*n;extra-=n;}return out;
}
function ground(map,p,s){const f=map.footholds.find(f=>f.enabled&&f.mode==='solid'&&f.a[1]===f.b[1]&&f.a[1]*256===s.y&&f.a[0]*256<=s.x-p.collider.width*128&&f.b[0]*256>=s.x+p.collider.width*128);assert(f,'independent ground footprint');return f.id;}
let verified=0,samples=0;
for(const c of read('cases.json')){
 const map=read(c.map),p=read(c.profile),r=reports[c.id];assert(r,'missing mode report');assert.deepEqual(docs.find(d=>d.id===p.id),p,'exported mode profile binding');assert.deepEqual(r.initial,c.query.initial,'independent mode initial binding');assert.equal(r.querySha256,digest(c.query));assert.deepEqual(r.identity,identity(map,p,r.settings),'independent mode identity');assert.equal(r.complete,false);assert.equal(r.canCertify,false);
 if(r.status!=='verified reachable with replay witness'){assert.equal(r.frames.length,0);assert.equal(r.terminal,null);continue;}
 assert.equal(c.status,'verified reachable with replay witness');let state={...c.query.initial},index=0;
 if(state.mode==='ground')assert.equal(state.supportId,ground(map,p,state));else assert(covers(footprint(p,state),volumes(map,p,state.mode)));
 while(index<r.frames.length){const frame=r.frames[index];
  if(frame.action!==null){const reverse=frame.action.endsWith(':reverse'),id=reverse?frame.action.slice(0,-8):frame.action,link=map.navigation.links.find(t=>t.id===id);assert(link&&(!reverse||link.bidirectional),'independent transition action');const from=reverse?link.to:link.from,to=reverse?link.from:link.to,fromMode=link.action.params[reverse?'toMode':'fromMode'],toMode=link.action.params[reverse?'fromMode':'toMode'];
   assert.equal(link.action.key,'core.mode.transition');assert.equal(link.action.version,1);assert.equal(link.conditions.length,0);assert.equal(state.mode,fromMode);assert.equal(state.vx,0);assert.equal(state.vy,0);assert.deepEqual([state.x,state.y],from.point.map(n=>n*256));
   const moving=fromMode==='ground'?toMode:fromMode,a=p.abilities.find(a=>a.kind===moving);assert(a);const horizontal=from.point[1]===to.point[1],target=to.point.map(n=>n*256),domain=(mode,point)=>mode==='ground'?[footprint(p,{x:point[0]*256,y:point[1]*256})]:volumes(map,p,mode),union=[...domain(fromMode,from.point),...domain(toMode,to.point)];if(moving==='swim')assert.equal(a.buoyancy,p.air.gravity);
   let count=0;for(;;){assert(count++<r.settings.maxTransitionTicks,'independent transition duration');const f=r.frames[index++];assert(f&&f.action===frame.action);const delta=horizontal?target[0]-state.x:target[1]-state.y,remaining=Math.abs(delta),sign=Math.sign(delta),cap=moving==='swim'&&!horizontal&&toMode==='ground'?Math.min(a.speed,a.breachImpulse):a.speed;
    let best=0;for(let v=1;v<=Math.min(cap,remaining);v++){const k=Math.max(0,Math.floor((v-1)/a.acceleration)),stop=k*v-a.acceleration*k*(k+1)/2;if(v+stop<=remaining)best=v;}const input={targetVx:horizontal?(sign*best||0):0,targetVy:horizontal?0:(sign*best||0)};assert.deepEqual(f.input,input,'independent transition controls');const [vx,vy]=velocity(state,input,{...a,turnAcceleration:a.turnAcceleration??a.acceleration}),next={x:state.x+vx,y:state.y+vy,vx,vy,tick:state.tick+1,mode:'transition',supportId:null};clear(map,p,state,next,union);
    const done=next.x===target[0]&&next.y===target[1]&&vx===0&&vy===0;if(done){next.mode=toMode;if(toMode==='ground')next.supportId=ground(map,p,next);else assert(covers(footprint(p,next),volumes(map,p,toMode)));}assert.deepEqual(f.state,next,'independent transition equation');state=next;if(done)break;
   }
  }else{const a=p.abilities.find(a=>a.kind===state.mode);assert(a);const drift=state.mode==='swim'?p.air.gravity-a.buoyancy:0,vy=Math.max(-a.speed+Math.abs(state.vx),Math.min(a.speed-Math.abs(state.vx),state.vy+drift)),[vx,nextVY]=velocity({...state,vy},frame.input,a),next={...state,x:state.x+vx,y:state.y+nextVY,vx,vy:nextVY,tick:state.tick+1};clear(map,p,state,next,volumes(map,p,state.mode));assert.deepEqual(frame.state,next,'independent mode equation');state=next;index++;}
 }
 assert.deepEqual(state,r.terminal);assert.equal(state.x,c.query.goal.x);assert.equal(state.y,c.query.goal.y);assert.equal(state.mode,c.query.goal.mode);assert.equal(state.vx,0);assert.equal(state.vy,0);assert.equal(r.costTicks,r.frames.length);verified++;samples+=r.frames.length;
}
assert(verified>=5);console.log(JSON.stringify({verified:true,finalByteImport:true,routes:verified,samples,qualification:'owned static rectangles and cardinal anchored mode transitions; no fluid simulation'}));
