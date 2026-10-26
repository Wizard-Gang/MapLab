// Isolated Node-only final-byte consumer. No application, controller or solver imports.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.argv[2],read=p=>JSON.parse(readFileSync(join(root,p),'utf8')),fail=m=>{throw Error(m);};
const sha=b=>createHash('sha256').update(b).digest('hex'),canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
for(const f of read('index.json').files)if(sha(readFileSync(join(root,f.path)))!==f.sha256)fail('Fixture digest');
const cases=read('cases.json'),map=read('source.map.json'),p=read('player.movement.json'),proof=read('empty-corridor.witness.json'),reports=JSON.parse(readFileSync(process.argv[3],'utf8'));
const intersects=(a,b)=>a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3],box=cases.blocker.boundsSu;
if(cases.license!=='CC0-1.0'||!intersects(proof.dependencies.sweptBoundsSu,box))fail('Owned empty-space case');
for(const body of map.bodies)for(const shape of body.shapes){if(shape.kind!=='rect')fail('Unsupported consumer fixture shape');const [x,y,w,h]=shape.rect,b=[(x+body.position[0])*256,(y+body.position[1])*256,(x+w+body.position[0])*256,(y+h+body.position[1])*256];if(intersects(box,b))fail('Blocker must occupy formerly empty space');}
const half=p.collider.width*128,height=p.collider.height*256;
for(const [name,report]of Object.entries(reports)){
 if(report.format!=='maplab.runtime-blocker-preview'||report.version!==1||report.result.canCertify!==false||report.result.complete!==false||!['candidate','no route found within declared search/sampling budget'].includes(report.result.status))fail('Qualified runtime contract');
 for(const edge of report.result.edges){
  const d=edge.dependencies;if(sha(canonical({identity:d.identity,sweptBoundsSu:d.sweptBoundsSu,initial:edge.initial,input:edge.input,frames:edge.frames}))!==d.sha256)fail('Witness dependency digest');
  if(canonical(edge.terminal)!==canonical(edge.frames.at(-1).state)||edge.frames.length!==edge.costTicks||edge.terminal.supportId===edge.initial.supportId)fail('Terminal state');
  let swept=[edge.initial.x-half,edge.initial.y-height,edge.initial.x+half,edge.initial.y];
  for(const [n,frame]of edge.frames.entries()){
   const s=frame.state;if(frame.status!=='ok'||s.tick!==edge.initial.tick+n+1)fail('Frame contract');const b=[s.x-half,s.y-height,s.x+half,s.y];
   swept=[Math.min(swept[0],b[0]),Math.min(swept[1],b[1]),Math.max(swept[2],b[2]),Math.max(swept[3],b[3])];
   for(const blocker of report.blockers){const a=blocker.boundsSu;if(b[0]<a[2]&&a[0]<b[2]&&b[1]<a[3]&&a[1]<b[3])fail('Obsolete witness intersects live blocker');}
  }
  if(canonical(swept)!==canonical(d.sweptBoundsSu))fail('Empty-space swept dependency');
 }
 if(name==='blocked'&&(!report.disabledKeys.includes(proof.key)||report.result.edges.length||report.cacheWarm))fail('Empty-space invalidation');
}
if(!reports.baseline.result.edges.some(e=>e.key===proof.key)||canonical(reports.baseline.result.edges)!==canonical(reports.restored.result.edges)||!reports.restored.regenerationBoundsSu)fail('Removal regeneration');
console.log(JSON.stringify({verified:true,emptySpaceInvalidation:true,deletionReopens:true,witnesses:reports.restored.result.edges.length}));
