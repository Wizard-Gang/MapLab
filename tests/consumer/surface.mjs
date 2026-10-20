// Independent final-byte verifier: no implementation imports, editor, storage, DOM or server.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.argv[2],read=p=>JSON.parse(readFileSync(join(root,p),'utf8'));
const cases=read('cases.json').cases;
for(const f of read('index.json').files){if(createHash('sha256').update(readFileSync(join(root,f.path))).digest('hex')!==f.sha256)throw Error('digest');}
for(const c of cases){const g=read(c.id+'.graph.json'),p=read(c.profile),map=read(c.map);if(g.status!=='candidate'||g.canCertify!==false)throw Error('claim');
 for(const i of g.intervals){const fh=map.footholds.find(f=>f.id===i.supportId);if(!fh||i.minX>i.maxX||map.materials.find(m=>m.id===i.materialId).tags.some(t=>p.forbiddenMaterialTags.includes(t)))throw Error('interval');}
 for(const e of g.edges){if(e.frames.length!==e.costTicks||e.frames.some(f=>f.status!=='ok')||!g.nodes.some(n=>n.key===e.to))throw Error('witness');if(e.kind==='climb'&&!p.abilities.some(a=>a.kind==='climb'))throw Error('permission');}
 // Independent three-piece arithmetic: full 24WU body touches C above center92WU.
 if(c.id==='three-hazard'||c.id==='three-direction'){
  const hazard=c.id==='three-hazard',boundary=(104-12)*256;
  if(hazard&&(!g.intervals.length||g.intervals.some(i=>i.maxX>boundary)||g.intervals.find(i=>i.supportId==='fh.a')?.maxX!==boundary))throw Error('third material footprint');
  if(!hazard&&!g.intervals.some(i=>i.supportId==='fh.a'&&i.direction==='bToA'&&i.maxX>boundary))throw Error('third direction split');
  for(const i of g.intervals)if(!hazard&&i.maxX>boundary&&i.direction!=='bToA')throw Error('third direction interval');
  for(const e of g.edges)if(hazard||e.input.moveX===1)for(const s of [e.initial,...e.frames.map(f=>f.state)])if(s.x>boundary)throw Error('third support replay permission');
 }
 if(c.id==='flat-enemy'){const i=g.intervals[0];if(i.minX!==12*256||i.maxX!==244*256||g.edges.length!==2)throw Error('flat arithmetic');}
 if(c.id==='slope-enemy'){const i=g.intervals[0];if(i.supportId!=='fh.slope'||i.minX!==12*256||i.maxX!==52*256)throw Error('slope clearance arithmetic');}
 if(c.id==='narrow-enemy'&&g.intervals.length)throw Error('48WU body in narrower passage');
 if(c.id==='hazard-ban'&&g.intervals.length)throw Error('hazard');
 if(c.id==='directed'&&g.edges.some(e=>e.input.moveX!==1))throw Error('direction');
}
process.stdout.write(JSON.stringify({cases:cases.length,verified:true}));
