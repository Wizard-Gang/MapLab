import type {SourceDocument,ContractRef} from '../contracts';
import {verifyRigBundle} from './bundle';
import {validateBinding} from './presentation';
export function verifyForeign(values:readonly SourceDocument[],files:ReadonlyMap<string,Uint8Array>):{used:Set<string>;contracts:ContractRef[]} {
 const used=new Set<string>(),contracts=new Map<string,ContractRef>();
 const add=(key:string,version:number):void=>{contracts.set(`${key}@${version}`,{key,version});};
 for(const doc of values)if('presentations' in doc)for(const binding of doc.presentations){
  const dep=doc.dependencies.find(d=>d.id===binding.bundleDependencyId&&d.kind==='riglab');
  const match=dep&&/^presentations\/([a-f0-9]{64})\/manifest\.json$/.exec(dep.path);if(!dep||!match)throw Error('Presentation requires a content-addressed foreign manifest');
  const prefix=dep.path.slice(0,-'manifest.json'.length),inner=new Map<string,Uint8Array>();
  for(const [p,b]of files)if(p.startsWith(prefix)){inner.set(p.slice(prefix.length),b);used.add(p);}
  const bundle=verifyRigBundle(inner,match[1]);validateBinding(bundle,binding,doc.assets);
  add('riglab.export',1);add('riglab.rig',1);if(bundle.clips.length)add('riglab.anim',3);if(bundle.baked.length)add('riglab.baked',1);if(bundle.weapons.length)add('riglab.weapon',1);
 }
 return {used,contracts:[...contracts.values()]};
}
