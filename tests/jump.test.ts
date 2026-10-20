import { createHash } from 'node:crypto';
import { readFileSync,readdirSync,mkdtempSync,realpathSync,mkdirSync,writeFileSync,cpSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync } from 'node:child_process';
import { expect,test } from 'vitest';
import { createWorld,step,overlaps,replay,replayBytes,digest,type ContactMap,type LocomotionState,type RunInput,type Trace } from '../src/physics-reference';
import type { MovementDocument } from '../src/contracts/movement-types';
const root=process.cwd(),folder=join(root,'conformance/jump');
const read=<T>(path:string):T=>JSON.parse(readFileSync(path,'utf8')) as T;
interface Fixture {id:string;map:string;profile:string;initial:LocomotionState;input:RunInput[];ticks:number;expect:{status:string;checkpoints:{tick:number;state:LocomotionState;contacts:unknown[]}[];traceSha256:string}}
const cases=read<{license:string;cases:string[]}>(join(folder,'cases.json'));
const fixture=(name:string):Fixture=>read(join(folder,name+'.fixture.json'));
const docs=(c:Fixture):[ContactMap,MovementDocument]=>[read(join(folder,c.map)),read(join(folder,c.profile))];
const run=(name:string):Promise<Trace>=>{const c=fixture(name);return replay(...docs(c),c.initial,c.input,c.ticks);};
const controls={moveX:0 as const,run:false,jump:false,drop:false};

test('owned jump index covers final source, checkpoint and published trace bytes',()=>{
 expect(cases.license).toBe('CC0-1.0');
 const index=read<{files:{path:string;sha256:string}[]}>(join(folder,'index.json'));
 expect(index.files.map(f=>f.path).sort()).toEqual(readdirSync(folder).filter(f=>f!=='index.json').sort());
 for(const f of index.files)expect(createHash('sha256').update(readFileSync(join(folder,f.path))).digest('hex'),f.path).toBe(f.sha256);
});

test.each(cases.cases)('exact states, support/resource/contact sequence, resume and repeat: %s',async file=>{
 const c=read<Fixture>(join(folder,file)),[map,p]=docs(c),before=JSON.stringify([map,p,c]);
 const a=await replay(map,p,c.initial,c.input,c.ticks),b=await replay(map,p,c.initial,c.input,c.ticks),w=createWorld(map,p);
 expect(a.frames.at(-1)?.status).toBe(c.expect.status);
 expect(a.frames.map(f=>({tick:f.state.tick,state:f.state,contacts:f.contacts}))).toEqual(c.expect.checkpoints);
 expect(a.traceSha256).toBe(c.expect.traceSha256);expect(replayBytes(a)).toBe(replayBytes(b));
 expect(replayBytes(a)+'\n').toBe(readFileSync(join(folder,file.replace('.fixture.json','.trace.json')),'utf8'));
 expect(JSON.stringify([map,p,c])).toBe(before);expect(a.scope).toBe('jump-fall-drop');expect(a.canCertify).toBe(false);
 const {traceSha256,...body}=a;expect(await digest(body)).toBe(traceSha256);
 for(const f of a.frames){
  expect(overlaps(w,f.state.x,f.state.y)).toBe(false);
  expect(f.state.resources).toEqual({airJumps:0,dashCharges:0,cooldowns:{}});
  for(const contact of f.contacts){
   const face=w.faces.find(v=>v.supportId===contact.supportId&&v.bodyId===contact.bodyId&&v.shapeId===contact.shapeId&&v.edgeIndex===contact.edgeIndex)!;
   expect(contact.normal).toEqual(face.normal);
   const dx=face.b[0]-face.a[0],dy=face.b[1]-face.a[1];
   expect(Math.abs(dx*(contact.point[1]-face.a[1])-dy*(contact.point[0]-face.a[0]))).toBeLessThanOrEqual(Math.max(Math.abs(dx),Math.abs(dy)));
   expect(contact.point[0]).toBeGreaterThanOrEqual(Math.min(face.a[0],face.b[0]));expect(contact.point[0]).toBeLessThanOrEqual(Math.max(face.a[0],face.b[0]));
   expect(contact.point[1]).toBeGreaterThanOrEqual(Math.min(face.a[1],face.b[1]));expect(contact.point[1]).toBeLessThanOrEqual(Math.max(face.a[1],face.b[1]));
   const pose=contact.pose!;
   expect(contact.point[0]).toBeGreaterThanOrEqual(pose.x-w.half-1);expect(contact.point[0]).toBeLessThanOrEqual(pose.x+w.half+1);
   expect(contact.point[1]).toBeGreaterThanOrEqual(pose.y-w.height-1);expect(contact.point[1]).toBeLessThanOrEqual(pose.y+1);
  }
 }
 const cut=Math.floor(a.frames.length/2),state=a.frames[cut-1]!.state;
 const active=c.input.filter(v=>v.fromTick<=state.tick).at(-1)!;
 const schedule=[{...active,fromTick:state.tick},...c.input.filter(v=>v.fromTick>state.tick)];
 const resumed=await replay(map,p,state,schedule,c.ticks-cut);
 expect(resumed.frames).toEqual(a.frames.slice(cut));
});

