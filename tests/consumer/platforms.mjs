// Independent, Node-only oracle for this owned rectangular/linear-slope corpus.
// No MapLab controller, adapter, editor or planner imports. The final-byte reader is separate.
import {readFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {readBundle} from './reader/read-bundle.mjs';
const [dir,reportPath,bundle,schemas]=process.argv.slice(2),read=p=>JSON.parse(readFileSync(join(dir,p),'utf8')),reports=JSON.parse(readFileSync(reportPath,'utf8')),hash=b=>createHash('sha256').update(b).digest('hex');
const index=read('index.json');assert.equal(index.license,'CC0-1.0');for(const f of index.files){assert(!f.path.startsWith('/')&&!f.path.split('/').includes('..'));assert.equal(hash(readFileSync(join(dir,f.path))),f.sha256,f.path);}
const same=(a,b)=>assert.deepEqual(a,b,'independent platform trace');
function offset(m,t){
 if(!m)return [0,0];const duration=m.legTicks.reduce((a,b)=>a+b,0),period=m.mode==='pingPong'?2*duration:duration;
 let q=t+m.initialPhaseTicks;q=m.mode==='once'?Math.min(q,duration):q%period;if(m.mode==='pingPong'&&q>duration)q=period-q;
 let leg=0;while(leg<m.legTicks.length-1&&q>=m.legTicks[leg])q-=m.legTicks[leg++];
 return m.points[leg].map((v,i)=>v*256+Math.floor((m.points[leg+1][i]-v)*256*q/m.legTicks[leg]));
}
function oracle(c,m,p){
 const initial=c.initial,body=m.bodies.find(b=>b.id==='body.floor'),motion=body.motion,half=p.collider.width*128,height=p.collider.height*256,frames=[];
 const event=(kind,deltaSu,extra={})=>({kind,bodyId:body.id,deltaSu,...extra}),f=(state,events,status='ok',platformStatus='ok')=>({status,state,platformStatus,events});
 const airborne=(s,extra={})=>({...s,mode:'air',supportId:null,tick:s.tick+1,vy:s.vy+p.air.gravity,ticksSinceJump:s.ticksSinceJump+1,...extra});
 if(['elevator','phase-reversal','unregistered','oneway-masked'].includes(c.id)){
  const origin=offset(motion,initial.tick);let previous=[initial.x,initial.y];
  for(let i=1;i<=c.ticks;i++){const o=offset(motion,initial.tick+i),s={...initial,x:initial.x+o[0]-origin[0],y:initial.y+o[1]-origin[1],tick:initial.tick+i},events=[];
   if(s.x!==previous[0])events.push(event('carry',[s.x-previous[0],0]));if(s.y!==previous[1])events.push(event('carry',[0,s.y-previous[1]]));frames.push(f(s,events));previous=[s.x,s.y];}
 }else if(c.id.startsWith('jump-')){
  const [dx,dy]=offset(motion,1).map((v,i)=>v-offset(motion,0)[i]),jump=p.abilities.find(a=>a.kind==='jump');let x=initial.x+dx,y=initial.y+dy,vy=-jump.impulse,vx=0;
  for(let i=1;i<=c.ticks;i++){if(i>1)x+=vx;y+=vy;vy+=p.air.gravity;const events=i===1?[event('carry',[dx,0]),event('carry',[0,dy])]:[];
   if(i===1&&motion.departure==='addPlatformVelocity'){vx+=dx;vy+=dy;events.push(event('departure',[dx,dy]));}
   frames.push(f({...initial,x,y,vx,vy,mode:'air',supportId:null,tick:i,jumpHeldPrev:true,ticksSinceJump:i},events));}
 }else if(c.id==='disabled'){
  assert.equal(body.enabled,false);frames.push(f(airborne(initial),[event('disabled',[0,0])]));
 }else if(['swept-push','side-crush'].includes(c.id)){
  const rect=body.shapes[0].rect,o=offset(motion,1),right=(body.position[0]+rect[0]+rect[2])*256+o[0],wanted=right+half;
  assert(initial.x-half>=(rect[0]+rect[2])*256);assert(wanted>initial.x);const wall=m.bodies.find(b=>b.id==='body.wall');
  const actual=wall?Math.min(wanted,wall.shapes[0].rect[0]*256-half):wanted,events=[event('push',[actual-initial.x,0])];
  if(actual<wanted){events.push(event('crushed',[o[0],0],{action:motion.crushAction}));frames.push(f(initial,events,'unsupported','crushed'));}
  else frames.push(f(airborne(initial,{x:actual}),events));
 }else if(['upward-push','oneway-lift'].includes(c.id)){
  const surface=m.footholds[0].a[1]*256+offset(motion,1)[1];assert(initial.y>surface&&initial.y<=m.footholds[0].a[1]*256);
  frames.push(f({...initial,y:surface,tick:1,mode:'ground',supportId:m.footholds[0].id},[event('push',[0,surface-initial.y])]));
 }else if(c.id==='oneway-below'){
  assert(initial.y>m.footholds[0].a[1]*256);frames.push(f(airborne(initial),[]));
 }else if(c.id==='oneway-edge'){
  assert(initial.x+half>m.footholds[0].b[0]*256);frames.push(f(airborne(initial),[]));
 }else if(c.id==='oneway-suppressed'){
  assert.equal(initial.dropSuppression.group,m.footholds[0].dropGroupId);frames.push(f(airborne(initial,{dropSuppression:{...initial.dropSuppression,ticksLeft:initial.dropSuppression.ticksLeft-1}}),[]));
 }else if(c.id==='carry-clipped'){
  const wall=m.bodies.find(b=>b.id==='body.wall'),limit=wall.shapes[0].rect[0]*256-half,x=Math.min(initial.x+offset(motion,1)[0],limit);
  frames.push(f({...initial,x,tick:1},[event('carry',[x-initial.x,0])]));
 }else if(c.id==='ceiling-crush'){
  const ceiling=m.bodies.find(b=>b.id==='body.ceiling').shapes[0].rect,limit=(ceiling[1]+ceiling[3])*256+height,dy=offset(motion,1)[1];assert(initial.y+dy<limit);
  frames.push(f(initial,[event('carry',[0,limit-initial.y]),event('crushed',[0,dy],{action:motion.crushAction})],'unsupported','crushed'));
 }else if(c.id==='lower-oneway'){
  const lower=m.footholds.find(f=>f.id==='fh.lower'),y=lower.a[1]*256;assert(y>initial.y&&y<initial.y+offset(motion,1)[1]);
  frames.push(f({...initial,y,tick:1,supportId:lower.id},[event('carry',[0,y-initial.y])]));
 }else if(c.id==='oneway-slope'){
  const surface=m.footholds[0],rise=surface.b[1]-surface.a[1],run=surface.b[0]-surface.a[0];assert(rise>0);
  const x=(initial.y/256-surface.a[1])*256*run/rise+surface.a[0]*256+half+offset(motion,1)[0];assert(Number.isSafeInteger(x)&&x>initial.x);
  frames.push(f({...initial,x,tick:1,mode:'ground',supportId:surface.id},[event('push',[x-initial.x,0])]));
 }else throw Error('oracle case outside owned scope');
 return frames;
}
const cases=read('cases.json').cases;for(const name of cases){const c=read(name),m=read(c.map),p=read(c.profile);assert.equal(p.controller.key,'maplab.reference-controller');same(oracle(c,m,p),c.expect);same(reports[c.id],c.expect);}
const loaded=readBundle(bundle,schemas);assert(loaded.ok,'independent final-byte load: '+JSON.stringify(loaded.diagnostics));
const manifest=JSON.parse(readFileSync(join(bundle,'manifest.json'),'utf8')),docs=manifest.documents.map(d=>JSON.parse(readFileSync(join(bundle,d.path),'utf8'))),map=docs.find(d=>d.id===manifest.entryMapId),p=docs.find(d=>d.id==='movement.platform'),c=read('elevator.fixture.json');
same(map.bodies[0].motion,read(c.map).bodies[0].motion);same(oracle(c,map,p),reports.elevator);assert.equal(map.entities.filter(e=>e.kind==='playerStart'&&e.default).length,1);
console.log(JSON.stringify({verified:true,cases:cases.length,exportedElevator:true}));
