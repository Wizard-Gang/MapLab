// Independent final-byte importer + restricted integer dash equations. No editor/controller imports.
import {readFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {readBundle} from './reader/read-bundle.mjs';import {equations} from './dash-equations.mjs';
const [folder,reportPath,bundle,schemas]=process.argv.slice(2),read=f=>JSON.parse(readFileSync(join(folder,f),'utf8')),reports=JSON.parse(readFileSync(reportPath,'utf8'));
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const sha=v=>createHash('sha256').update(canonical(v)).digest('hex'),hash=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b,message='independent dash equation')=>assert.deepEqual(a,b,message);
const normalize=p=>({...p,mask:[...p.mask].sort(),abilityTags:[...p.abilityTags].sort(),forbiddenMaterialTags:[...p.forbiddenMaterialTags].sort(),abilities:[...p.abilities].sort((a,b)=>a.kind<b.kind?-1:a.kind>b.kind?1:(a.mode??'')<(b.mode??'')?-1:(a.mode??'')>(b.mode??'')?1:0)});
const ix=read('index.json');assert.equal(ix.license,'CC0-1.0');for(const f of ix.files){assert(!f.path.startsWith('/')&&!f.path.split('/').includes('..'));assert.equal(hash(readFileSync(join(folder,f.path))),f.sha256);}
const cases=read('cases.json');for(const name of cases.cases){const c=read(name),computed=equations(read(c.map),read(c.profile),c.initial,c.input,c.ticks);same(computed.frames,c.expect);same(computed.events,c.events);same(reports.cases[name],computed.frames);}
const loaded=readBundle(bundle,schemas);assert(loaded.ok,'independent final-byte import: '+JSON.stringify(loaded.diagnostics));
const manifest=JSON.parse(readFileSync(join(bundle,'manifest.json'),'utf8')),docs=manifest.documents.map(d=>JSON.parse(readFileSync(join(bundle,d.path),'utf8'))),map=docs.find(d=>d.id===manifest.entryMapId),p=docs.find(d=>d.id==='movement.dash');
same(p,normalize(read('player.movement.json')),'exported profile binding');
const expectedMap=read('chain.map.json');for(const key of ['dependencies','bodies','footholds'])expectedMap[key].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);expectedMap.requiredFeatures.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:a.version-b.version);same(map,expectedMap,'exported world binding');
const proof=reports.proof;assert.equal(proof.status,'verified reachable with replay witness');assert.equal(proof.heuristic,'zero');assert.equal(proof.canCertify,false);assert.equal(proof.complete,false);same(proof.goals,[cases.route.goal]);
const normalized=normalize(p);
assert.equal(proof.identity.profileSha256,sha(normalized));const contracts=read('contracts.json');assert.equal(proof.identity.controllerSha256,sha({base:contracts.baseControllerSha256,dashAdapterSha256:contracts.dashAdapterSha256}));
assert.equal(proof.identity.cacheKey,sha({worldSha256:proof.identity.worldSha256,profileSha256:proof.identity.profileSha256,controllerSha256:proof.identity.controllerSha256,settingsSha256:proof.identity.settingsSha256}));assert.equal(proof.querySha256,sha({initial:proof.initial,goals:proof.goals,algorithm:proof.algorithm}));
const computed=equations(map,p,proof.initial,proof.input,proof.frames.length);same(proof.frames.map(f=>({status:f.status,state:f.state})),computed.frames);same(computed.frames.at(-1).state,proof.terminal);assert.equal(proof.durationTicks,proof.frames.length);
assert(computed.events.filter(e=>e.kind==='dashStart').length>=2,'each chained gap uses a dash');
let prior=proof.initial,cost=0;const combined=[];for(const action of proof.actions){same(action.initial,prior,'resource-compatible joins');assert.equal(action.durationTicks,action.frames.length);assert(action.durationTicks>0&&action.durationTicks<=proof.settings.maxActionTicks);same(action.terminal,action.frames.at(-1).state);combined.push(...action.frames);cost+=action.durationTicks+action.penaltyTicks;prior=action.terminal;}same(combined,proof.frames);same(prior,proof.terminal);assert.equal(cost,proof.costTicks);assert.equal(proof.dependencies.sha256,sha({identity:proof.identity,initial:proof.initial,goals:proof.goals,actions:proof.actions,frames:proof.frames}));
const half=p.collider.width*128,height=p.collider.height*256;prior=proof.initial;
for(const f of proof.frames){const s=f.state;assert([s.x,s.y,s.vx,s.vy,s.tick,s.resources.dashCharges].every(Number.isSafeInteger));assert.equal(s.resources.dashCharges,s.dash.remaining.ground+s.dash.remaining.air);for(const a of p.abilities.filter(a=>a.kind==='dash')){assert(s.dash.remaining[a.mode]>=0&&s.dash.remaining[a.mode]<=a.charges);assert(s.resources.cooldowns['dash.'+a.mode]>=0&&s.resources.cooldowns['dash.'+a.mode]<=a.cooldownTicks);}
 assert(s.x-half>=map.bounds[0]*256&&s.x+half<=(map.bounds[0]+map.bounds[2])*256&&s.y-height>=map.bounds[1]*256&&s.y<=(map.bounds[1]+map.bounds[3])*256);
 for(const b of map.bodies)for(const sh of b.shapes){assert.equal(sh.kind,'rect');const [x,y,w,h]=sh.rect.map((v,i)=>(v+(i===0?b.position[0]:i===1?b.position[1]:0))*256);assert(!(s.x+half>x&&s.x-half<x+w&&s.y>y&&s.y-height<y+h),'finite body clearance');if(prior.y>y&&prior.y-height<y+h)assert(!(Math.max(prior.x,s.x)+half>x&&Math.min(prior.x,s.x)-half<x+w),'finite X sweep');}
 if(s.mode==='ground')assert(f.contacts.some(c=>c.kind==='support'&&c.supportId===s.supportId));prior=s;
}
assert(['budget','no route found within declared search/sampling budget'].includes(reports.noneProof.status));same(reports.noneProof.frames,[]);same(reports.noneProof.actions,[]);
console.log(JSON.stringify({verified:true,cases:cases.cases.length,chainedRoute:true,finalByteImport:true}));
