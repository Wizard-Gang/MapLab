import { afterEach,expect,test } from 'vitest';
import { readFileSync,symlinkSync,mkdirSync,writeFileSync,unlinkSync,readlinkSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { importAsset,readAsset,ASSET_REQUEST_LIMIT } from '../src/library/assets';
import { ASSET_PATH } from '../src/library/assets';
import { inspectImage } from '../src/assets/inspect';
import { ROUTES } from '../src/library/protocol';
import { call,cleanup,scratchLibrary,startServer,tree,repoRoot,sha256 } from './library-support';
afterEach(cleanup);
const data=(name='owned.svg')=>readFileSync(join(repoRoot,'conformance/visuals',name));
test('approved copy is immutable/content-addressed, idempotent, canonical and readable; originals are unchanged',()=>{
  const f=scratchLibrary(),raw=data(),before=Buffer.from(raw),a=importAsset(f,{mediaType:'image/svg+xml',base64:raw.toString('base64')});expect(raw).toEqual(before);expect(ASSET_PATH.test(a.asset.path)).toBe(true);expect(a.asset.size).toEqual([16,16]);const approved=Buffer.from(a.base64,'base64');expect(sha256(approved)).toBe(a.asset.path.split('/')[2]!.split('.')[0]);expect(approved).toEqual(Buffer.from(inspectImage(raw,'image/svg+xml').bytes));const saved=tree(f.dir);expect(importAsset(f,{mediaType:'image/svg+xml',base64:raw.toString('base64')})).toEqual(a);expect(tree(f.dir)).toEqual(saved);expect(readAsset(f,{path:a.asset.path})).toEqual(a);
});
test('malicious/complex/oversized inputs, base64 aliases, arbitrary file reads and tampered approved files refuse',()=>{
  const f=scratchLibrary(),before=tree(f.dir);for(const [name,type] of [['malicious.svg','image/svg+xml'],['complex.svg','image/svg+xml'],['massive.png','image/png']] as const)expect(()=>importAsset(f,{mediaType:type,base64:data(name).toString('base64')})).toThrow();for(const base64 of ['!!!!','YQ','YQ=\n','YR=='])expect(()=>importAsset(f,{mediaType:'image/png',base64})).toThrow();for(const path of ['../maplab.project.json','maplab.project.json','https://example.invalid/a.svg','assets/aaaaaaaaaaaa/'+'b'.repeat(64)+'.svg','assets/%2e%2e/x.svg'])expect(()=>readAsset(f,{path})).toThrow();expect(tree(f.dir)).toEqual(before);
  const a=importAsset(f,{mediaType:'image/png',base64:data('owned.png').toString('base64')});writeFileSync(join(f.dir,a.asset.path),'tampered');expect(()=>readAsset(f,{path:a.asset.path})).toThrow(/digest/);expect(()=>importAsset(f,{mediaType:'image/png',base64:data('owned.png').toString('base64')})).toThrow(/Immutable/);
});
test('asset import refuses symlink parents and placeholder writes before mutation',()=>{
  const f=scratchLibrary();mkdirSync(join(f.dir,'other'));const before=tree(f.dir);symlinkSync(join(f.dir,'other'),join(f.dir,'assets'),'dir');expect(()=>importAsset(f,{mediaType:'image/png',base64:data('owned.png').toString('base64')})).toThrow(/symbolic/);expect(readlinkSync(join(f.dir,'assets'))).toBe(join(f.dir,'other'));expect(readdirSync(join(f.dir,'other'))).toEqual([]);unlinkSync(join(f.dir,'assets'));expect(tree(f.dir)).toEqual(before);expect(()=>importAsset({...f,placeholder:true},{mediaType:'image/png',base64:data('owned.png').toString('base64')})).toThrow(/placeholder/);
});
test('real loopback endpoints enforce Host/Origin/JSON/method, support approved reads, and refuse oversized bodies',async()=>{
  const f=scratchLibrary(),s=await startServer(f.dir);try{
    const body={mediaType:'image/png',base64:data('owned.png').toString('base64')};
    for(const route of [ROUTES.assetImport,ROUTES.assetRead])for(const options of [{headers:{origin:'https://example.invalid'}},{headers:{host:'evil.invalid'}},{method:'GET'},{headers:{'content-type':'text/plain'}}]){const r=await call(s.port,route,{...options,body});expect(r.status).toBeGreaterThanOrEqual(400);}
    const a=await call(s.port,ROUTES.assetImport,{body});expect(a.body.ok).toBe(true);const asset=a.body.asset as {path:string};const b=await call(s.port,ROUTES.assetRead,{body:{path:asset.path}});expect(b.body.base64).toBe(a.body.base64);
    const before=tree(f.dir);expect((await call(s.port,ROUTES.assetImport,{body:Buffer.alloc(ASSET_REQUEST_LIMIT+1,32)})).status).toBe(413);expect(tree(f.dir)).toEqual(before);
  }finally{await s.close();}
});
