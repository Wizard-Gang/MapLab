import {test,expect} from 'vitest';
import {readFileSync,rmSync,writeFileSync,symlinkSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {verifyRigBundle,digest,RIG_LIMITS} from '../src/riglab/bundle';
import {validateBinding,samplePresentation} from '../src/riglab/presentation';
import {readRig,importRig} from '../src/library/riglab';
import {applyAffine} from '../src/render/transform';
import {rigFixture,jsonFixture,rigFiles,binding,armor,libraryFixture} from './riglab-fixtures';
function rewrite(files:Map<string,Uint8Array>,path:string,edit:(v:any)=>void):void {
 const v=JSON.parse(new TextDecoder().decode(files.get(path)));edit(v);const bytes=new TextEncoder().encode(JSON.stringify(v));files.set(path,bytes);
 const m=JSON.parse(new TextDecoder().decode(files.get('manifest.json'))),entries=[m.rig,...m.animations,...(m.weapons??[]),...(m.baked??[])];entries.find(e=>e.file===path).sha256=digest(bytes);files.set('manifest.json',new TextEncoder().encode(JSON.stringify(m)));
}
test('owned corpus inventory pins exact source, exporter provenance and every artifact',()=>{
 const index=jsonFixture<any>('index.json');expect(index.license).toBe('CC0-1.0');for(const f of index.files)expect(digest(rigFixture(f.path))).toBe(f.sha256);
 const p=jsonFixture<any>('provenance.json');expect(digest(rigFixture('bundle/manifest.json'))).toBe(p.manifestSha256);expect(p.generator.commit).toBe('6ef2271de90c85de931de77fa30c82a068875e2c');
});
test('manifest bytes and complete listed inventory are independently verified and owned',()=>{
 const files=rigFiles(),b=verifyRigBundle(files);expect(b.rig.name).toBe('owned-armor');expect(b.baked).toHaveLength(3);expect(b.baked[0]!.frames).toHaveLength(60);
 files.get('bundle')?.fill(0);expect(()=>{(b.rig.bones as any[]).push({});}).toThrow();expect(()=>verifyRigBundle(rigFiles(),'0'.repeat(64))).toThrow('manifest digest');
 const extra=rigFiles();extra.set('notes.json',new Uint8Array([0]));expect(()=>verifyRigBundle(extra)).toThrow('unlisted');
 const missing=rigFiles();missing.delete('owned-armor.rig.json');expect(()=>verifyRigBundle(missing)).toThrow();
 const corrupt=rigFiles();corrupt.set('owned-armor.rig.json',new TextEncoder().encode('{}'));expect(()=>verifyRigBundle(corrupt)).toThrow('digest');
});
for(const [description,path,edit]of [
 ['rig version','owned-armor.rig.json',(v:any)=>v.version=2],['rig coordinate','owned-armor.rig.json',(v:any)=>v.space.y='up'],['parent cycle','owned-armor.rig.json',(v:any)=>v.bones[0].parent='head'],['unknown bone','animations/unarmed-idle.anim.json',(v:any)=>v.keys[0].pose.ghost={rotation:0}],['animation version','animations/unarmed-idle.anim.json',(v:any)=>v.version=4],['clip timing','animations/unarmed-idle.anim.json',(v:any)=>v.fps=30],['baked version','baked/unarmed-idle.baked.json',(v:any)=>v.version=2],['baked fps','baked/unarmed-idle.baked.json',(v:any)=>v.fps=30],['baked reference','baked/unarmed-idle.baked.json',(v:any)=>v.bones[0]='ghost'],['frame lengths','baked/unarmed-idle.baked.json',(v:any)=>v.frames.pop()],['frame tuple','baked/unarmed-idle.baked.json',(v:any)=>v.frames[0][0]=[0,0]],['frame numeric bound','baked/unarmed-idle.baked.json',(v:any)=>v.frames[0][0][0]=1e12],['weapon reference','baked/unarmed-idle.baked.json',(v:any)=>v.weapons=Array(60).fill({name:'ghost',bodies:{}})],['unknown field','owned-armor.rig.json',(v:any)=>v.code='execute me'],
] as const)test(`coherently rehashed ${description} refuses`,()=>{const files=rigFiles();rewrite(files,path,edit);expect(()=>verifyRigBundle(files)).toThrow();});
for(const entry of jsonFixture<any[]>('rejections.json'))test(`owned rejection fixture ${entry.id}`,()=>{const files=rigFiles();rewrite(files,entry.file,v=>{let at=v;for(const key of entry.pointer.slice(0,-1))at=at[key];at[entry.pointer.at(-1)]=entry.value;});expect(()=>verifyRigBundle(files)).toThrow();});
test('unsafe/alias paths, duplicate JSON keys and byte/count budgets refuse before evaluation',()=>{
 for(const path of ['../rig.json','/absolute.json','rig\\evil.json','CON.json','owned-armor.rig.json']){const files=rigFiles(),m=JSON.parse(new TextDecoder().decode(files.get('manifest.json')));m.animations[0].file=path;files.set('manifest.json',Buffer.from(JSON.stringify(m)));expect(()=>verifyRigBundle(files)).toThrow();}
 const files=rigFiles();files.set('manifest.json',Buffer.from('{"format":"riglab.export","format":"riglab.export"}'));expect(()=>verifyRigBundle(files)).toThrow();
 expect(()=>verifyRigBundle(new Map([['manifest.json',new Uint8Array(RIG_LIMITS.fileBytes+1)]]))).toThrow('file byte');expect(()=>verifyRigBundle(new Map(Array.from({length:129},(_,i)=>[`${i}.json`,new Uint8Array()])))).toThrow('file count');
});
test('explicit bindings require known slots, art, clip names, finite anchors and acyclic fallbacks',()=>{
 const bundle=verifyRigBundle(rigFiles());validateBinding(bundle,binding(),[armor()]);
 for(const edit of [(b:any)=>b.rootMotion='physics',(b:any)=>b.rigGroundAnchor[0]=NaN,(b:any)=>b.worldUnitsPerRigUnit.den=0,(b:any)=>b.artSlots[0].assetId='missing',(b:any)=>b.artSlots[0].slot='ghost',(b:any)=>b.artSlots.push(b.artSlots[0]),(b:any)=>b.actions[0].animation='missing',(b:any)=>b.actions[0].fallbackSemantic='locomotion.walk']){const b=binding();edit(b);expect(()=>validateBinding(bundle,b,[armor()])).toThrow();}
});
test('60 Hz frame selection, full mirrored matrices, depth sides, support-line anchor and root translation stay visual',()=>{
 const bundle=verifyRigBundle(rigFiles()),b=binding(),sample=(tick:number,facing:'left'|'right'='right',semantic='locomotion.idle')=>samplePresentation(bundle,b,[armor()],{tick,stateEnterTick:0,semantic,foot:[100,200],facing});
 const right=sample(15),left=sample(15,'left');expect(right.parts.find(p=>p.slot==='armor_pelvis')!.matrix.map(n=>n||0)).toEqual([2,0,0,2,100,148]);expect(left.parts.find(p=>p.slot==='armor_pelvis')!.matrix.map(n=>n||0)).toEqual([-2,0,0,2,100,148]);
 expect(right.parts.map(p=>p.slot)).not.toEqual(left.parts.map(p=>p.slot));expect(sample(75).parts).toEqual(right.parts);expect(sample(100,'right','locomotion.jump.rise').frame).toBe(36);
 const support=samplePresentation(bundle,b,[armor()],{tick:15,stateEnterTick:0,semantic:'locomotion.idle',foot:[100,200],supportY:210,facing:'right',rotation:90});const anchored=applyAffine(support.parts.find(p=>p.slot==='armor_pelvis')!.matrix,[4,0]);expect(anchored[0]).toBeCloseTo(152,8);expect(anchored[1]).toBeCloseTo(218,8);
 const fallback=sample(15,'right','locomotion.fall'),jump=sample(15,'right','locomotion.jump.rise');expect(fallback.status).toBe('baked');expect(fallback.parts).toEqual(jump.parts);expect(fallback.reason).toContain('Missing clip for locomotion.fall; fallback locomotion.jump.rise');
 expect(sample(0,'right','climb.ladder').status).toBe('placeholder');
 const missing=jsonFixture<ReturnType<typeof binding>>('missing-art.binding.json');expect(samplePresentation(bundle,missing,[armor()],{tick:0,stateEnterTick:0,semantic:'locomotion.idle',foot:[0,0],facing:'right'}).status).toBe('placeholder');
 const files=rigFiles(),m=JSON.parse(new TextDecoder().decode(files.get('manifest.json')));for(const e of m.baked)files.delete(e.file);delete m.baked;files.set('manifest.json',rigFixture('unbaked.manifest.json'));expect(samplePresentation(verifyRigBundle(files),b,[armor()],{tick:0,stateEnterTick:0,semantic:'locomotion.idle',foot:[0,0],facing:'left'}).status).toBe('placeholder');
});
test('depth painting traverses parents before descendants for child-first source arrays in both facings',()=>{
 const files=rigFiles();rewrite(files,'owned-armor.rig.json',r=>r.bones.unshift({...r.bones.find((b:any)=>b.name==='arm-near'),name:'forearm',parent:'arm-near',slot:'armor_forearm'}));
 const m=JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
 for(const entry of m.animations)rewrite(files,entry.file,a=>{for(const key of a.keys)key.pose.forearm={rotation:0};});
 for(const entry of m.baked)rewrite(files,entry.file,b=>{const parent=b.bones.indexOf('arm-near');b.bones.unshift('forearm');for(const frame of b.frames)frame.unshift([...frame[parent]]);});
 const bundle=verifyRigBundle(files),base=binding(),b={...base,artSlots:[...base.artSlots,{slot:'armor_forearm',assetId:armor().id,pivot:[4,0] as const}]};
 for(const facing of ['left','right'] as const){const sample=samplePresentation(bundle,b,[armor()],{tick:0,stateEnterTick:0,semantic:'locomotion.idle',foot:[0,0],facing}),slots=sample.parts.map(p=>p.slot);expect(sample.status).toBe('baked');expect(slots.indexOf('armor_forearm')).toBe(slots.indexOf('armor_arm_near')+1);expect(new Set(slots).size).toBe(8);}
});
test('immutable library import/read preserves exact bytes and refuses tampering and symlinks',()=>{
 const folder=libraryFixture();try{const imported=importRig(folder,{base64:rigFixture('owned-rig.zip').toString('base64')}),b=readRig(folder,imported.path);expect(b.digest).toBe(imported.bundle.digest);for(const [p,bytes]of b.files)expect(Buffer.from(bytes)).toEqual(rigFixture('bundle/'+p));expect(()=>importRig({...folder,placeholder:true},{base64:''})).toThrow('placeholder');expect(()=>importRig(folder,{base64:'!!!='})).toThrow();}finally{rmSync(folder.dir,{recursive:true,force:true});}
 const f=libraryFixture();try{const root=`presentations/${jsonFixture<any>('provenance.json').manifestSha256}`,path=join(f.dir,root,'owned-armor.rig.json');chmodSync(path,0o644);writeFileSync(path,'{}');expect(()=>readRig(f,root+'/manifest.json')).toThrow('digest');rmSync(path);symlinkSync(join(f.dir,'maplab.project.json'),path);expect(()=>readRig(f,root+'/manifest.json')).toThrow(/symbolic|symlink/);}finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('optional weapon definitions and baked body transforms validate and mirror as complete part matrices',()=>{
 const files=rigFiles();rewrite(files,'owned-armor.rig.json',r=>r.chains.push({name:'arm',upper:'torso',lower:'arm-near',bend:1}));
 const weapon={format:'riglab.weapon',version:1,name:'axe',bodies:[{name:'blade',slot:'axe_blade',axis:[[0,0],[0,20]],grips:[{name:'grip',chain:'arm',at:[0,0],angle:0}]}]},bytes=Buffer.from(JSON.stringify(weapon));files.set('weapons/axe.weapon.json',bytes);
 let m=JSON.parse(new TextDecoder().decode(files.get('manifest.json')));m.weapons=[{name:'axe',file:'weapons/axe.weapon.json',sha256:digest(bytes)}];files.set('manifest.json',Buffer.from(JSON.stringify(m)));
 rewrite(files,'animations/unarmed-idle.anim.json',a=>{a.name='axe-idle';a.class='axe';});rewrite(files,'baked/unarmed-idle.baked.json',b=>{b.animation='axe-idle';b.weapons=b.frames.map(()=>({name:'axe',bodies:{blade:[10,-20,0]}}));});m=JSON.parse(new TextDecoder().decode(files.get('manifest.json')));m.animations[0].name='axe-idle';m.baked[0].animation='axe-idle';files.set('manifest.json',Buffer.from(JSON.stringify(m)));
 const bundle=verifyRigBundle(files),b=binding() as any;b.actions[0].animation='axe-idle';b.artSlots.push({slot:'axe_blade',assetId:armor().id,pivot:[4,0]});const sample=samplePresentation(bundle,b,[armor()],{tick:0,stateEnterTick:0,semantic:'locomotion.idle',foot:[100,200],facing:'left'});
 expect(sample.parts.find(p=>p.slot==='axe_blade')!.matrix.map(n=>n||0)).toEqual([-2,0,0,2,88,160]);rewrite(files,'weapons/axe.weapon.json',w=>w.bodies[0].grips[0].chain='malicious');expect(()=>verifyRigBundle(files)).toThrow('chain');
});
