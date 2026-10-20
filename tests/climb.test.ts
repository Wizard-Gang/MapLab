import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,mkdtempSync,realpathSync,mkdirSync,writeFileSync,cpSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';
import {expect,test} from 'vitest';
import {createWorld,step,overlaps,replay,replayBytes,digest,validateClimbs,type ContactMap,type ClimbState,type RunInput,type Trace} from '../src/physics-reference';
import type {MovementDocument} from '../src/contracts/movement-types';
import {authorClimb} from '../src/editor/climb';
import {modelOf} from './history-support';
import {denormalize} from '../src/domain/model';
import {openDocument,commit,undo,redo} from '../src/editor/history';
import type {JsonValue} from '../src/contracts';
import type {ClimbPath} from '../src/physics-reference/climb';
const root=process.cwd(),folder=join(root,'conformance/climb');
const read=<T>(file:string):T=>JSON.parse(readFileSync(join(folder,file),'utf8')) as T;
interface Fixture {id:string;map:string;profile:string;initial:ClimbState;input:RunInput[];ticks:number;expect:{status:string;checkpoints:{tick:number;state:ClimbState;contacts:unknown[]}[];traceSha256:string}}
const cases=read<{license:string;cases:string[]}>('cases.json');
const fixture=(name:string)=>read<Fixture>(name+'.fixture.json');
const docs=(c:Fixture):[ContactMap,MovementDocument]=>[read(c.map),read(c.profile)];
const run=(name:string):Promise<Trace>=>{const c=fixture(name);return replay(...docs(c),c.initial,c.input,c.ticks);};
const controls={moveX:0 as const,moveY:-1 as const,run:false,jump:false,drop:false};
test('owned climb package pins every final source, checkpoint and trace byte',()=>{
 expect(cases.license).toBe('CC0-1.0');const index=read<{files:{path:string;sha256:string}[]}>('index.json');
 expect(index.files.map(f=>f.path).sort()).toEqual(readdirSync(folder).filter(f=>f!=='index.json').sort());
 for(const f of index.files)expect(createHash('sha256').update(readFileSync(join(folder,f.path))).digest('hex'),f.path).toBe(f.sha256);
});
test.each(cases.cases)('exact integer states, contacts, replay resume and repeat: %s',async file=>{
 const c=read<Fixture>(file),[m,p]=docs(c),before=JSON.stringify([m,p,c]);const t=await replay(m,p,c.initial,c.input,c.ticks),w=createWorld(m,p);
 expect(t.scope).toBe('climb');expect(t.canCertify).toBe(false);expect(t.frames.at(-1)!.status).toBe(c.expect.status);
 expect(t.frames.map(f=>({tick:f.state.tick,state:f.state,contacts:f.contacts}))).toEqual(c.expect.checkpoints);
 expect(t.traceSha256).toBe(c.expect.traceSha256);expect(replayBytes(t)+'\n').toBe(readFileSync(join(folder,file.replace('.fixture.json','.trace.json')),'utf8'));
 expect(replayBytes(t)).toBe(replayBytes(await replay(m,p,c.initial,c.input,c.ticks)));expect(JSON.stringify([m,p,c])).toBe(before);
 const {traceSha256,...body}=t;expect(await digest(body)).toBe(traceSha256);
 for(const f of t.frames){expect(overlaps(w,f.state.x,f.state.y)).toBe(false);expect(f.state.resources).toEqual(c.initial.resources);if(f.state.mode==='climb')expect(f.state.supportId).toBeNull();}
 if(t.frames.length>1){const cut=Math.floor(t.frames.length/2),state=t.frames[cut-1]!.state,active=c.input.filter(v=>v.fromTick<=state.tick).at(-1)!;
 expect((await replay(m,p,state,[{...active,fromTick:state.tick},...c.input.filter(v=>v.fromTick>state.tick)],c.ticks-cut)).frames).toEqual(t.frames.slice(cut));}
});
test('independent arithmetic pins ladder speed, top/bottom/midpoint supports and blocked headroom',async()=>{
 const up=await run('ladder-bottom-top'),down=await run('ladder-top-bottom');
 for(let n=1;n<72;n++){expect(up.frames[n-1]!.state).toMatchObject({x:100*256,y:300*256-n*512,vy:-512,vx:0,mode:'climb',supportId:null,traversalId:'traversal.ladder'});expect(down.frames[n-1]!.state.y).toBe(156*256+n*512);}
 expect(up.frames.at(-1)!.state).toMatchObject({y:156*256,mode:'ground',supportId:'fh.elevated',traversalId:null});
 expect(down.frames.at(-1)!.state).toMatchObject({y:300*256,mode:'ground',supportId:'fh.floor'});
 expect((await run('ladder-midpoint')).frames.at(-1)!.state).toMatchObject({y:228*256,supportId:'fh.midpoint'});
 const blocked=await run('blocked-exit');expect(blocked.frames.at(-1)!.state).toMatchObject({y:(120+48)*256,mode:'climb',supportId:null});expect(blocked.frames.at(-1)!.contacts[0]).toMatchObject({bodyId:'body.ceiling',shapeId:'shape.ceiling'});
 const c=fixture('blocked-exit');expect(validateClimbs(createWorld(...docs(c)))).toContainEqual({code:'invalidGroundedAccess',traversalId:'traversal.ladder',accessId:'access.top',profileId:'movement.climb-fixture',controller:'maplab.reference-controller@1'});
});
test('rope radius, leap-off impulse, airborne end fall, no implicit endpoint exit, and rearm',async()=>{
 expect((await run('airborne-rope')).frames[0]!.state).toMatchObject({mode:'climb',x:100*256,y:238*256});
 expect((await run('rope-radius-miss')).frames[0]!.state.mode).toBe('air');
 expect((await run('rope-leap-off')).frames[2]!.state).toMatchObject({mode:'air',traversalId:null,vx:1024-48,vy:-1536+96,x:100*256+1024-48,y:236*256-1536,climbReady:false});
 expect((await run('rope-airborne-end')).frames.at(-1)!.state).toMatchObject({mode:'air',supportId:null,traversalId:null,climbReady:false,y:250*256+288,vy:288});
 expect((await run('endpoint-no-exit')).frames.slice(1).every(f=>f.state.mode==='climb'&&f.state.y===100*256&&f.state.vy===0)).toBe(true);
 const c=fixture('airborne-rope'),w=createWorld(...docs(c)),s={...c.initial,climbReady:false};
 expect(step(w,s,controls).state.mode).toBe('air');const ready=step(w,s,{...controls,moveY:0}).state;expect(ready.climbReady).toBe(true);expect(step(w,ready,controls).state.mode).toBe('climb');
});
test('forest ladder and finite-footprint west jump use the owned source without source edits',async()=>{
 expect(readFileSync(join(folder,'forest.map.json'))).toEqual(readFileSync(join(root,'conformance/jump/forest-source.map.json')));
 expect((await run('forest-ladder')).frames.at(-1)!.state).toMatchObject({mode:'ground',supportId:'fh.elevated',y:496*256});
 const t=await run('forest-rope');expect(t.frames.findIndex(f=>f.state.mode==='climb')).toBe(12);expect(t.frames.at(-1)!.state.traversalId).toBe('traversal.rope');
 expect((await run('west-jump-tick10')).frames[10]!.state).toMatchObject({mode:'climb',traversalId:'traversal.rope'});
});
test('missing permissions, tags, direction and unsupported conditions never grant movement',async()=>{
 const c=fixture('ladder-bottom-top'),[m,p]=docs(c);
 for(const profile of [{...p,abilities:p.abilities.filter(a=>a.kind!=='climb')},{...p,abilityTags:[]},{...p,abilities:p.abilities.map(a=>a.kind==='climb'?{...a,ladder:false}:a)}]){
 const w=createWorld(m,profile);expect(validateClimbs(w).some(d=>d.code==='missingClimbPermission')).toBe(true);expect(step(w,c.initial,controls).state.mode).toBe('ground');}
 expect((await run('direction-denied')).frames.every(f=>f.state.y===156*256&&f.state.vy===0)).toBe(true);
 expect((await run('unsupported-condition')).frames[0]!.status).toBe('unsupported');
 const path=m.traversals[0] as ClimbPath;
 const gated={...m,traversals:[{...path,access:path.access.map(a=>({...a,conditions:[{kind:'ability' as const,tag:'absent'}]}))}]};
 expect(step(createWorld(gated,p),c.initial,controls).state.mode).toBe('ground');expect(validateClimbs(createWorld(gated,p)).some(d=>d.code==='conditionDenied')).toBe(true);
 const advanced={...p,abilities:[...p.abilities,{kind:'grapple' as const,version:1 as const,range:100,reelSpeed:1,swingGravity:{num:1,den:1},lengthRange:[1,100] as const,solver:{key:'custom.swing',version:1}}]};
 // An enabled ability with no solver remains unsupported in this controller subset.
 expect(step(createWorld(m,advanced),c.initial,controls).status).toBe('unsupported');
});
test('stale attachment, malformed controls, overlapping pose and body-swept grab refuse atomically',()=>{
 const c=fixture('airborne-rope'),[m,p]=docs(c),w=createWorld(m,p),s=step(w,c.initial,controls).state;
 for(const state of [{...s,traversalId:'missing'},{...s,x:s.x+1},{...s,supportId:'fh.floor'},{...s,vy:17},{...s,climbReady:undefined}]){const f=step(w,state as never,controls);expect(f.status).toBe('invalidState');expect(f.state).toBe(state);}
 expect(step(w,c.initial,{...controls,moveY:2 as never}).status).toBe('invalidState');expect(step(w,c.initial,{...controls,dash:true} as never).status).toBe('unsupported');
 const body={...m.bodies[0]!,id:'body.wall',shapes:[{id:'shape.wall',kind:'segment' as const,a:[105,150] as const,b:[105,260] as const}]};
 const blocked=createWorld({...m,bodies:[...m.bodies,body]},{...p,collider:{kind:'rect',width:2,height:48}});
 expect(step(blocked,c.initial,controls).state.mode).toBe('air');
});
test('authoring validates bounded anchors/IDs/geometry, supports explicit access, and undoes in one step',()=>{
 const c=fixture('ladder-bottom-top'),[m]=docs(c),path=m.traversals[0] as ClimbPath,model=modelOf({...m,traversals:[]} as unknown as JsonValue),start=openDocument(model);
 const added=commit(start,authorClimb(model,path));expect(added.outcome).toBe('recorded');expect(denormalize(added.state.model).traversals).toEqual([path]);
 expect(denormalize(undo(added.state).model)).toEqual(denormalize(start.model));expect(denormalize(redo(undo(added.state)).model)).toEqual(denormalize(added.state.model));
 for(const bad of [{...path,points:[[100,100],[110,300]]},{...path,grabRadius:-1},{...path,access:path.access.map(a=>({...a,pathU:2}))},{...path,access:[{...path.access[0]!,anchor:{kind:'world',point:[0,0]}}]},{...path,id:m.bodies[0]!.id}])expect(()=>authorClimb(model,bad as ClimbPath)).toThrow();
 const edited=commit(added.state,authorClimb(added.state.model,{...path,direction:'down',grabRadius:8}));expect(edited.outcome).toBe('recorded');expect(denormalize(undo(edited.state).model)).toEqual(denormalize(added.state.model));
});
test('isolated independent final-byte consumer uses no editor, server or storage',()=>{
 const dir=realpathSync(mkdtempSync(join(realpathSync(tmpdir()),'maplab-climb-consumer-')));
 try{writeFileSync(join(dir,'package.json'),'{"type":"module"}');for(const f of ['schemas','contracts'])cpSync(join(root,f),join(dir,f),{recursive:true});
 for(const f of ['contracts','physics-reference']){mkdirSync(join(dir,'src',f),{recursive:true});for(const file of readdirSync(join(root,'src',f)).filter(s=>s.endsWith('.ts'))){const source=readFileSync(join(root,'src',f,file),'utf8');if(f==='physics-reference')expect(source).not.toMatch(/from ['"].*(?:editor|library|render|react|node:)/);writeFileSync(join(dir,'src',f,file.replace(/\.ts$/,'.js')),stripTypeScriptTypes(source).replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g,(all,a:string,b:string,c:string)=>b.endsWith('.json')?all:a+b+'.js'+c));}}
 cpSync(join(root,'tests/consumer/contact.mjs'),join(dir,'consumer.mjs'));
 for(const file of cases.cases){const t=JSON.parse(execFileSync(process.execPath,[join(dir,'consumer.mjs'),join(folder,file)],{cwd:dir,encoding:'utf8'}));expect(replayBytes(t)+'\n').toBe(readFileSync(join(folder,file.replace('.fixture.json','.trace.json')),'utf8'));const {traceSha256,...body}=t;expect(createHash('sha256').update(replayBytes(body)).digest('hex')).toBe(traceSha256);}
 }finally{rmSync(dir,{recursive:true,force:true});}
},30_000);

test('access modes, conditions, planes and stable-ID ties are honored at entry and exit',()=>{
 const c=fixture('ladder-bottom-top'),[m,p]=docs(c),path=m.traversals[0] as ClimbPath;
 const noEntry={...path,access:path.access.map(a=>({...a,entry:'none' as const}))};expect(step(createWorld({...m,traversals:[noEntry]},p),c.initial,controls).state.mode).toBe('ground');
 const plane={...m.layers.find(l=>l.kind==='actors')!,id:'layer.climb'};const a={...path,id:'traversal.a',planeId:plane.id},z={...path,id:'traversal.z',access:path.access.map(v=>({...v,id:v.id+'-z'}))};
 for(const traversals of [[z,a],[a,z]]){const w=createWorld({...m,layers:[...m.layers,plane],traversals},p);const mounted=step(w,c.initial,{...controls,moveX:-1});expect(mounted.state).toMatchObject({traversalId:'traversal.a',planeId:'layer.climb',facing:1});}
 const denyExit={...path,access:path.access.map(v=>v.pathU===0?{...v,conditions:[{kind:'ability' as const,tag:'missing'}]}:v)};
 const w=createWorld({...m,traversals:[denyExit]},p),s={...c.initial,mode:'climb' as const,supportId:null,traversalId:path.id,y:158*256,vy:-512};expect(step(w,s,controls).state).toMatchObject({mode:'climb',y:156*256,vy:0});
 const air=fixture('airborne-rope'),[rope]=docs(air),r=rope.traversals[0] as ClimbPath;
 const noAir={...r,access:r.access.map(v=>({...v,entry:'grounded' as const}))};expect(step(createWorld({...rope,traversals:[noAir]},p),air.initial,controls).state.mode).toBe('air');
 const either={...r,access:r.access.map(v=>({...v,entry:'either' as const,exit:'either' as const}))};expect(step(createWorld({...rope,traversals:[either]},p),air.initial,controls).state.mode).toBe('climb');
 const noGround={...m,footholds:m.footholds.filter(f=>f.id!=='fh.elevated'),traversals:[{...path,access:path.access.map(v=>v.pathU===0?{...v,anchor:{kind:'world' as const,point:[100,156] as const}}:v)}]};expect(validateClimbs(createWorld(noGround,p)).some(d=>d.code==='invalidGroundedAccess')).toBe(true);
});
