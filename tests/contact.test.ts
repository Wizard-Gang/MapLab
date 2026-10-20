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
