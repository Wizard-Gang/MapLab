// Independent final-byte oracle. Node standard library only; no MapLab runtime imports.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.argv[2],read=p=>JSON.parse(readFileSync(join(root,p),'utf8'));
const index=read('index.json');assert.equal(index.license,'CC0-1.0');
for(const f of index.files){assert(!f.path.startsWith('/')&&!f.path.split('/').includes('..'));assert.equal(createHash('sha256').update(readFileSync(join(root,f.path))).digest('hex'),f.sha256,f.path);}
const close=(a,b,label)=>assert(Math.abs(a-b)<1e-8,`${label}: ${a} != ${b}`),vec=(a,b,label)=>{assert.equal(a.length,b.length);a.forEach((v,i)=>close(v,b[i],label));};
const winners=(zones,map,state,collider)=>zones.filter(z=>{const shape=map.regions.find(r=>r.id===z.regionId).shape;assert.equal(shape.kind,'rect','oracle rect qualification');const [x,y,w,h]=shape.rect;return state.x/256+collider.width/2>x&&state.x/256-collider.width/2<x+w&&state.y/256>y&&state.y/256-collider.height<y+h;}).sort((a,b)=>(b.priority??0)-(a.priority??0)||(a.id<b.id?-1:a.id>b.id?1:0));
const cases=read('cases.json');assert.deepEqual(cases.map(c=>c.id),['short-jump','tall-jump-repeat','ladder','stacked-floors','long-drop','small-bounds','boss-lock','zone-ties','audio-fade','lookahead','damping-reset']);
let samples=0;
for(const c of cases){
 const map=read(c.map),views=read(c.id+'.expected.json');assert.equal(views.length,c.observations.length);let prev=null;
 for(const [i,v] of views.entries()){
  const o=c.observations[i],s=o.state;assert.equal(v.tick,s.tick);assert.deepEqual(v.identity,{key:'maplab.reference-camera-preview',version:1,canCertifyEngine:false});assert.equal(v.mapId,map.id);
  const zones=winners(c.camera.zones,map,s,c.collider);assert.equal(v.zoneId,zones[0]?.id??null);assert.deepEqual(v.activeZoneIds,zones.map(z=>z.id));
  const env=winners(c.environment.zones,map,s,c.collider),audio=env.find(z=>z.kind==='audio'),visual=env.find(z=>z.kind==='transition');assert.equal(v.environment.audio.zoneId,audio?.id??null);assert.equal(v.environment.audio.trackAssetId,audio?.trackAssetId??null);assert.equal(v.environment.visualZoneId,visual?.id??null);
  const e=v.effective,[x,y,w,h]=e.bounds,W=e.viewWU[0]/e.zoom,H=e.viewWU[1]/e.zoom;
  vec(v.view,[v.center[0]-W/2,v.center[1]-H/2,W,H],c.id+' viewport');vec(v.letterboxWU,[Math.max(0,(W-w)/2),Math.max(0,(H-h)/2)],c.id+' letterbox');
  vec(v.deadZoneWorld,[v.view[0]+W*e.deadZone[0],v.view[1]+H*e.deadZone[1],W*e.deadZone[2],H*e.deadZone[3]],c.id+' deadzone');
  for(const [at,start,length,size,locked] of [[0,x,w,W,!e.followX],[1,y,h,H,!e.followY||e.verticalPolicy==='locked']]){
   if(length<size||locked)close(v.center[at],start+length/2,c.id+' locked center');else assert(v.center[at]>=start+size/2-1e-8&&v.center[at]<=start+length-size/2+1e-8,c.id+' visible confinement');
  }
  if(i&& !o.reset)assert.equal(s.tick,c.observations[i-1].state.tick+1);
  if(c.id==='boss-lock'&&i){const t=Math.min(i,24)/24,p=t*t*(3-2*t),a=c.camera.defaults,b=c.camera.zones[0].settings;for(const k of ['viewWU','bounds','deadZone','dampingTicks','lookaheadWU'])vec(e[k],a[k].map((n,j)=>n+(b[k][j]-n)*p),'boss blend '+k);close(e.zoom,a.zoom+(b.zoom-a.zoom)*p,'boss zoom');if(i<=24){assert.equal(v.transition.elapsedTicks,i);close(v.transition.progress,p,'boss curve');}else assert.equal(v.transition,null);}
  if(c.id==='short-jump')close(v.center[1],616,'short jump Y hold');
  if(c.id==='stacked-floors'&&(i===2||i===4))close(v.center[1],s.y/256-c.collider.height/2,'higher support snap');
  if(c.id==='lookahead')vec(v.center,[[640,616],[664,628],[616,648]][i],'capped lookahead');
  if(c.id==='damping-reset')vec(v.center,[[640,616],[650,616],[657.5,616],[680,616],[680,616]][i],'damping/reset');
  if(c.id==='audio-fade')close(v.environment.audio.progress,[1,.25,.5,.75,1,.5,1,.5,1][i],'audio fade');
  prev=v;samples++;
 }
 if(c.id==='ladder')close(prev.center[1],472,'ladder upper support');
 if(c.id==='long-drop'){assert(views.at(-1).center[1]>1900);assert(c.observations.at(-1).state.mode==='ground');}
 if(c.id==='tall-jump-repeat')assert(Math.min(...views.map(v=>v.center[1]))<570);
 if(c.id==='zone-ties'){assert(views[0].warnings.some(w=>w.includes('camera.a')));assert.equal(views[0].environment.audio.zoneId,'audio.a');assert.equal(views[0].environment.visualZoneId,'visual.a');}
}
assert.equal(samples,530);
console.log(JSON.stringify({verified:true,identity:'maplab.reference-camera-preview@1',cases:11,samples,qualification:'owned rect-zone numerical corpus; no engine parity'}));
