// Independent integer oracle for the owned flat-floor, fixed-impulse airborne-jump corpus.
// Only Node and the separate final-byte reader; no MapLab controller, adapter or planner imports.
import {readFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {readBundle} from './reader/read-bundle.mjs';
const [folder,reportPath,bundle,schemas]=process.argv.slice(2),read=f=>JSON.parse(readFileSync(join(folder,f),'utf8')),reports=JSON.parse(readFileSync(reportPath,'utf8'));
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const sha=v=>createHash('sha256').update(canonical(v)).digest('hex'),hash=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b,message='independent airborne equation')=>assert.deepEqual(a,b,message);
const ix=read('index.json');assert.equal(ix.license,'CC0-1.0');for(const f of ix.files){assert(!f.path.startsWith('/')&&!f.path.split('/').includes('..'));assert.equal(hash(readFileSync(join(folder,f.path))),f.sha256);}
function equations(m,p,initial,input,ticks){
 const states=[],events=[];let s=structuredClone(initial);const jump=p.abilities.find(a=>a.kind==='jump'),half=p.collider.width*128;
 assert.equal(p.collider.kind,'rect');assert.equal(jump.holdTicks,0);assert.equal(jump.release.num,jump.release.den);
 assert.equal(p.ground.acceleration,256);assert.equal(p.ground.braking,256);assert.equal(p.air.acceleration,256);assert.equal(p.air.maxSpeed,256);
 for(let n=0;n<ticks;n++){
  const old=structuredClone(s),c=input.filter(i=>i.fromTick<=s.tick).at(-1);assert(c&&c.moveY===0&&!c.drop);const pressed=c.jump&&!s.jumpHeldPrev;
  if(s.mode==='ground')s.resources.airJumps=jump.airJumps;
  if(pressed&&s.mode==='ground'){s.vy=-jump.impulse;s.mode='air';s.supportId=null;s.ticksSinceJump=0;s.jumpReleased=false;}
  else if(pressed&&s.mode==='air'&&s.resources.airJumps>0){s.vy=-jump.airborneImpulse;s.ticksSinceJump=0;s.jumpReleased=false;s.resources.airJumps--;events.push({tick:s.tick+1,kind:'airJump',remaining:s.resources.airJumps});}
  s.vx=c.moveX*256;s.x+=s.vx;
  const floors=m.footholds.filter(f=>f.enabled&&f.a[1]===f.b[1]&&f.a[0]*256<=s.x-half&&f.b[0]*256>=s.x+half).sort((a,b)=>a.a[1]-b.a[1]||(a.id<b.id?-1:1));
  if(s.mode==='ground'&&!floors.some(f=>f.id===s.supportId)){s.mode='air';s.supportId=null;s.vy=0;}
  if(s.mode==='air'){
   const landing=s.vy>=0?floors.find(f=>old.y<=f.a[1]*256&&s.y<=f.a[1]*256&&s.y+s.vy>=f.a[1]*256):null;
   if(landing){if(s.resources.airJumps!==jump.airJumps)events.push({tick:s.tick+1,kind:'groundReset',remaining:jump.airJumps});s.y=landing.a[1]*256;s.vy=0;s.mode='ground';s.supportId=landing.id;s.resources.airJumps=jump.airJumps;}
   else{const rising=s.vy<0;s.y+=s.vy;s.vy=Math.min(p.air.maxFall,s.vy+p.air.gravity);if(rising&&!s.jumpReleased&&old.jumpHeldPrev&&!c.jump)s.jumpReleased=true;}
  }
  s.tick++;s.jumpHeldPrev=c.jump;s.ticksSinceJump=s.mode==='air'?s.ticksSinceJump+1:0;if(c.moveX)s.facing=c.moveX;
  states.push({status:'ok',state:structuredClone(s)});
 }
 return {states,events};
}
const cases=read('cases.json');for(const name of cases.cases){const c=read(name),computed=equations(read(c.map),read(c.profile),c.initial,c.input,c.ticks);same(computed.states,c.expect);same(computed.events,c.events);same(reports.cases[name],computed.states);}
const loaded=readBundle(bundle,schemas);assert(loaded.ok,'independent final-byte import: '+JSON.stringify(loaded.diagnostics));
const manifest=JSON.parse(readFileSync(join(bundle,'manifest.json'),'utf8')),docs=manifest.documents.map(d=>JSON.parse(readFileSync(join(bundle,d.path),'utf8'))),map=docs.find(d=>d.id===manifest.entryMapId),p=docs.find(d=>d.id==='movement.air-jumps');
same(p,read('player.movement.json'),'exported profile binding');same(map,read('chain.map.json'),'exported world binding');
const proof=reports.proof;assert.equal(proof.status,'verified reachable with replay witness');assert.equal(proof.canCertify,false);assert.equal(proof.complete,false);
assert(proof.initial&&proof.terminal);assert.equal(proof.durationTicks,proof.frames.length);same(proof.goals,[cases.route.goal]);
const normalized={...p,mask:[...p.mask].sort(),abilityTags:[...p.abilityTags].sort(),forbiddenMaterialTags:[...p.forbiddenMaterialTags].sort(),abilities:[...p.abilities].sort((a,b)=>a.kind<b.kind?-1:a.kind>b.kind?1:0)};
assert.equal(proof.identity.profileSha256,sha(normalized));const contracts=read('contracts.json');assert.equal(proof.identity.controllerSha256,sha({base:contracts.baseControllerSha256,airJumpAdapterSha256:contracts.airJumpAdapterSha256}));
assert.equal(proof.identity.cacheKey,sha({worldSha256:proof.identity.worldSha256,profileSha256:proof.identity.profileSha256,controllerSha256:proof.identity.controllerSha256,settingsSha256:proof.identity.settingsSha256}));
assert.equal(proof.querySha256,sha({initial:proof.initial,goals:proof.goals,algorithm:proof.algorithm}));
const expected=equations(map,p,proof.initial,proof.input,proof.frames.length);same(proof.frames.map(f=>({status:f.status,state:f.state})),expected.states);same(expected.states.at(-1).state,proof.terminal);
assert(expected.events.filter(e=>e.kind==='airJump').length>=2,'chained gaps consume independent airborne charges');assert(expected.events.filter(e=>e.kind==='groundReset').length>=2,'real contacts reset before the next gap');
let prior=proof.initial,cost=0;const combined=[];
for(const action of proof.actions){same(action.initial,prior,'action joins preserve resources');assert.equal(action.durationTicks,action.frames.length);assert(action.durationTicks>0&&action.durationTicks<=proof.settings.maxActionTicks);same(action.terminal,action.frames.at(-1).state);combined.push(...action.frames);cost+=action.durationTicks+action.penaltyTicks;prior=action.terminal;}
same(combined,proof.frames);same(prior,proof.terminal);assert.equal(cost,proof.costTicks);assert.equal(proof.dependencies.sha256,sha({identity:proof.identity,initial:proof.initial,goals:proof.goals,actions:proof.actions,frames:proof.frames}));
const half=p.collider.width*128,height=p.collider.height*256;prior=proof.initial;
for(const f of proof.frames){const s=f.state;assert([s.x,s.y,s.vx,s.vy,s.tick,s.resources.airJumps].every(Number.isSafeInteger));assert(s.resources.airJumps>=0&&s.resources.airJumps<=p.abilities[0].airJumps);assert(s.x-half>=map.bounds[0]*256&&s.x+half<=(map.bounds[0]+map.bounds[2])*256&&s.y-height>=map.bounds[1]*256&&s.y<=(map.bounds[1]+map.bounds[3])*256);
 for(const b of map.bodies)for(const shape of b.shapes){assert.equal(shape.kind,'rect');const [x,y,w,h]=shape.rect.map((v,i)=>(v+(i===0?b.position[0]:i===1?b.position[1]:0))*256);assert(!(s.x+half>x&&s.x-half<x+w&&s.y>y&&s.y-height<y+h),'finite body clearance');if(prior.y>y&&prior.y-height<y+h)assert(!(Math.max(prior.x,s.x)+half>x&&Math.min(prior.x,s.x)-half<x+w),'finite X sweep');}
 if(s.mode==='ground')assert(f.contacts.some(c=>c.kind==='support'&&c.supportId===s.supportId));else assert.equal(f.contacts.length,0);prior=s;
}
assert.equal(reports.groundProof.status,'no route found within declared search/sampling budget');same(reports.groundProof.frames,[]);same(reports.groundProof.actions,[]);
console.log(JSON.stringify({verified:true,cases:cases.cases.length,chainedRoute:true,finalByteImport:true}));
