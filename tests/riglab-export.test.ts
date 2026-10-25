import {test,expect} from 'vitest';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,cpSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {exportLibrary,pinnedSchemas} from '../src/library/export';
import {verifyFiles,sha256,exportBytes} from '../src/export/bundle';
import {boundMap,libraryFixture,jsonFixture,rigFixture} from './riglab-fixtures';
test('export retains exact approved foreign bytes under their own root and an isolated consumer constructs mirrored matrices',async()=>{
 const folder=libraryFixture(),scratch=mkdtempSync(join(tmpdir(),'maplab-foreign-consumer-'));
 try{const source=readFileSync(join(folder.dir,'maps/riglab-proof.map.json')),bundle=await exportLibrary(folder,boundMap().id,sha256(source)),again=await exportLibrary(folder,boundMap().id,sha256(source));expect(bundle.zip).toEqual(again.zip);
 const prefix=`presentations/${jsonFixture<any>('provenance.json').manifestSha256}/`;expect(bundle.manifest.requiredContracts).toEqual(expect.arrayContaining([{key:'riglab.export',version:1},{key:'riglab.rig',version:1},{key:'riglab.anim',version:3},{key:'riglab.baked',version:1}]));
 for(const f of bundle.manifest.files.filter(f=>f.role==='foreign'))expect(Buffer.from(bundle.files.get(f.path)!)).toEqual(rigFixture('bundle/'+f.path.slice(prefix.length)));
 for(const [p,b]of bundle.files){const full=join(scratch,'bundle',p);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,b);}cpSync('schemas',join(scratch,'schemas'),{recursive:true});cpSync('tests/consumer/reader',join(scratch,'reader'),{recursive:true});cpSync('tests/consumer/riglab-consumer.mjs',join(scratch,'riglab-consumer.mjs'));
 const invoke=()=>JSON.parse(execFileSync(process.execPath,[join(scratch,'riglab-consumer.mjs'),join(scratch,'bundle'),join(scratch,'schemas')],{cwd:scratch,encoding:'utf8'}));
 expect(invoke()).toEqual({verified:true,frame:15,right:[2,0,0,2,100,148],left:[-2,0,0,2,100,148],physicsAuthority:false});
 // A coherent outer manifest rewrite cannot hide an invalid inner rig hash.
 const files=new Map(bundle.files),path=prefix+'owned-armor.rig.json';files.set(path,Buffer.from('{}'));const manifest=structuredClone(bundle.manifest) as any;const entry=manifest.files.find((f:any)=>f.path===path);entry.bytes=2;entry.sha256=sha256(files.get(path)!);files.set('manifest.json',exportBytes(manifest));expect(()=>verifyFiles(files,pinnedSchemas)).toThrow();
 // Rehash both inventories to ensure the independent boundary rejects malicious bone refs too.
 const inner=JSON.parse(Buffer.from(bundle.files.get(prefix+'manifest.json')!).toString()),bakedPath=prefix+inner.baked[0].file,baked=JSON.parse(Buffer.from(bundle.files.get(bakedPath)!).toString());baked.bones[0]='malicious';const bytes=Buffer.from(JSON.stringify(baked));inner.baked[0].sha256=sha256(bytes);
 const newInner=Buffer.from(JSON.stringify(inner)),newPrefix=`presentations/${sha256(newInner)}/`,altered=new Map<string,Uint8Array>();for(const [p,b]of bundle.files)if(p!=='manifest.json')altered.set(p.startsWith(prefix)?newPrefix+p.slice(prefix.length):p,b);altered.set(newPrefix+inner.baked[0].file,bytes);altered.set(newPrefix+'manifest.json',newInner);
 const map=JSON.parse(Buffer.from(altered.get('maps/riglab-proof.map.json')!).toString());map.dependencies.find((d:any)=>d.kind==='riglab').path=newPrefix+'manifest.json';altered.set('maps/riglab-proof.map.json',exportBytes(map));
 const outer=structuredClone(bundle.manifest) as any;outer.files=outer.files.map((f:any)=>{const path=f.path.startsWith(prefix)?newPrefix+f.path.slice(prefix.length):f.path,b=altered.get(path)!;return{...f,path,bytes:b.length,sha256:sha256(b)};}).sort((a:any,b:any)=>a.path<b.path?-1:1);altered.set('manifest.json',exportBytes(outer));expect(()=>verifyFiles(altered,pinnedSchemas)).toThrow();
 for(const [p,b]of altered){const full=join(scratch,'bundle',p);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,b);}rmSync(join(scratch,'bundle',prefix),{recursive:true,force:true});expect(invoke).toThrow();
 }finally{rmSync(folder.dir,{recursive:true,force:true});rmSync(scratch,{recursive:true,force:true});}
});
