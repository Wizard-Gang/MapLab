// Independent foreign-byte reader. Imports no application code, authoring model or solver.
import {createHash} from 'node:crypto';
import {ReaderError,parseStrict} from './json.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const bad=s=>{throw new ReaderError('riglab.invalid',s);};
const array=(v,max)=>{if(!Array.isArray(v)||v.length>max)bad('Foreign resource limit');return v;};
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e6;
const triple=v=>Array.isArray(v)&&v.length===3&&v.every(finite);
export function foreignPresentations(manifest,files,docs) {
 const checked=new Set();
 for(const {value:map}of docs.values())for(const binding of map.presentations??[]){
  const dep=map.dependencies.find(d=>d.id===binding.bundleDependencyId&&d.kind==='riglab'),match=dep&&/^presentations\/([a-f0-9]{64})\/manifest\.json$/.exec(dep.path);
  if(!match)bad('Binding lacks a pinned foreign dependency');
  const prefix=dep.path.slice(0,-13),raw=files.get(dep.path);if(!raw||hash(raw)!==match[1])bad('Foreign manifest pin differs');
  const m=parseStrict(raw);if(m.format!=='riglab.export'||m.version!==1)bad('Foreign export version');
  const entries=[m.rig,...array(m.animations,64),...array(m.weapons??[],32),...array(m.baked??[],64)],paths=entries.map(e=>e.file);
  if(new Set(paths.map(p=>p.toLowerCase())).size!==paths.length||paths.includes('manifest.json'))bad('Duplicate foreign path');
  const inventory=[...files.keys()].filter(p=>p.startsWith(prefix));if(inventory.length!==paths.length+1||inventory.some(p=>!paths.includes(p.slice(prefix.length))&&p!==dep.path))bad('Foreign inventory differs');
  let bytes=raw.length;const values=new Map();
  for(const e of entries){if(typeof e.file!=='string'||e.file.split('/').some(p=>!p||p==='.'||p==='..')||e.file.includes('\\'))bad('Unsafe foreign path');const p=prefix+e.file,b=files.get(p);if(!b||b.length>8*1024*1024||manifest.files.find(f=>f.path===p)?.role!=='foreign'||hash(b)!==e.sha256)bad('Foreign file hash or role differs');bytes+=b.length;values.set(e.file,parseStrict(b));}
  if(bytes>16*1024*1024||manifest.files.find(f=>f.path===dep.path)?.role!=='foreign')bad('Foreign bounds or manifest role');
  const rig=values.get(m.rig.file);if(rig.format!=='riglab.rig'||rig.version!==1||rig.name!==m.rig.name||rig.space.units!=='svg'||rig.space.rotation!=='clockwise-positive'||rig.space.x!=='right'||rig.space.y!=='down')bad('Rig identity or coordinates');
  const bones=array(rig.bones,128),names=bones.map(b=>b.name);if(!names.length||new Set(names).size!==names.length)bad('Bone identity');
  for(const bone of bones){if(bone.parent!==null&&!names.includes(bone.parent))bad('Bone parent');let at=bone;const seen=new Set();while(at){if(seen.has(at.name))bad('Bone cycle');seen.add(at.name);at=bones.find(b=>b.name===at.parent);}}
  for(const e of m.animations){const a=values.get(e.file);if(a.format!=='riglab.anim'||a.version!==3||a.name!==e.name||a.rig!==rig.name||a.fps!==60||!Number.isSafeInteger(a.length)||a.length<1||a.length>7200)bad('Animation identity');for(const key of array(a.keys,256))if(Object.keys(key.pose).length!==names.length||Object.keys(key.pose).some(n=>!names.includes(n)))bad('Animation bone reference');}
  for(const e of m.weapons??[]){const w=values.get(e.file);if(w.format!=='riglab.weapon'||w.version!==1||w.name!==e.name)bad('Weapon identity');}
  for(const e of m.baked??[]){const b=values.get(e.file),a=m.animations.map(e=>values.get(e.file)).find(a=>a.name===e.animation);if(!a||b.format!=='riglab.baked'||b.version!==1||b.rig!==rig.name||b.animation!==a.name||b.fps!==60||b.loop!==a.loop||JSON.stringify(b.bones)!==JSON.stringify(names))bad('Baked identity');const frames=array(b.frames,7201);if(frames.length!==a.length+(a.loop?0:1)||frames.length*names.length>250000||frames.some(f=>!Array.isArray(f)||f.length!==names.length||!f.every(triple)))bad('Baked frame/transform');}
  const arts=new Set();for(const art of binding.artSlots){if(arts.has(art.slot)||!bones.some(b=>b.slot===art.slot)&&!(m.weapons??[]).some(e=>values.get(e.file).bodies.some(b=>b.slot===art.slot))||!map.assets.some(a=>a.id===art.assetId))bad('Art binding');arts.add(art.slot);}
  if(binding.expectedExportVersion!==1||binding.rootMotion!=='visualOnly'||binding.worldUnitsPerRigUnit.num<=0||binding.worldUnitsPerRigUnit.den<=0||binding.rigGroundAnchor.some(n=>!finite(n)))bad('Physical/presentation binding boundary');
  for(const action of binding.actions){if(action.animation!==null&&!m.animations.some(a=>a.name===action.animation))bad('Animation binding');let at=action;const seen=new Set();while(at?.fallbackSemantic){if(seen.has(at.semantic))bad('Fallback cycle');seen.add(at.semantic);at=binding.actions.find(a=>a.semantic===at.fallbackSemantic);if(!at)bad('Missing fallback');}}
  checked.add(prefix);
 }
 return checked;
}