test('independent closed-form fixed arc proves gap landing, apex and impossible 144 WU rise',async()=>{
 const fixed=await run('fixed-arc'),gap=await run('reachable-gap'),high=await run('impossible-high');
 for(let n=1;n<=44;n++){
  const s=fixed.frames[n-1]!.state;
  expect(s.y).toBe(300*256-n*2112+96*n*(n-1)/2);
  expect(s.vy).toBe(-2112+96*n);expect(s.mode).toBe('air');
 }
 expect(fixed.frames[44]!.state).toMatchObject({y:300*256,vy:0,mode:'ground'});
 expect(Math.min(...fixed.frames.map(f=>f.state.y))).toBe((300-94.875)*256);
 expect(gap.frames[44]!.state).toMatchObject({x:660*256,y:300*256,mode:'ground',supportId:'fh.east'});
 expect(high.frames.every(f=>f.state.supportId!=='fh.elevated')).toBe(true);
 expect(94.875).toBeLessThan(144);
 const source=await run('forest-source-ground-gap');
 expect(source.frames[44]!.state).toMatchObject({x:648*256,y:640*256,supportId:'fh.east',mode:'ground'});
 expect((await run('forest-source-high')).frames.every(f=>f.state.supportId!=='fh.elevated')).toBe(true);
 const blocked=await run('blocked-gap');expect(blocked.frames.at(-1)!.state).toMatchObject({mode:'air',supportId:null});
 expect(blocked.frames.at(-1)!.state.y).toBeGreaterThan(300*256);
});

test('variable hold, release once, button re-press and ground-only rearm have independent integer recurrences',async()=>{
 const held=await run('variable-hold'),early=await run('early-release'),once=await run('release-once');
 // RC4: move, add gravity, then truncate release once. Hold follows the sampled button.
 for(const [trace,release] of [[held,Infinity],[early,2],[once,2]] as const){
  let y=300*256,vy=-2112;
  for(let n=0;n<12;n++){
   y+=vy;const rising=vy<0,holding=n<release||(trace===once&&n===3);vy+=rising&&holding&&n<8?32:96;
   if(n===release&&rising){vy=Math.trunc(vy/2);}
   expect(trace.frames[n]!.state).toMatchObject({y,vy});
  }
 }
 expect(Math.min(...held.frames.map(f=>f.state.y))).toBeLessThan(Math.min(...early.frames.map(f=>f.state.y)));
 const fixed=await run('fixed-arc'),air=await run('no-air-jump');
 expect(air.frames.map(f=>[f.state.y,f.state.vy])).toEqual(fixed.frames.slice(0,20).map(f=>[f.state.y,f.state.vy]));
 expect((await run('no-auto-repeat')).frames.slice(44).every(f=>f.state.mode==='ground')).toBe(true);
 expect((await run('ground-rearm')).frames[47]!.state).toMatchObject({mode:'air',vy:-2016,ticksSinceJump:1});
 expect((await run('no-jump-ability')).frames.every(f=>f.state.mode==='ground')).toBe(true);
});

