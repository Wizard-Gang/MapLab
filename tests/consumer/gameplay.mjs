// Isolated final-byte oracle. Standard libraries only, no editor/controller/runtime imports.
import {readFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
const root=process.argv[2],read=p=>JSON.parse(readFileSync(join(root,p),'utf8')),assert=(v,m)=>{if(!v)throw Error(m);},canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
for(const f of read('index.json').files)assert(createHash('sha256').update(readFileSync(join(root,f.path))).digest('hex')===f.sha256,'final byte hash');
const definitions=read('sources/catalogs/core.catalog.json').entries;let events=0,actions=0;
function intervals(shape,a){
 const x=a.from.x,y=a.from.y,dx=a.to.x-x,dy=a.to.y-y,half=a.width/2,h=a.height;
 if(shape.kind==='rect'||shape.kind==='polygon'){
  let box;if(shape.kind==='rect')box=shape.rect.map(n=>n*256);else{
   // This owned polygon oracle accepts only its four-corner rectangle corpus.
   const p=shape.points.map(p=>p.map(n=>n*256)),xs=p.map(p=>p[0]),ys=p.map(p=>p[1]),lx=Math.min(...xs),hx=Math.max(...xs),ly=Math.min(...ys),hy=Math.max(...ys);assert(p.length===4&&new Set(p.map(p=>p.join(','))).size===4&&p.every(p=>[lx,hx].includes(p[0])&&[ly,hy].includes(p[1])),'owned polygon oracle scope');box=[lx,ly,hx-lx,hy-ly];
  }
  const low=[box[0]-half,box[1]],high=[box[0]+box[2]+half,box[1]+box[3]+h],start=[x,y],speed=[dx,dy];let lo=-Infinity,hi=Infinity;
  for(let n=0;n<2;n++){if(speed[n]===0){if(start[n]<=low[n]||start[n]>=high[n])return [];continue;}const t0=(low[n]-start[n])/speed[n],t1=(high[n]-start[n])/speed[n];lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));}return lo<hi&&hi>0&&lo<1?[{lo,hi}]:[];
 }
 // Independent nearest-point piecewise quadratic, rather than union of rounded corners.
 const [cx,cy]=shape.center.map(n=>n*256),r=shape.radius*256,cuts=[0,1];for(const [start,speed,values] of [[x,dx,[cx-half,cx+half]],[y,dy,[cy,cy+h]]])if(speed)for(const v of values){const t=(v-start)/speed;if(t>0&&t<1)cuts.push(t);}cuts.sort((a,b)=>a-b);const out=[];
 for(let n=0;n<cuts.length-1;n++){const l=cuts[n],u=cuts[n+1],mid=(l+u)/2,px=x+dx*mid,py=y+dy*mid;let ax=0,bx=0,ay=0,by=0;if(px<cx-half){ax=-dx;bx=cx-half-x;}else if(px>cx+half){ax=dx;bx=x-cx-half;}if(py<cy){ay=-dy;by=cy-y;}else if(py>cy+h){ay=dy;by=y-cy-h;}
  const aa=ax*ax+ay*ay,bb=2*(ax*bx+ay*by),cc=bx*bx+by*by-r*r;if(!aa){if(cc<0)out.push({lo:l,hi:u});continue;}const disc=bb*bb-4*aa*cc;if(disc<=0)continue;const lo=Math.max(l,(-bb-Math.sqrt(disc))/(2*aa)),hi=Math.min(u,(-bb+Math.sqrt(disc))/(2*aa));if(lo<hi)out.push({lo,hi});
 }
 const merged=[];for(const s of out){const last=merged.at(-1);if(last&&s.lo<=last.hi)last.hi=Math.max(last.hi,s.hi);else merged.push(s);}return merged;
}
function inside(shape,p,a){if(shape.kind==='circle'){const [cx,cy]=shape.center.map(n=>n*256),xx=Math.max(p.x-a.width/2,Math.min(cx,p.x+a.width/2)),yy=Math.max(p.y-a.height,Math.min(cy,p.y));return (xx-cx)**2+(yy-cy)**2<(shape.radius*256)**2;}const b=shape.kind==='rect'?shape.rect:[Math.min(...shape.points.map(p=>p[0])),Math.min(...shape.points.map(p=>p[1])),Math.max(...shape.points.map(p=>p[0]))-Math.min(...shape.points.map(p=>p[0])),Math.max(...shape.points.map(p=>p[1]))-Math.min(...shape.points.map(p=>p[1]))];return p.x+a.width/2>b[0]*256&&p.x-a.width/2<(b[0]+b[2])*256&&p.y>b[1]*256&&p.y-a.height<(b[1]+b[3])*256;}
for(const c of read('cases.json')){
 const m=c.map,result=read(c.id+'.expected.json'),v={tick:0,status:'ready',diagnostics:[],flags:Object.fromEntries(m.flags.map(f=>[f.id,f.initial])),bodies:Object.fromEntries(m.bodies.map(b=>[b.id,b.enabled])),entities:Object.fromEntries(m.entities.map(e=>[e.id,e.enabled])),encounters:Object.fromEntries(m.encounters.map(e=>[e.id,'inactive'])),once:[],overlaps:[],events:[],actions:[]};
 function apply(call,owner,tick){assert(definitions.some(e=>e.kind==='action'&&e.key===call.key&&e.version===call.version),'action kind');const p=call.params;
  if(call.key==='core.flag.set')v.flags[p.flag.ref.id]=p.value;
  else if(call.key==='core.body.set-enabled')v.bodies[p.target.ref.id]=p.enabled;
  else if(call.key==='core.encounter.activate'){const e=m.encounters.find(e=>e.id===p.target.ref.id);assert(v.encounters[e.id]==='inactive','single activation');v.encounters[e.id]='active';for(const id of e.spawnIds)v.entities[id]=true;}
  else throw Error('oracle action scope');v.actions.push({tick,ownerId:owner,key:call.key,status:'applied',detail:'Test declarative subset'});
 }
 for(const s of c.steps){if(s.event){assert(definitions.some(d=>d.kind==='event'&&d.key===s.event.key&&d.version===s.event.version),'event kind');const e=m.encounters.find(e=>e.id===s.encounterId);assert(e&&canonical(e.completionEvent)===canonical(s.event)&&v.encounters[e.id]==='active','explicit active completion');v.encounters[e.id]='completed';for(const a of e.onComplete)apply(a,e.id,v.tick);continue;}
  const flags={...v.flags},pending=[],queue=[],overlaps=[];
  for(const a of [...s.actors].sort((a,b)=>a.id.localeCompare(b.id)))for(const t of [...m.triggers].sort((a,b)=>a.id.localeCompare(b.id))){if(!t.actorCategories.includes(a.category))continue;const shape=m.regions.find(r=>r.id===t.regionId).shape,end=inside(shape,a.to,a);if(end)overlaps.push(a.id+'\0'+t.id);
   const push=(event,time)=>{if(t.event!==event)return;assert(t.conditions.every(c=>c.kind==='flag'),'oracle condition scope');pending.push({tick:s.tick,time,actorId:a.id,triggerId:t.id,event,condition:t.conditions.every(c=>flags[c.id]===c.equals)?'passed':'blocked'});};
   if(s.initial){if(end)push('enter',0);}else for(const span of intervals(shape,a)){if(span.lo>=0&&span.lo<1&&!(span.lo===0&&inside(shape,a.from,a)))push('enter',span.lo);if(span.hi>0&&span.hi<=1&&!(span.hi===1&&end))push('exit',span.hi);}
  }
  pending.sort((a,b)=>a.time-b.time||a.actorId.localeCompare(b.actorId)||a.triggerId.localeCompare(b.triggerId)||(a.event==='enter'?-1:1));
  for(const event of pending){v.events.push(event);const t=m.triggers.find(t=>t.id===event.triggerId);if(event.condition!=='passed'||t.once&&v.once.includes(t.id))continue;if(t.once)v.once.push(t.id);for(const a of t.actions)queue.push([a,t.id]);}
  v.once.sort();v.tick=s.tick;v.overlaps=overlaps;for(const [a,id] of queue)apply(a,id,s.tick);
 }
 assert(canonical(v)===canonical(result),'independent full-body timing, boundary order and declarative effects: '+c.id);events+=v.events.length;actions+=v.actions.length;
}
process.stdout.write(JSON.stringify({verified:true,cases:read('cases.json').length,events,actions}));
