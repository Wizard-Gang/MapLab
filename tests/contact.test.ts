import { createHash } from 'node:crypto';
import { readFileSync,readdirSync,mkdtempSync,realpathSync,mkdirSync,writeFileSync,cpSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync } from 'node:child_process';
import { expect,test } from 'vitest';
import { createWorld,step,resolveStance,replay,replayBytes,digest,floorDiv,type ContactMap,type State,type RunInput,type Trace } from '../src/physics-reference';
import type { MovementDocument } from '../src/contracts/movement-types';

const root=process.cwd(),folder=join(root,'conformance/contact');
const read=<T>(path:string):T=>JSON.parse(readFileSync(path,'utf8')) as T;
interface Fixture {id:string;map:string;profile:string;initial:State;input:RunInput[];ticks:number;expect:{status:string;checkpoints:{tick:number;state:State;contacts:unknown[]}[];traceSha256:string}}
const cases=read<{license:string;cases:string[]}>(join(folder,'cases.json'));
const fixture=(name:string):Fixture=>read(join(folder,name+'.fixture.json'));
const docs=(c:Fixture):[ContactMap,MovementDocument]=>[read(join(folder,c.map)),read(join(folder,c.profile))];
const run=(c:Fixture):Promise<Trace>=>replay(...docs(c),c.initial,c.input,c.ticks);

test('owned CC0 fixture index covers every final file and pins its SHA-256',()=>{
 expect(cases.license).toBe('CC0-1.0');
 const index=read<{files:{path:string;sha256:string}[]}>(join(folder,'index.json'));
 expect(index.files.map(f=>f.path).sort()).toEqual(readdirSync(folder).filter(f=>f!=='index.json').sort());
 for(const f of index.files)expect(createHash('sha256').update(readFileSync(join(folder,f.path))).digest('hex'),f.path).toBe(f.sha256);
});

test.each(cases.cases)('exact intermediate replay and repeat: %s',async file=>{
 const c=read<Fixture>(join(folder,file)),[map,p]=docs(c),before=JSON.stringify([map,p,c]);
 const a=await replay(map,p,c.initial,c.input,c.ticks),b=await replay(map,p,c.initial,c.input,c.ticks);
 expect(a.frames.at(-1)?.status).toBe(c.expect.status);
 expect(a.frames.map(f=>({tick:f.state.tick,state:f.state,contacts:f.contacts}))).toEqual(c.expect.checkpoints);
 expect(a.traceSha256).toBe(c.expect.traceSha256);expect(replayBytes(a)).toBe(replayBytes(b));
 expect(JSON.stringify([map,p,c])).toBe(before);
 expect(a.scope).toBe('contact');expect(a.canCertify).toBe(false);
 const {traceSha256,...body}=a;expect(await digest(body)).toBe(traceSha256);
});

test('independently calculated run/brake, lift, wall, ceiling, traction and conveyor numbers',async()=>{
 const runTrace=await run(fixture('run-brake'));
 expect(runTrace.frames.map(f=>f.state.vx)).toEqual([64,128,192,256,256,256,192,128,64,0,0,0]);
 expect(runTrace.frames.at(-1)?.state.x).toBe(64*256+1536);
 for(const name of ['slope-up','slope-down']){
 const c=fixture(name),world=createWorld(...docs(c));
 // w=24 on a -1/2 slope: support at the rightmost bottom point, 6 WU above center line.
 expect(resolveStance(world,64*256)[0]?.y).toBe((68-6)*256);
 const t=await run(c);for(const f of t.frames)expect(f.state.y).toBe(100*256-(f.state.x+12*256)/2);
 }
 expect((await run(fixture('slope-clearance'))).frames[0]?.state).toMatchObject({x:68*256,y:60*256,vx:0});
 expect((await run(fixture('separated-slope-ceilings'))).frames[0]?.state).toMatchObject({x:68*256,y:160*256,vx:0});
 expect((await run(fixture('steep-oneway-ignored'))).frames[0]?.state).toMatchObject({mode:'air',supportId:null,y:82*256});
 expect((await run(fixture('slope-catch-limit'))).frames[0]?.state).toMatchObject({x:58*256,y:65*256,vx:0});
 expect((await run(fixture('fractional-contact-order'))).frames[0]?.contacts[0]?.bodyId).toBe('body.wall-z');
 expect((await run(fixture('thin-wall'))).frames[0]?.state.x).toBe((100-12)*256);
 expect((await run(fixture('ceiling-bump'))).frames[0]?.state).toMatchObject({y:(44+40)*256,vy:96});
 expect((await run(fixture('ice-brake'))).frames.map(f=>f.state.vx)).toEqual([248,240,232,224]);
 expect((await run(fixture('conveyor'))).frames.at(-1)?.state.x).toBe(64*256+4*128);
});

