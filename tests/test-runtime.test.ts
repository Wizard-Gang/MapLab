import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdtempSync, realpathSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { TestSession, NEUTRAL, MAX_TICKS, parseRecording, type Recording } from '../src/test-runtime/session';
import { replay, replayBytes, type ContactMap, type State, type Step } from '../src/physics-reference';
import type { MovementDocument } from '../src/contracts/movement-types';
const folder='conformance/test-runtime';
const read=<T>(p:string):T=>JSON.parse(readFileSync(p,'utf8')) as T;
const map=()=>read<ContactMap>(folder+'/forest.map.json'),profile=()=>read<MovementDocument>(folder+'/player.movement.json');
const cases=read<{cases:string[]}>(folder+'/cases.json').cases;
const recording=(name=cases[0]!)=>read<Recording>(`${folder}/${name}.input.json`);

test.each(cases)('frozen Test matches pure navigation/controller replay and final owned checkpoints: %s',async name=>{
 const m=map(),p=profile(),r=recording(name),before=replayBytes([m,p,r]);
 const run=new TestSession(m,p,r.initial); run.replay(r);
 const trace=await replay(m,p,r.initial,r.input,r.ticks);
 expect(run.getSnapshot().frames).toEqual(trace.frames);
 expect(trace.frames.every(f=>f.status==='ok')).toBe(true);
 expect(run.recording()).toEqual(r);
 const expected=read<{traceSha256:string;frames:Step[]}>(`${folder}/${name}.expected.json`);
 expect(trace.traceSha256).toBe(expected.traceSha256);expect(trace.frames).toEqual(expected.frames);
 expect(replayBytes([m,p,r])).toBe(before);expect(Object.isFrozen(run.source.traversals[0])).toBe(true);
 run.replay(run.recording()); expect(run.getSnapshot().frames).toEqual(trace.frames);
 expect(trace.canCertify).toBe(false);
});

test('forest checkpoints prove walk/run/jump/climb/drop and tick12 grab, preserving provisional tick10 distinction',()=>{
 const frames=(n:string)=>{const r=recording(n),s=new TestSession(map(),profile(),r.initial);s.replay(r);return s.getSnapshot().frames;};
 const walk=frames('forest-walk-jump');expect(walk[19]?.state.x).toBeGreaterThan(60*256);expect(walk[39]?.state.vx).toBe(1024);expect(walk[40]?.state.mode).toBe('air');expect(walk.at(-1)?.state.supportId).toBe('fh.west');
 const ladder=frames('forest-ladder');expect(ladder[0]?.state.traversalId).toBe('traversal.ladder');expect(ladder.at(-1)?.state).toMatchObject({y:496*256,mode:'ground',supportId:'fh.elevated'});
 const rope=frames('forest-rope');expect(rope[9]?.state.mode).toBe('air');expect(rope[11]?.state.mode).toBe('air');expect(rope[12]?.state).toMatchObject({tick:13,mode:'climb',traversalId:'traversal.rope'});
 const drop=frames('forest-drop');expect(drop[0]?.state.dropSuppression?.group).toBeTruthy();expect(drop.at(-1)?.state).toMatchObject({mode:'ground',supportId:'fh.west',dropSuppression:null});
});

test('pause, step, reset and replay own immutable snapshots without writing author input or runtime views',()=>{
 const m=map(),p=profile(),run=new TestSession(m,p),seed=run.initial,before=replayBytes([m,p]);
 expect(seed).toMatchObject({x:60*256,y:640*256,supportId:'fh.west'});
 expect(run.getSnapshot().paused).toBe(true);run.advance({...NEUTRAL,moveX:1});expect(()=>{(run.getSnapshot().input[0] as {moveX:number}).moveX=-1;}).toThrow();expect(run.getSnapshot().state.tick).toBe(1);expect(run.getSnapshot().paused).toBe(true);
 run.pause(false);expect(run.getSnapshot().paused).toBe(false);run.pause();run.reset();expect(run.getSnapshot().state).toEqual(seed);expect(run.getSnapshot().frames).toEqual([]);
 expect(()=>{(run.getSnapshot().state as {x:number}).x=0;}).toThrow();
 expect(()=>{(run.source as {id:string}).id='map.mutated';}).toThrow();
 (m as {id:string}).id='map.changed';expect(run.source.id).toBe('map.forest');expect(replayBytes([map(),p])).toBe(before);
});