test('one-way upward and lateral pass, crossing refusal, targeted group, lower landing and rearm',async()=>{
 const upper=await run('upward-pass-downward-land');
 expect(upper.frames.slice(0,23).every(f=>f.state.mode==='air')).toBe(true);
 expect(upper.frames.at(-1)!.state.supportId).toBe('fh.upper');
 expect((await run('crossing-refusal')).frames.every(f=>f.state.mode==='air')).toBe(true);
 expect((await run('upward-side-pass')).frames.every(f=>f.state.vx===1024&&f.state.mode==='air')).toBe(true);
 const drop=await run('targeted-lower-landing');
 // At n=10 the 16 WU drop is crossed: 96*n*(n-1)/2 >= 4096 su.
 expect(drop.frames[8]!.state.y).toBe(150*256+96*9*8/2);
 expect(drop.frames[9]!.state).toMatchObject({y:166*256,mode:'ground',supportId:'fh.lower',dropSuppression:{group:'drop.upper',ticksLeft:20}});
 expect(drop.frames.every(f=>!['fh.elevated','fh.same-group'].includes(f.state.supportId??''))).toBe(true);
 expect((await run('drop-solid-lower')).frames[9]!.state).toMatchObject({y:166*256,mode:'ground',supportId:'fh.lower'});
 const rearm=await run('drop-body-clear-rearm');
 const cleared=rearm.frames.findIndex(f=>f.state.dropSuppression===null);
 expect(cleared).toBeGreaterThan(0);expect(rearm.frames[cleared]!.state.y-48*256).toBeGreaterThan(150*256);
 expect(rearm.frames[cleared-1]!.state.y-48*256).toBeLessThanOrEqual(150*256);
 expect((await run('drop-jump-back')).frames.at(-1)!.state.supportId).toBe('fh.elevated');
 expect((await run('drop-timeout')).frames[0]!.state.dropSuppression).toBeNull();
 for(const name of ['solid-drop-refusal','oneway-drop-refusal'])expect((await run(name)).frames.every(f=>f.state.mode==='ground'&&f.state.dropSuppression===null)).toBe(true);
});

test('continuous finite body sweeps stop ceiling/flank/high-speed floor and partial-edge fall',async()=>{
 const ceiling=await run('low-ceiling');expect(Math.min(...ceiling.frames.map(f=>f.state.y))).toBe((240+48)*256);
 expect(ceiling.frames.flatMap(f=>f.contacts).some(c=>c.bodyId==='body.ceiling'&&c.edgeIndex===2)).toBe(true);
 const wall=await run('finite-jump-wall');expect(wall.frames.at(-1)!.state.x).toBe((90-12)*256);
 expect(wall.frames.flatMap(f=>f.contacts).some(c=>c.bodyId==='body.wall'&&c.edgeIndex===3)).toBe(true);
 const c=fixture('fixed-arc'),w=createWorld(...docs(c));
 const fast=step(w,{...c.initial,y:290*256,vy:3072,mode:'air',supportId:null},controls);
 expect(fast.state).toMatchObject({y:300*256,mode:'ground',supportId:'fh.floor'});
 const fall=await run('edge-fall');expect(fall.frames.slice(0,6).every(f=>f.state.y===300*256)).toBe(true);
 expect(fall.frames.at(-1)!.state.y).toBeGreaterThan(300*256);
});

test('invalid support, partial state, suppression, resources and unimplemented abilities fail atomically',()=>{
 const c=fixture('fixed-arc'),[m,p]=docs(c),w=createWorld(m,p);
 for(const state of [{...c.initial,supportId:'fh.absent'},{...c.initial,resources:{airJumps:1,dashCharges:0,cooldowns:{}}},
  {...c.initial,ticksSinceJump:-1},{...c.initial,jumpReleased:undefined},{...c.initial,dropSuppression:0 as never},{...c.initial,resources:{airJumps:0,dashCharges:0,cooldowns:[] as never}},{...c.initial,dropSuppression:{group:'drop.absent',ticksLeft:1}}]){
  const f=step(w,state as never,controls);expect(f.status).toBe('invalidState');expect(f.state).toBe(state);
 }
 expect(step(w,c.initial,{...controls,jump:undefined} as never).status).toBe('invalidState');
 const noCoyote=step(w,{...c.initial,mode:'air',supportId:null,y:200*256,vy:96},{...controls,jump:true});
 expect(noCoyote.state).toMatchObject({y:200*256+96,vy:192,mode:'air'});
 expect(step(w,c.initial,{...controls,dash:true} as never).status).toBe('unsupported');
 const extra={...p,abilities:[{...p.abilities[0]!,airJumps:1} as never]};
 expect(step(createWorld(m,extra),c.initial,controls).status).toBe('unsupported');
 const climb=read<MovementDocument>(join(root,'conformance/movement/valid/climb.movement.json'));
 expect(step(createWorld(m,{...p,abilities:climb.abilities}),c.initial,controls).status).toBe('unsupported');
 expect(step(w,{...c.initial,ticksSinceJump:Number.MAX_SAFE_INTEGER,y:200*256,mode:'air',supportId:null},controls).status).toBe('unsafeInteger');
 const drop=fixture('targeted-lower-landing'),world=createWorld(...docs(drop));
 const state={...drop.initial,dropSuppression:{group:'drop.upper',ticksLeft:10}};
 expect(step(world,state,controls).status).toBe('invalidState');
 // Nine distinct equal-height candidate supports exercise the contact-budget guard.
 const face=world.faces[0]!;
 const faces=Array.from({length:9},(_,n)=>({...face,supportId:`fh.synthetic-${n}`,a:[0,150*256] as const,b:[200*256,150*256] as const}));
 const air={...drop.initial,y:140*256,vy:3072,mode:'air' as const,supportId:null};
 const result=step({...world,faces},air,controls);expect(result.status).toBe('contactBudget');expect(result.state).toBe(air);expect(result.contacts).toEqual([]);
});

