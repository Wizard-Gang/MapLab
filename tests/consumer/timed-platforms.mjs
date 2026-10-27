// Separate Node-only equations for the owned vertical elevator corpus.
// No MapLab runtime, timing, planner, editor or replay imports.
import {readFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {readBundle} from './reader/read-bundle.mjs';
const [dir,reportPath,bundle,schemas]=process.argv.slice(2),read=p=>JSON.parse(readFileSync(join(dir,p),'utf8')),reports=JSON.parse(readFileSync(reportPath,'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex'),same=(a,b,message='independent timed checkpoint')=>assert.deepEqual(a,b,message);
const index=read('index.json');assert.equal(index.license,'CC0-1.0');for(const f of index.files)assert.equal(hash(readFileSync(join(dir,f.path))),f.sha256,f.path);
function phase(m,t){const duration=m.legTicks.reduce((a,b)=>a+b,0),period=duration*(m.mode==='pingPong'?2:1),phase=(t+m.initialPhaseTicks)%period;let q=phase;
 if(m.mode==='pingPong'&&q>duration)q=period-q;let leg=0;while(leg<m.legTicks.length-1&&q>=m.legTicks[leg])q-=m.legTicks[leg++];
 return {phaseTicks:phase,periodTicks:period,offsetSu:m.points[leg].map((v,i)=>v*256+Math.floor((m.points[leg+1][i]-v)*256*q/m.legTicks[leg]))};
}
function vertical(c,proof,m){
 const lift=m.bodies.find(b=>b.id==='body.lift'),motion=lift.motion,fh=m.footholds.find(f=>f.id==='fh.lift'),fixed=m.footholds.filter(f=>!f.ownerBodyId),x=c.query.initial.x;
 assert.equal(motion.points[1][0],0);let s=c.query.initial;
 for(const f of proof.frames){
  same(f.input,c.query.controls[0]);const t=s.tick+1,before=phase(motion,s.tick),after=phase(motion,t),top=fh.a[1]*256+after.offsetSu[1],prior=fh.a[1]*256+before.offsetSu[1],dy=top-prior;
  let y=s.y,events=[];const rider=s.supportId==='fh.lift';
  if(rider){y+=dy;if(dy>0){const land=fixed.map(v=>v.a[1]*256).filter(v=>v>=s.y&&v<=y);if(land.length)y=Math.min(...land);}if(dy)events.push({kind:'carry',bodyId:lift.id,deltaSu:[0,y-s.y]});}
  else if(dy<0&&s.y<=prior&&s.y>=top){y=top;if(y!==s.y)events.push({kind:'push',bodyId:lift.id,deltaSu:[0,y-s.y]});}
  const candidates=[...fixed.filter(v=>v.a[1]*256===y).map(v=>v.id),...(y===top?['fh.lift']:[])].sort();assert(candidates.length,'owned vertical support');const supportId=candidates[0];
  const was=rider,is=supportId==='fh.lift',kind=was&&!is?'exit':!was&&is?'board':is?'ride':'wait';
  const expected={...s,x,y,tick:t,supportId};same(f.frame.state,expected);same(f.frame.platforms.events,events);assert.equal(f.frame.status,'ok');assert.equal(f.frame.platforms.status,'ok');assert.equal(f.kind,kind);
  same(f.phases,[{bodyId:lift.id,...after}]);s=expected;
 }
 same(proof.terminal,s);assert.equal(proof.costTicks,s.tick-c.query.initial.tick);assert.equal(s.supportId,c.query.goal.supportId);assert.equal(s.x,c.query.goal.x);assert(s.tick<=c.query.goal.notAfterTick);
 for(const f of m.footholds)for(const wx of [44,64,84])assert(proof.safeIntervals.some(v=>v.supportId===f.id&&v.localXSu===wx*256&&v.fromTick===c.query.initial.tick&&v.throughTick===c.query.initial.tick+c.settings.maxRouteTicks),'explicit timed safe interval');
}
for(const c of read('cases.json')){
 const proof=reports[c.id];assert.equal(proof.status,c.status);assert.equal(proof.canCertify,false);assert.equal(proof.complete,false);assert.equal(proof.heuristic,'zero');
 if(c.costTicks!==undefined){assert.equal(proof.costTicks,c.costTicks);vertical(c,proof,read(c.map));}else same(proof.frames,[]);
}
// Check that the clear endpoint beyond a thin blocker does not authorize carrying through it.
const narrow=read('narrow.map.json'),wall=narrow.bodies.find(b=>b.id==='body.wall').shapes[0].rect;assert(wall[0]>64+12&&wall[0]+wall[2]<144-12);same(reports['narrow-rider-sweep'].frames,[]);
// Independent departure equation: carry first, jump, gravity, then add platform delta exactly once.
const d=read('departure.fixture.json'),dm=read(d.map),p=read(d.profile),motion=dm.bodies[0].motion,jump=p.abilities.find(a=>a.kind==='jump'),delta=phase(motion,1).offsetSu.map((v,i)=>v-phase(motion,0).offsetSu[i]);
let s=d.initial;for(let i=0;i<d.expect.length;i++){const first=i===0,vx=first?delta[0]:s.vx,vy=first?-jump.impulse+p.air.gravity+delta[1]:s.vy+p.air.gravity;
 const expected={...s,x:s.x+(first?delta[0]:s.vx),y:s.y+(first?delta[1]-jump.impulse:s.vy),vx,vy,mode:'air',supportId:null,tick:s.tick+1,jumpHeldPrev:true,ticksSinceJump:s.ticksSinceJump+1};same(d.expect[i].state,expected);s=expected;}
const loaded=readBundle(bundle,schemas);assert(loaded.ok,'independent exported timed load: '+JSON.stringify(loaded.diagnostics));
const manifest=JSON.parse(readFileSync(join(bundle,'manifest.json'),'utf8')),docs=manifest.documents.map(d=>JSON.parse(readFileSync(join(bundle,d.path),'utf8'))),exported=docs.find(d=>d.id==='map.timed-platform');
// Contract features are an unordered set; export canonicalizes their key/version order.
// Compare every value while independently accounting for that published ordering rule.
const expectedMap=read('elevator.map.json');expectedMap.requiredFeatures.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:a.version-b.version);
same(exported,expectedMap,'exported timed document binding');same(docs.find(d=>d.id===p.id),p,'exported timed document binding');
vertical(read('cases.json')[0],reports['wait-board-ride-exit'],exported);
console.log(JSON.stringify({verified:true,exportedPeriodicWorld:true,cases:read('cases.json').length}));
