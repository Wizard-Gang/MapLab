import { obj,record,list,name,number,point,unique,header,fail,type Data } from './data';
import type { Rig } from './model';
export function validateRig(raw:unknown):Rig {
 const r=obj(raw,['format','version','name','space','root','bones','chains'],['depthProfiles']);header(r,'riglab.rig',1);name(r.name);name(r.root);
 const s=obj(r.space,['units','x','y','rotation','height','viewBox']);
 if(s.units!=='svg'||s.x!=='right'||s.y!=='down'||s.rotation!=='clockwise-positive'||number(s.height)<=0)fail('unsupported rig coordinate space');
 const box=point(s.viewBox,4);if(box[2]!<=0||box[3]!<=0)fail('invalid viewBox');
 const bones=list(r.bones,128,1), names=bones.map(b=>name(obj(b,['name','parent','offset','tip','slot','artHeight','hand','limits']).name));unique(names);
 for(const b of bones){if(b.parent!==null&&!names.includes(b.parent))fail('unknown bone parent');point(b.offset);if(b.tip!==null)point(b.tip);name(b.slot);if(number(b.artHeight)<0)fail('negative art height');if(b.hand!==null)name(b.hand);
  if(b.limits!==null){const l=obj(b.limits,['min','max']);if(number(l.min,360)>number(l.max,360))fail('invalid angle limits');}
  const seen=new Set();let at:Data|undefined=b;while(at){if(seen.has(at.name))fail('bone cycle');seen.add(at.name);at=bones.find(b=>b.name===at!.parent);}
 }
 if(bones.filter(b=>b.parent===null).length!==1||bones.find(b=>b.parent===null)?.name!==r.root)fail('rig must have one named root');
 const chains=list(r.chains,128);unique(chains.map(c=>name(obj(c,['name','upper','lower','bend']).name)));
 for(const c of chains)if(!names.includes(c.upper)||!names.includes(c.lower)||bones.find(b=>b.name===c.lower)?.parent!==c.upper||![1,-1].includes(c.bend))fail('invalid chain reference');
 if(r.depthProfiles!==undefined){const d=obj(r.depthProfiles,['profiles','sides','byClip','default']),profiles=record(d.profiles);if(!Object.keys(profiles).length)fail('empty depth profile');
  for(const [k,value]of Object.entries(profiles)){name(k);const p=obj(value,['underLowerBody','behindTorso','foreground','head']);for(const f of ['underLowerBody','behindTorso'])if(![null,'far','near'].includes(p[f]))fail('invalid depth side');unique(list(p.foreground,2).map(v=>{if(!['far','near'].includes(v))fail('invalid foreground');return v;}));if(!['above-arms','below-arms'].includes(p.head))fail('invalid head order');}
  const sides=obj(d.sides,['facingRight','facingLeft']);for(const side of Object.values(sides)){const groups=obj(side,['arms','legs']);for(const g of Object.values(groups)){const pair=obj(g,['far','near']);if(!names.includes(pair.far)||!names.includes(pair.near)||pair.far===pair.near)fail('unknown depth bone');}}
  for(const [k,v]of Object.entries(record(d.byClip))){name(k);if(typeof v!=='string'||!Object.hasOwn(profiles,v))fail('unknown depth profile');}if(!Object.hasOwn(profiles,d.default))fail('unknown default depth profile');
 }
 return r as Rig;
}