test('malformed/unsupported recordings are refused atomically, and actual controller failures pause without advancing',()=>{
 const run=new TestSession(map(),profile()),r=recording(),snapshot=run.getSnapshot();
 for(const bad of [null,{}, {...r,ticks:MAX_TICKS+1},{...r,ticks:0},{...r,input:[]},{...r,input:[{...r.input[0],fromTick:1}]},{...r,input:[{...r.input[0],dash:true}]},{...r,input:[{...r.input[0],jump:'yes'}]},{...r,input:[r.input[0],r.input[0]]},{...r,initial:{...r.initial,supportId:'fh.missing'}},{...r,initial:{...r.initial,x:NaN}},{...r,initial:{...r.initial,resources:{airJumps:1,dashCharges:0,cooldowns:{}}}}]) {
  expect(()=>run.replay(bad)).toThrow();expect(run.getSnapshot()).toBe(snapshot);
 }
 run.pause(false);const f=run.advance({...NEUTRAL,moveX:2} as never);expect(f.status).toBe('invalidState');expect(f.state.tick).toBe(0);expect(run.getSnapshot().paused).toBe(true);
 expect(()=>parseRecording({...r,input:[{...r.input[0],fromTick:0},{...r.input[0],fromTick:r.ticks}]})).toThrow();
});

test('invalid spawn/profile/clearance and unsupported flyer fail explicitly',()=>{
 const m=map(),p=profile(),r=recording();
 expect(()=>new TestSession({...m,entities:[]},p)).toThrow('playerStart');
 expect(()=>new TestSession(m,{...p,support:'centerFoot'})).toThrow('unsupported');
 expect(()=>new TestSession(m,read('placeholder-library/movement/flyer.movement.json'))).toThrow('unsupported');
 expect(()=>new TestSession(m,p,{...r.initial,y:r.initial.y+1})).toThrow('invalidState');
 expect(()=>new TestSession(m,p,{...r.initial,supportId:'fh.absent'})).toThrow('invalidState');
 expect(()=>new TestSession(m,p,{...r.initial,traversalId:undefined} as unknown as State)).toThrow('complete');
});

test('owned final-byte CC0 manifest covers the complete matrix',()=>{
 const index=read<{license:string;files:{path:string;sha256:string}[]}>(folder+'/index.json');expect(index.license).toBe('CC0-1.0');
 expect(index.files.map(f=>f.path).sort()).toEqual(readdirSync(folder).filter(f=>f!=='index.json').sort());
 for(const f of index.files)expect(createHash('sha256').update(readFileSync(folder+'/'+f.path)).digest('hex'),f.path).toBe(f.sha256);
});

test('independent process consumes Test recording through exported runtime without editor, React, library or renderer',()=>{
 const root=process.cwd(),dir=realpathSync(mkdtempSync(join(realpathSync(tmpdir()),'maplab-test-consumer-')));
 try {
  writeFileSync(join(dir,'package.json'),'{"type":"module"}');
  for(const f of ['schemas','contracts'])cpSync(join(root,f),join(dir,f),{recursive:true});
  for(const f of ['contracts','physics-reference','air-jumps','dash','wall','ledge','platforms','test-runtime']){
   mkdirSync(join(dir,'src',f),{recursive:true});
   for(const file of readdirSync(join(root,'src',f)).filter(n=>n.endsWith('.ts'))){
    const source=readFileSync(join(root,'src',f,file),'utf8');if(f==='test-runtime')expect(source).not.toMatch(/from ['"].*(?:editor|library|render|react|node:)/);
    const code=stripTypeScriptTypes(source).replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g,(all,a:string,b:string,c:string)=>b.endsWith('.json')?all:a+b+(b.endsWith('physics-reference')?'/index':'')+'.js'+c);
    writeFileSync(join(dir,'src',f,file.replace(/\.ts$/,'.js')),code);
   }
  }
  cpSync(join(root,'tests/consumer/test-runtime.mjs'),join(dir,'consumer.mjs'));
  for(const name of cases){
   const result=JSON.parse(execFileSync(process.execPath,[join(dir,'consumer.mjs'),join(root,folder),name],{cwd:dir,encoding:'utf8'})) as {frames:Step[];recording:Recording};
   expect(result.frames).toEqual(read<{frames:Step[]}>(`${folder}/${name}.expected.json`).frames);expect(result.recording).toEqual(recording(name));
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
},30_000);
