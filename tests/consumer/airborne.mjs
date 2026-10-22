// Independent final-byte numerical/contract verifier. No MapLab implementation imports.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.argv[2],read=p=>JSON.parse(readFileSync(join(root,p),'utf8'));
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const sha=v=>createHash('sha256').update(canonical(v)).digest('hex'),fail=m=>{throw Error(m);};
for(const f of read('index.json').files)if(createHash('sha256').update(readFileSync(join(root,f.path))).digest('hex')!==f.sha256)fail('file digest');
let witnesses=0,forest=0,drop=0,fall=0;
for(const c of read('cases.json').cases){
 const g=read(c.id+'.actions.json'),map=read(c.map),p=read(c.profile),half=p.collider.width*128,height=p.collider.height*256;
 if(g.canCertify!==false||g.complete!==false||g.status==='budget'||g.status==='unsupported'||g.status==='cancelled')fail('claim/status');
 if(['ceiling','narrow','short','enemy'].includes(c.id)&&g.edges.length)fail('negative fixture');
 if(c.id==='corner'&&(g.edges.some(e=>e.initial.x===480*256&&e.initial.vx===1024&&e.terminal.supportId==='fh.east')||!g.rejected['wall-or-ceiling']))fail('finite corner');
 for(const e of g.edges){witnesses++;
  if(e.status!=='verified reachable with replay witness'||e.costTicks!==e.frames.length||e.kind==='jump'&&!p.abilities.some(a=>a.kind==='jump'))fail('witness contract');
  if(canonical(e.terminal)!==canonical(e.frames.at(-1).state)||e.initial.mode!=='ground'||e.terminal.mode!=='ground'||e.initial.supportId===e.terminal.supportId)fail('terminal');
  const to=g.intervals.find(i=>i.key===e.toInterval),from=g.intervals.find(i=>i.key===e.fromInterval);
  if(!to||!from||to.supportId!==e.terminal.supportId||e.terminal.x<to.minX||e.terminal.x>to.maxX)fail('destination');
  let airborne=false,minX=e.initial.x-half,maxX=e.initial.x+half,minY=e.initial.y-height,maxY=e.initial.y;
  for(const [n,f] of e.frames.entries()){
   const s=f.state;if(f.status!=='ok'||s.tick!==e.initial.tick+n+1||![s.x,s.y,s.vx,s.vy].every(Number.isSafeInteger))fail('frame');
   if(s.mode==='air')airborne=true;else if(airborne&&n!==e.frames.length-1)fail('intervening first landing');
   if(s.x-half<map.bounds[0]*256||s.x+half>(map.bounds[0]+map.bounds[2])*256||s.y-height<map.bounds[1]*256||s.y>(map.bounds[1]+map.bounds[3])*256)fail('bounds');
   for(const b of map.bodies.filter(b=>b.enabled))for(const shape of b.shapes){
    if(shape.kind!=='rect')fail('consumer fixture geometry');
    const [x,y,w,h]=shape.rect.map((v,i)=>v*256+(i===0?b.position[0]*256:i===1?b.position[1]*256:0));
    if(s.x+half>x&&s.x-half<x+w&&s.y>y&&s.y-height<y+h)fail('full body overlap');
   }
   minX=Math.min(minX,s.x-half);maxX=Math.max(maxX,s.x+half);minY=Math.min(minY,s.y-height);maxY=Math.max(maxY,s.y);
  }
  if(!airborne)fail('airborne action');
  const dep=e.dependencies;if(canonical(dep.identity)!==canonical(g.identity)||canonical(dep.sweptBoundsSu)!==canonical([minX,minY,maxX,maxY])||dep.sha256!==sha({identity:dep.identity,sweptBoundsSu:dep.sweptBoundsSu,initial:e.initial,input:e.input,frames:e.frames}))fail('dependency hash');
  if(e.key!==sha({initial:e.initial,input:e.input,to:to.key,kind:e.kind}))fail('key');
  // The canonical fixed-height forest jump: independent integer equations at EVERY tick.
  if(c.id==='forest'&&e.initial.x===480*256&&e.initial.vx===1024&&e.terminal.supportId==='fh.east'){
   if(e.costTicks!==45||e.terminal.x!==660*256||e.kind!=='jump')fail('forest landing');
   for(let n=1;n<=45;n++){const s=e.frames[n-1].state;
    if(s.x!==(480*256+n*1024)||s.y!==300*256-n*2112+96*n*(n-1)/2||s.vy!==(n===45?0:-2112+96*n))fail('forest equation');
   }forest++;
  }
  if(c.id==='drop'&&e.kind==='drop'&&e.initial.x===64*256&&e.initial.vx===0&&e.input.every(i=>i.moveX===0)){
   if(e.initial.supportId==='fh.elevated'&&e.terminal.supportId!=='fh.lower')fail('selected group');
   if(e.initial.supportId==='fh.elevated'||e.initial.supportId==='fh.same-group')for(let n=1;n<=e.frames.length;n++){
    const s=e.frames[n-1].state,expectedY=Math.min(166*256,e.initial.y+96*n*(n-1)/2);
    if(s.y!==expectedY||s.vy!==(n===e.frames.length?0:96*n)||s.dropSuppression?.group!=='drop.upper'||s.dropSuppression.ticksLeft!==30-n)fail('drop equation/suppression');
   }drop++;
  }
  if(c.id==='fall'&&e.kind==='fall'){if(e.input.some(i=>i.jump||i.drop))fail('fall controls');fall++;}
 }
}
if(!forest||!drop||!fall)fail('required independent numerical witnesses');
process.stdout.write(JSON.stringify({cases:read('cases.json').cases.length,witnesses,forest,drop,fall,verified:true}));