test('tie order is code-unit source identity, independent of body/shape arrays',async()=>{
 const c=fixture('contact-tie'),[m,p]=docs(c),a=await run(c);
 const reversed={...m,bodies:[...m.bodies].reverse().map(b=>({...b,shapes:[...b.shapes].reverse()}))};
 const b=await replay(reversed,p,c.initial,c.input,c.ticks);
 expect(a.frames).toEqual(b.frames);expect(a.frames[0]?.contacts[0]?.bodyId).toBe('body.wall-a');
 expect(a.frames[0]?.contacts[0]?.normal).toEqual([-25600,0]);
 const unregistered=await run(fixture('concave-source-edge'));
 expect(unregistered.frames[0]?.contacts[0]).toMatchObject({bodyId:'body.concave',shapeId:'shape.concave',edgeIndex:0,kind:'unregisteredSupport'});
});

test('blocking witnesses stay at the finite body and resolved X hits are unique',async()=>{
 const slope=(await run(fixture('slope-40-blocking'))).frames[0]!;
 expect(slope.contacts).toHaveLength(1);
 // At y=80 WU the face x is 163840/27 su; the body right is 6068 su.
 expect(slope.contacts[0]?.point).toEqual([6068,20480]);
 const fractional=(await run(fixture('fractional-contact-order'))).frames[0]!;
 // x=25600+y/127.0625; the face meets the body at its top.
 expect(fractional.contacts[0]?.point).toEqual([25720,15360]);
 for(const name of ['slope-40-blocking','fractional-contact-order','slope-catch-limit']){
 const cased=fixture(name),world=createWorld(...docs(cased)),f=(await run(cased)).frames[0]!;
 for(const c of f.contacts.filter(c=>c.kind==='blocking')){
  expect(c.point[0]).toBeGreaterThanOrEqual(f.state.x-12*256-1);
  expect(c.point[0]).toBeLessThanOrEqual(f.state.x+12*256+1);
  expect(c.point[1]).toBeGreaterThanOrEqual(f.state.y-40*256-1);
  expect(c.point[1]).toBeLessThanOrEqual(f.state.y+1);
  const face=world.faces.find(v=>v.bodyId===c.bodyId&&v.shapeId===c.shapeId&&v.edgeIndex===c.edgeIndex)!;
  const dx=face.b[0]-face.a[0],dy=face.b[1]-face.a[1];
  const cross=dx*(c.point[1]-face.a[1])-dy*(c.point[0]-face.a[0]);
  expect(Math.abs(cross)).toBeLessThanOrEqual(Math.max(Math.abs(dx),Math.abs(dy)));
  expect(c.point[0]).toBeGreaterThanOrEqual(Math.min(face.a[0],face.b[0]));
  expect(c.point[0]).toBeLessThanOrEqual(Math.max(face.a[0],face.b[0]));
  expect(c.point[1]).toBeGreaterThanOrEqual(Math.min(face.a[1],face.b[1]));
  expect(c.point[1]).toBeLessThanOrEqual(Math.max(face.a[1],face.b[1]));
 }}
});