test('isolated independent consumer verifies every published final trace byte and digest',()=>{
 const dir=realpathSync(mkdtempSync(join(realpathSync(tmpdir()),'maplab-jump-consumer-')));
 try{
  writeFileSync(join(dir,'package.json'),'{"type":"module"}');
  for(const folder of ['schemas','contracts'])cpSync(join(root,folder),join(dir,folder),{recursive:true});
  for(const folder of ['contracts','physics-reference']){
   mkdirSync(join(dir,'src',folder),{recursive:true});
   for(const file of readdirSync(join(root,'src',folder)).filter(f=>f.endsWith('.ts'))){
    const source=readFileSync(join(root,'src',folder,file),'utf8');
    if(folder==='physics-reference')expect(source).not.toMatch(/from ['"].*(?:editor|library|render|react|node:)/);
    const code=stripTypeScriptTypes(source).replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g,(all,a:string,b:string,c:string)=>b.endsWith('.json')?all:a+b+'.js'+c);
    writeFileSync(join(dir,'src',folder,file.replace(/\.ts$/,'.js')),code);
   }
  }
  cpSync(join(root,'tests/consumer/contact.mjs'),join(dir,'consumer.mjs'));
  for(const file of cases.cases){
   const result=JSON.parse(execFileSync(process.execPath,[join(dir,'consumer.mjs'),join(folder,file)],{cwd:dir,encoding:'utf8'})) as Trace;
   const published=readFileSync(join(folder,file.replace('.fixture.json','.trace.json')),'utf8');
   expect(replayBytes(result)+'\n',file).toBe(published);
   const {traceSha256,...body}=result;
   expect(createHash('sha256').update(replayBytes(body)).digest('hex')).toBe(traceSha256);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
},30_000);

test('new locomotion contacts preserve source-order determinism and complete unique X groups',async()=>{
 const c=fixture('finite-jump-wall'),[m,p]=docs(c),wall=m.bodies.find(b=>b.id==='body.wall')!;
 const twin={...wall,id:'body.wall-a',shapes:wall.shapes.map(s=>({...s,id:'shape.wall-a'}))};
 // Body top support is unregistered; the tied walls themselves keep exact identities.
 const map={...m,bodies:[...m.bodies,twin]},reversed={...map,bodies:[...map.bodies].reverse(),footholds:[...map.footholds].reverse()};
 const a=await replay(map,p,c.initial,c.input,c.ticks),b=await replay(reversed,p,c.initial,c.input,c.ticks);
 expect(a.frames).toEqual(b.frames);
 const contacts=a.frames.flatMap(f=>f.contacts).filter(c=>c.axis==='x');
 expect(contacts.length).toBeGreaterThan(0);
 for(const f of a.frames){const xs=f.contacts.filter(c=>c.axis==='x');if(xs.length){expect(xs.map(c=>c.bodyId)).toEqual(['body.wall','body.wall-a']);expect(new Set(xs.map(c=>c.bodyId+'/'+c.shapeId+'/'+c.edgeIndex)).size).toBe(xs.length);}}
});
