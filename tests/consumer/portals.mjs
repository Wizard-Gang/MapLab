// Independent owned-corpus portal proof: Node built-ins plus the separate final-byte reader.
// No MapLab runtime/controller/editor imports. Qualified to neutral input and flat arrival floors.
import {readFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {readBundle} from './reader/read-bundle.mjs';import {parseStrict,jcs} from './reader/json.mjs';
const [bundle,schemas,fixtures]=process.argv.slice(2),read=p=>parseStrict(readFileSync(p)),assert=(v,m)=>{if(!v)throw Error(m);},hash=b=>createHash('sha256').update(b).digest('hex');
for(const f of read(join(fixtures,'index.json')).files)assert(hash(readFileSync(join(fixtures,f.path)))===f.sha256,'fixture byte integrity');
const loaded=readBundle(bundle,schemas);assert(loaded.ok,'independent load: '+JSON.stringify(loaded.diagnostics));
const manifest=read(join(bundle,'manifest.json')),docs=new Map(manifest.documents.map(d=>[d.id,read(join(bundle,d.path))])),maps=new Map([...docs].filter(([,d])=>d.format==='maplab.map')),catalogs=[...docs.values()].filter(d=>d.format==='maplab.catalog').flatMap(c=>c.entries);
const input=read(join(fixtures,'journey.input.json')),expected=read(join(fixtures,'journey.expected.json')),profile=docs.get('movement.player');
assert(profile.collider.kind==='rect','rectangular actor');assert(input.input.every(i=>i.moveX===0&&i.moveY===0&&i.run===false&&i.jump===false&&i.drop===false),'owned neutral schedule scope');
let map=maps.get(manifest.entryMapId),tick=input.initial.tick,state=input.initial,flags,bodies,encounters,once,pending=null,travels=[];
const initialize=()=>{flags=Object.fromEntries(map.flags.map(f=>[f.id,f.initial]));bodies=Object.fromEntries(map.bodies.map(b=>[b.id,b.enabled]));encounters=Object.fromEntries(map.encounters.map(e=>[e.id,'inactive']));once=new Set();};
const condition=c=>{if(c.kind==='flag')return flags[c.id]===c.equals;if(c.kind==='ability')return profile.abilityTags.includes(c.tag);if(c.kind==='not')return !condition(c.term);if(c.kind==='all')return c.terms.every(condition);if(c.kind==='any')return c.terms.some(condition);throw Error('unsupported oracle condition');};
function overlap(region,pose){assert(region.shape.kind==='rect','owned rectangular trigger scope');const [x,y,w,h]=region.shape.rect,px=pose.x/256,py=pose.y/256;return px+profile.collider.width/2>x&&px-profile.collider.width/2<x+w&&py>y&&py-profile.collider.height<y+h;}
function action(call){assert(catalogs.some(c=>c.kind==='action'&&c.key===call.key&&c.version===call.version),'action catalog kind');const p=call.params;
 if(call.key==='core.encounter.activate'){const e=map.encounters.find(e=>e.id===p.target.ref.id);assert(e&&p.target.ref.kind==='encounter','encounter reference');if(encounters[e.id]==='inactive')encounters[e.id]='active';}
 else if(call.key==='core.flag.set'){assert(p.flag.ref.kind==='flag'&&Object.hasOwn(flags,p.flag.ref.id),'flag reference');flags[p.flag.ref.id]=p.value;}
 else if(call.key==='core.body.set-enabled'){assert(p.target.ref.kind==='body'&&Object.hasOwn(bodies,p.target.ref.id),'body reference');bodies[p.target.ref.id]=p.enabled;}
 else throw Error('unsupported oracle action');
}
function initialTriggers(){for(const t of [...map.triggers].sort((a,b)=>a.id.localeCompare(b.id))){if(t.event!=='enter'||!t.actorCategories.includes('player')||!overlap(map.regions.find(r=>r.id===t.regionId),state)||!t.conditions.every(condition)||once.has(t.id))continue;if(t.once)once.add(t.id);t.actions.forEach(action);}}
function arrival(target,id){const entity=target.entities.find(e=>e.id===id&&e.enabled);assert(entity,'enabled arrival identity');const a=entity.anchor;assert(a.kind==='surface'&&a.normalOffset===0,'owned flat surface arrival scope');const f=target.footholds.find(f=>f.id===a.footholdId&&f.enabled),b=target.bodies.find(b=>b.id===f?.ownerBodyId&&b.enabled);assert(f&&b&&b.mobility==='static'&&f.a[1]===f.b[1],'construct static flat floor');const x=b.position[0]+f.a[0]+Math.floor((f.b[0]-f.a[0])*a.u*256)/256,y=b.position[1]+f.a[1],half=profile.collider.width/2;
 assert(x-half>=b.position[0]+Math.min(f.a[0],f.b[0])&&x+half<=b.position[0]+Math.max(f.a[0],f.b[0]),'full footprint support');
 for(const body of target.bodies.filter(b=>b.enabled))for(const s of body.shapes){if(s.kind==='rect'){const [rx,ry,w,h]=s.rect,X=rx+body.position[0],Y=ry+body.position[1];assert(!(x+half>X&&x-half<X+w&&y>Y&&y-profile.collider.height<Y+h),'arrival collider overlap');}else if(s.kind==='segment'){assert(s.a[0]===s.b[0],'owned vertical edge scope');const wall=body.position[0]+s.a[0];assert(!(x-half<wall&&x+half>wall),'arrival edge clearance');}else throw Error('owned destination collision scope');}
 return {x:x*256,y:y*256,vx:0,vy:0,mode:'ground',supportId:f.id,planeId:f.planeId??target.layers.find(l=>l.kind==='actors')?.id??null,facing:entity.facing==='left'?-1:1,tick,jumpHeldPrev:false,jumpReleased:false,ticksSinceJump:0,dropSuppression:null,resources:{airJumps:0,dashCharges:0,cooldowns:{}},traversalId:null,climbReady:true};
}
function command(c){
 if(c.kind==='inject'){const e=map.encounters.find(e=>e.id===c.encounterId);assert(e&&encounters[e.id]==='active'&&jcs(e.completionEvent)===jcs(c.event)&&catalogs.some(d=>d.kind==='event'&&d.key===c.event.key&&d.version===c.event.version),'explicit declared active completion');encounters[e.id]='completed';e.onComplete.forEach(action);}
 else if(c.kind==='interact'){const p=map.entities.find(e=>e.id===c.portalId&&e.kind==='portal'&&e.enabled);assert(p&&p.activation==='interact'&&overlap(map.regions.find(r=>r.id===p.regionId),state)&&p.conditions.every(condition),'portal activation/flag');assert(maps.has(p.destination.mapId),'captured target map');pending={p,left:p.delayTicks};if(!pending.left)travel();}
 else throw Error('unknown oracle command');
}
function travel(){const p=pending.p,target=maps.get(p.destination.mapId),fromMap=map.id,next=arrival(target,p.destination.entityId);travels.push({tick,fromMap,portalId:p.id,toMap:target.id,entityId:p.destination.entityId,arrival:next});map=target;state=next;pending=null;initialize();initialTriggers();}
initialize();initialTriggers();let commandIndex=0;const boundary=n=>{while(input.commands?.[commandIndex]?.afterTicks===n)command(input.commands[commandIndex++]);};boundary(0);
for(let n=0;n<input.ticks;n++){tick++;state={...state,tick};if(pending&&--pending.left===0)travel();boundary(n+1);}
assert(jcs({mapId:map.id,state,travels})===jcs({mapId:expected.mapId,state:expected.state,travels:expected.travels}),'independent portal arrival/delay trace');assert(jcs(flags)===jcs(expected.gameplay.flags)&&jcs(bodies)===jcs(expected.gameplay.bodies)&&jcs(encounters)===jcs(expected.gameplay.encounters),'fresh destination runtime state');
console.log(JSON.stringify({verified:true,mapId:map.id,transitions:travels.length,bundleSha256:loaded.bundleSha256,claims:{independentLoad:true,floorCollision:true,fullFootprintArrival:true,combat:false,engineParity:false}}));
