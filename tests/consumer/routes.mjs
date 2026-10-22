// Isolated final-byte oracle for the owned flat-rect/fixed-jump route corpus.
// Imports only Node standard libraries, never MapLab, the graph solver or its controller.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.argv[2],read=f=>JSON.parse(readFileSync(join(root,f),'utf8'));
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const sha=v=>createHash('sha256').update(canonical(v)).digest('hex'),assert=(x,m)=>{if(!x)throw Error(m);};
for(const f of read('index.json').files)assert(createHash('sha256').update(readFileSync(join(root,f.path))).digest('hex')===f.sha256,'fixture hash');
const map=read('forest.map.json');let ticks=0,routes=0;
const contracts=read('contracts.json'),sort=a=>[...a].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
assert(contracts.controller.key==='maplab.reference-controller'&&contracts.controller.version===1&&contracts.controller.sha256==='1e36b7364146fe1fc75b1540b099e57babad7aae575699f1d68184784a573b02','reference controller pin');
for(const c of read('cases.json')){
 const proof=read(c.id+'.proof.json'),p=read(c.profile),half=p.collider.width*128,height=p.collider.height*256;
 assert(proof.canCertify===false&&proof.complete===false,'scope');
 const region=c.kind==='region'?{targetRegionId:c.regionId}:{};assert(c.kind==='region'?proof.targetRegionId===c.regionId:proof.targetRegionId===undefined,'region query identity');
 assert(proof.querySha256===sha({initial:proof.initial,goals:proof.goals,algorithm:proof.algorithm,...region}),'query hash');
 const profile={...p,mask:[...p.mask].sort(),abilityTags:[...p.abilityTags].sort(),forbiddenMaterialTags:[...p.forbiddenMaterialTags].sort(),abilities:[...p.abilities].sort((a,b)=>a.kind<b.kind?-1:1)};
 const world=sha({mapId:map.id,version:map.version,bounds:map.bounds,collision:map.collisionContract,bodies:sort(map.bodies),footholds:sort(map.footholds),materials:sort(map.materials),traversals:sort(map.traversals),regions:sort(map.regions),navigation:map.navigation,planes:map.layers.filter(l=>l.kind==='actors').map(l=>l.id)});
 const surface=sha({solver:'surface-climb@3',latticeSu:1,fullBody:true,maxSamples:proof.settings.air.maxClearanceSamples,maxTicks:3600}),airSurface=sha({solver:'surface-climb@3',latticeSu:1,fullBody:true,maxSamples:2000000,maxTicks:3600});
 const airborne=sha({solver:'single-airborne@1',surfaceSolver:airSurface,...proof.settings.air});
 const settings=sha({solver:'augmented-reference-routes@1',surfaceSolver:surface,airborneSolver:airborne,settings:proof.settings,routeIntent:{waypoints:sort(map.waypoints),routes:sort(map.routes),entities:sort(map.entities).map(({id,enabled,anchor,facing,...e})=>({id,enabled,anchor,facing,...('movementId' in e?{movementId:e.movementId}:{}),...('ai' in e?{ai:e.ai}:{})}))}});
 const identity={worldSha256:world,profileSha256:sha(profile),controllerSha256:contracts.controller.sha256,settingsSha256:settings};assert(canonical(proof.identity)===canonical({...identity,cacheKey:sha(identity)}),'final source/profile/controller/solver binding');
 if(c.kind!=='patrol')assert(canonical(proof.goals)===canonical([c.goal]),'declared goal identity');
 if(proof.status!=='verified reachable with replay witness'){assert(proof.actions.length===0&&proof.frames.length===0&&proof.input.length===0&&proof.terminal===null&&proof.costTicks===0&&proof.durationTicks===0&&proof.dependencies.sweptBoundsSu===null,'no partial failed proof');assert(proof.dependencies.sha256===sha({identity:proof.identity,initial:proof.initial,goals:proof.goals,status:proof.status,...region}),'failed dependency proof');}
 if(c.id==='enemy-gap'||c.id==='enemy-region'){assert(proof.status==='no route found within declared search/sampling budget'&&proof.frames.length===0&&!p.abilities.some(a=>a.kind==='jump'),'no jump boundary');continue;}
 if(c.id==='impossible-stance'){
  assert(proof.status==='proven unreachable'&&proof.frames.length===0,'stance status');const g=proof.goals[0],f=map.footholds.find(f=>f.id===g.supportId);
  assert(f&&Math.max(f.a[0]*256+half,g.x-g.toleranceSu)>Math.min(f.b[0]*256-half,g.x+g.toleranceSu),'bounded stance proof');continue;
 }
 assert(proof.status==='verified reachable with replay witness'&&proof.initial&&proof.terminal,'verified reference route');routes++;
 assert(proof.durationTicks===proof.frames.length&&proof.durationTicks<=proof.settings.maxRouteTicks,'duration');
 let previous=proof.initial,at=0,jumpReleased=previous.jumpReleased,jumpHeld=previous.jumpHeldPrev,since=previous.ticksSinceJump;
 for(const f of proof.frames){
  while(proof.input[at+1]&&proof.input[at+1].fromTick<=previous.tick)at++;
  const input=proof.input[at];assert(input&&input.fromTick<=previous.tick&&!input.drop&&input.moveY===0,'fixed fixture controls');
  let {x,y,vx,vy,mode,supportId}=previous;
  const jump=p.abilities.find(a=>a.kind==='jump');
  if(input.jump&&!jumpHeld&&mode==='ground'&&jump){vy=-jump.impulse;mode='air';supportId=null;since=0;jumpReleased=false;}
  const target=input.moveX*(mode==='ground'?(input.run?p.ground.runSpeed:p.ground.walkSpeed):p.air.maxSpeed),accel=mode==='ground'?(input.moveX===0?p.ground.braking:p.ground.acceleration):p.air.acceleration;
  vx=vx<target?Math.min(target,vx+accel):Math.max(target,vx-accel);x+=vx;
  const floors=map.footholds.filter(f=>f.enabled&&f.a[1]===f.b[1]&&f.a[0]*256<=x-half&&f.b[0]*256>=x+half).map(f=>({id:f.id,y:f.a[1]*256})).sort((a,b)=>a.y-b.y||(a.id<b.id?-1:1));
  if(mode==='ground'){
   const floor=floors.find(f=>f.id===supportId&&f.y-y<=p.ground.snapDistance);
   if(floor){y=floor.y;vy=0;}else{mode='air';supportId=null;vy=0;}
  }
  if(mode==='air'){
   const landing=vy>=0?floors.find(f=>previous.y<=f.y&&y<=f.y&&y+vy>=f.y):null;
   if(landing){y=landing.y;vy=0;mode='ground';supportId=landing.id;}
   else{y+=vy;vy=Math.min(p.air.maxFall,vy+p.air.gravity);if(jump&&vy<0&&!jumpReleased&&jumpHeld&&!input.jump){assert(jump.release.num===jump.release.den,'fixed release');jumpReleased=true;}}
  }
  const s=f.state;assert(f.status==='ok'&&[x,y,vx,vy].every(Number.isSafeInteger),'integer frame');
  assert(canonical([s.x,s.y,s.vx,s.vy,s.mode,s.supportId,s.tick])===canonical([x,y,vx,vy,mode,supportId,previous.tick+1]),'independent tick equation/first landing');
  jumpHeld=input.jump;since=mode==='air'?since+1:0;
  assert(s.jumpHeldPrev===jumpHeld&&s.jumpReleased===jumpReleased&&s.ticksSinceJump===since,'input-edge state');
  assert(canonical(s.resources)===canonical({airJumps:0,dashCharges:0,cooldowns:{}})&&s.dropSuppression===null&&s.traversalId===null,'resources');
  assert(s.x-half>=map.bounds[0]*256&&s.x+half<=(map.bounds[0]+map.bounds[2])*256&&s.y-height>=map.bounds[1]*256&&s.y<=(map.bounds[1]+map.bounds[3])*256,'finite body bounds');
  for(const body of map.bodies.filter(b=>b.enabled))for(const shape of body.shapes){assert(shape.kind==='rect','oracle geometry');const [bx,by,bw,bh]=shape.rect.map((v,i)=>v*256+(i===0?body.position[0]*256:i===1?body.position[1]*256:0));assert(!(s.x+half>bx&&s.x-half<bx+bw&&s.y>by&&s.y-height<by+bh),'full rect clearance');if(previous.y>by&&previous.y-height<by+bh)assert(!(Math.max(previous.x,s.x)+half>bx&&Math.min(previous.x,s.x)-half<bx+bw),'horizontal sweep');}
  if(mode==='ground')assert(f.contacts.some(c=>c.supportId===supportId&&c.kind==='support'),'support contact sequence');else assert(f.contacts.length===0,'clear airborne frame');
  previous=s;ticks++;
 }
 assert(canonical(previous)===canonical(proof.terminal),'terminal');
 let state=proof.initial,index=0,cost=0;
 for(const action of proof.actions){assert(action.durationTicks<=(action.kind==='wait'?3600:proof.settings.maxActionTicks),'action duration limit');assert(canonical(action.initial)===canonical(state)&&action.durationTicks===action.frames.length&&action.durationTicks>0&&Number.isSafeInteger(action.penaltyTicks)&&action.penaltyTicks>=0,'compatible exact action join');
  assert(action.input.length&&action.input[0].fromTick===action.initial.tick&&action.input.every((c,i)=>Number.isSafeInteger(c.fromTick)&&c.fromTick<action.initial.tick+action.durationTicks&&(i===0||c.fromTick>action.input[i-1].fromTick)),'bounded RLE schedule');
  assert(action.key===sha({start:action.initial,input:action.input,kind:action.kind,refinedFrom:action.refinedFrom}),'action key');let at=0;
  for(const f of action.frames){assert(canonical(f)===canonical(proof.frames[index]),'whole route frame');const tick=index+proof.initial.tick;while(action.input[at+1]&&action.input[at+1].fromTick<=tick)at++;const global=proof.input.filter(i=>i.fromTick<=tick).at(-1),{fromTick:_,...a}=action.input[at],{fromTick:__,...b}=global;assert(canonical(a)===canonical(b),'whole route control');index++;}
  state=action.terminal;cost+=action.durationTicks+action.penaltyTicks;
 }
 assert(index===proof.frames.length&&cost===proof.costTicks&&canonical(state)===canonical(proof.terminal),'whole route cost');
 const g=proof.goals.at(-1);assert(state.mode==='ground'&&state.supportId===g.supportId&&Math.abs(state.x-g.x)<=g.toleranceSu&&state.vx===g.vx&&state.vy===0,'goal constraint');
 if(c.kind==='region'){const target=map.regions.find(r=>r.id===c.regionId);assert(target?.shape.kind==='rect','owned region oracle shape');const [x,y,w,h]=target.shape.rect;assert(state.x>=x*256&&state.x<=(x+w)*256&&state.y>=y*256&&state.y<=(y+h)*256,'actual terminal inside target region');}
 const all=[proof.initial,...proof.frames.map(f=>f.state)],bounds=[Math.min(...all.map(s=>s.x-half)),Math.min(...all.map(s=>s.y-height)),Math.max(...all.map(s=>s.x+half)),Math.max(...all.map(s=>s.y))];
 assert(canonical(bounds)===canonical(proof.dependencies.sweptBoundsSu)&&proof.dependencies.sha256===sha({identity:proof.identity,initial:proof.initial,goals:proof.goals,actions:proof.actions,frames:proof.frames,...region}),'full dependency proof');
 if(c.kind==='patrol'){const waits=proof.actions.filter(a=>a.kind==='wait');assert(canonical(waits.map(a=>a.durationTicks))===canonical([3,2,3,2,3]),'all patrol waits/return legs');
  const points=[map.waypoints[0],map.waypoints[1],map.waypoints[0],map.waypoints[1],map.waypoints[0]];assert(waits.length===proof.goals.length,'patrol leg count');
  for(let n=0;n<points.length;n++){const point=points[n],g=proof.goals[n],s=waits[n].terminal;assert(point.anchor.kind==='world'&&g.x===point.anchor.point[0]*256&&Math.abs(s.x-g.x)<=g.toleranceSu&&s.supportId===g.supportId&&s.vx===0&&s.mode==='ground','all ordered waypoint arrivals');}
  const key=s=>{const {tick:_,...rest}=s;return canonical(rest);};assert(key(waits[2].terminal)===key(waits[4].terminal),'closed repeat resource boundary');}
}
// Independent Bellman-Ford cost oracle, including directed and zero-cost portal cases.
for(const c of read('cost-cases.json')){const distances=new Map(c.graph.nodes.map(n=>[n.id,n.id===c.from?0:Infinity]));for(let n=1;n<c.graph.nodes.length;n++)for(const e of c.graph.edges)distances.set(e.to,Math.min(distances.get(e.to),distances.get(e.from)+e.ticks+e.penalty));assert(distances.get(c.to)===c.cost,'independent graph cost');}
process.stdout.write(JSON.stringify({routes,ticks,cases:read('cases.json').length,verified:true}));
