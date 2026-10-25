// Node boundary over explicit bytes, independent of authoring tool code and solvers.
import { createHash } from 'node:crypto';
import { checkPaths } from '../export/zip';
import { obj,list,name,parse,unique,header,fail,freeze,type Data } from './data';
import { validateRig } from './rig';
import { validateWeapon,validateClip,validateBaked } from './clips';
import type { RigBundle } from './model';
export const RIG_LIMITS=Object.freeze({bytes:16*1024*1024,fileBytes:8*1024*1024,files:128});
export const digest=(b:Uint8Array):string=>createHash('sha256').update(b).digest('hex');
export function manifestEntries(raw:Uint8Array):{manifest:Data;entries:Data[]} {
 const m=obj(parse(raw),['format','version','generator','rig','animations'],['weapons','baked']);header(m,'riglab.export',1);if(typeof m.generator!=='string'||!m.generator.length||m.generator.length>256)fail('invalid generator');
 const rig=obj(m.rig,['name','file','sha256']),animations=list(m.animations,64),weapons=m.weapons===undefined?[]:list(m.weapons,32),baked=m.baked===undefined?[]:list(m.baked,64);
 for(const e of [rig,...animations,...weapons]){obj(e,['name','file','sha256']);name(e.name);}
 for(const e of baked){obj(e,['animation','file','sha256']);name(e.animation);}
 const entries=[rig,...animations,...weapons,...baked];if(entries.length+1>RIG_LIMITS.files)fail('file count resource limit');
 checkPaths(['manifest.json',...entries.map(e=>e.file)]);for(const e of entries)if(!/^[a-f0-9]{64}$/.test(e.sha256))fail('invalid file digest');
 unique(animations.map(e=>e.name));unique(weapons.map(e=>e.name));unique(baked.map(e=>e.animation));return {manifest:m,entries};
}
export function verifyRigBundle(input:ReadonlyMap<string,Uint8Array>,expectedDigest?:string):RigBundle {
 if(input.size>RIG_LIMITS.files)fail('file count resource limit');let total=0;for(const bytes of input.values()){if(bytes.length>RIG_LIMITS.fileBytes)fail('file byte resource limit');total+=bytes.length;}if(total>RIG_LIMITS.bytes)fail('bundle byte resource limit');
 checkPaths([...input.keys()]);const raw=input.get('manifest.json');if(!raw)fail('missing manifest');const hash=digest(raw!);if(expectedDigest!==undefined&&hash!==expectedDigest)fail('manifest digest differs');
 const {manifest:m,entries}=manifestEntries(raw!);if(input.size!==entries.length+1)fail('unlisted or missing file');
 const values=new Map<string,Data>();for(const e of entries){const b=input.get(e.file);if(!b||digest(b)!==e.sha256)fail(`file digest differs: ${e.file}`);values.set(e.file,parse(b!));}
 const rig=validateRig(values.get(m.rig.file));if(rig.name!==m.rig.name)fail('rig entry identity differs');
 const chains=(rig as unknown as Data).chains.map((c:Data)=>c.name);
 const weapons=(m.weapons??[]).map((e:Data)=>{const w=validateWeapon(values.get(e.file),chains);if(w.name!==e.name)fail('weapon entry identity differs');return w;});
 const clips=m.animations.map((e:Data)=>{const c=validateClip(values.get(e.file),rig,weapons,chains);if(c.name!==e.name)fail('animation entry identity differs');return c;});
 const baked=(m.baked??[]).map((e:Data)=>{const c=clips.find((c:any)=>c.name===e.animation);if(!c)fail('unknown baked animation');return validateBaked(values.get(e.file),rig,c,weapons);});
 const view=freeze({digest:hash,rig,clips,baked,weapons});return Object.freeze({...view,files:new Map([...input].map(([p,b])=>[p,b.slice()]))});
}