test('an earlier uncaught slope replaces a farther X wall contact without tunneling',()=>{
 const c=fixture('slope-catch-limit'),[map,p]=docs(c),body=map.bodies[0]!;
 const wall={...body,id:'body.far-wall',shapes:[{id:'shape.far-wall',kind:'rect' as const,rect:[100,0,1,140] as const}]};
 const result=step(createWorld({...map,bodies:[...map.bodies,wall]},p),c.initial,{moveX:1,run:true});
 expect(result.status).toBe('ok');expect(result.state.x).toBe(58*256);
 const hits=result.contacts.filter(c=>c.axis==='x');
 expect(hits).toHaveLength(1);expect(hits[0]?.bodyId).toBe('body.slope');
});

test('all tied downward blocking contacts are emitted once in source-ID order',()=>{
 const c=fixture('flat-rest'),[m,p]=docs(c),base=createWorld(m,p);
 const face={bodyId:'body.segment-z',shapeId:'shape.segment',edgeIndex:0,a:[0,25600] as const,b:[65536,25600] as const,
  normal:[0,-65536] as const,twoSided:true,supportId:null,registered:false,materialId:base.faces[0]!.materialId,planeId:null,links:[],support:false};
 const faces=[face,{...face,bodyId:'body.segment-a'}];
 const state={...c.initial,y:25000,vy:1000,vx:0,mode:'air' as const,supportId:null};
 const a=step({...base,faces,solids:[]},state,{moveX:0,run:false});
 const b=step({...base,faces:[...faces].reverse(),solids:[]},state,{moveX:0,run:false});
 expect(a.status).toBe('ok');expect(a).toEqual(b);
 expect(a.state.y).toBe(25600);
 expect(a.contacts.map(c=>c.bodyId)).toEqual(['body.segment-a','body.segment-z']);
 expect(a.contacts.map(c=>c.point)).toEqual([[state.x-12*256,25600],[state.x-12*256,25600]]);
 expect(a.contacts.every(c=>c.normal[1]===-65536)).toBe(true);
});

test('input, profile, overlap, stale support, integer and schedule negatives fail explicitly',async()=>{
 const c=fixture('flat-rest'),[m,p]=docs(c),w=createWorld(m,p);
 expect(step(w,{...c.initial,y:c.initial.y+1},{moveX:0,run:false}).status).toBe('invalidState');
 expect(step(w,{...c.initial,supportId:'fh.absent'},{moveX:0,run:false}).status).toBe('invalidState');
 expect(step(w,{...c.initial,x:Number.MAX_SAFE_INTEGER},{moveX:0,run:false}).status).toBe('unsafeInteger');
 expect(step(w,c.initial,{moveX:0,run:false,jump:true} as never).status).toBe('unsupported');
 expect(()=>createWorld(m,{...p,support:'centerFoot'})).toThrow('unsupported');
 expect(()=>createWorld(m,{...p,collider:{kind:'capsule',radius:12,height:40}})).toThrow('unsupported');
 expect(()=>createWorld(m,{...p,ground:{...p.ground,acceleration:0.5}})).toThrow('invalidProfile');
 expect(()=>createWorld({...m,bodies:m.bodies.map(b=>({...b,mobility:'kinematic'}))},p)).toThrow('moving bodies');
 await expect(replay(m,p,c.initial,[{fromTick:1,moveX:0,run:false}],1)).rejects.toThrow('schedule');
 for(let a=-50;a<=50;a++)for(let b=1;b<13;b++)expect(floorDiv(a,b)).toBe(Math.floor(a/b));
 expect(floorDiv(-1,256)).toBe(-1);expect(()=>floorDiv(1,0)).toThrow();
});

test('a final-byte separate-process consumer runs the complete contact matrix without editor/storage imports',()=>{
 const dir=realpathSync(mkdtempSync(join(realpathSync(tmpdir()),'maplab-contact-consumer-')));
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
   expect(result.traceSha256,file).toBe(read<Fixture>(join(folder,file)).expect.traceSha256);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
},30_000);
