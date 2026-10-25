import { obj,record,list,name,number,point,integer,unique,header,fail } from './data';
import type { Rig,Clip,Weapon,Baked } from './model';
const TIMING:Record<string,readonly[number,boolean,number]>={idle:[60,true,4],walk:[48,true,4],jump:[36,false,4],attack:[24,false,4],hit:[24,false,3]};
export function validateWeapon(raw:unknown,chains:readonly string[]):Weapon {
 const w=obj(raw,['format','version','name','bodies']);header(w,'riglab.weapon',1);name(w.name);if(w.name==='unarmed')fail('reserved weapon name');
 const bodies=list(w.bodies,64,1);unique(bodies.map(b=>name(obj(b,['name','slot','axis','grips']).name)));const used:string[]=[];
 for(const b of bodies){name(b.slot);const axis=list(b.axis,2,2);point(axis[0]);point(axis[1]);if(JSON.stringify(axis[0])===JSON.stringify(axis[1]))fail('zero weapon axis');const grips=list(b.grips,2,1);unique(grips.map(g=>name(obj(g,['name','chain','at'],['angle']).name)));
  for(const g of grips){if(!chains.includes(g.chain))fail('unknown weapon chain');used.push(g.chain);point(g.at);if(grips.length===1)number(g.angle);else if(g.angle!==undefined)fail('angle on free weapon body');}}
 unique(used);return w as Weapon;
}
export function validateClip(raw:unknown,rig:Rig,weapons:readonly Weapon[],chains:readonly string[]):Clip {
 const a=obj(raw,['format','version','name','rig','class','kind','fps','length','loop','keys']);header(a,'riglab.anim',3);name(a.name);name(a.class);
 const timing=TIMING[a.kind];if(!timing||a.name!==`${a.class}-${a.kind}`||a.rig!==rig.name||a.fps!==60||a.length!==timing[0]||a.loop!==timing[1])fail('unsupported animation identity or 60 Hz timing');
 const weapon=a.class==='unarmed'?null:weapons.find(w=>w.name===a.class);if(weapon===undefined)fail('animation weapon is missing');
 const bones=rig.bones.map(b=>b.name), keys=list(a.keys,timing[2],timing[2]);
 for(let i=0;i<keys.length;i++){const k=obj(keys[i],['frame','interpolation','pose'],['pins','bodies']);if(k.frame!==i*a.length/(a.loop?keys.length:keys.length-1)||!['hold','linear','smoothstep'].includes(k.interpolation))fail('invalid key grid');
  const pose=record(k.pose);if(Object.keys(pose).length!==bones.length||bones.some(b=>!Object.hasOwn(pose,b)))fail('pose bone references differ');for(const bone of bones){const channels=obj(pose[bone],bone===rig.root?['x','y','rotation']:['rotation']);Object.values(channels).forEach(v=>number(v));}
  if(k.pins!==undefined){const pins=list(k.pins,128);unique(pins.map(p=>name(obj(p,['chain','x','y']).chain)));for(const p of pins){if(!chains.includes(p.chain))fail('unknown pin chain');number(p.x);number(p.y);}}
  const free=weapon?(weapon as any).bodies.filter((b:any)=>b.grips.length===2).map((b:any)=>b.name):[];
  const placements=k.bodies===undefined?[]:list(k.bodies,64);unique(placements.map(p=>name(obj(p,['body','x','y','rotation']).body)));if(placements.length!==free.length||placements.some(p=>!free.includes(p.body)))fail('weapon key body references differ');for(const p of placements){number(p.x);number(p.y);number(p.rotation);}
 }
 return a as Clip;
}
export function validateBaked(raw:unknown,rig:Rig,clip:Clip,weapons:readonly Weapon[]):Baked {
 const b=obj(raw,['format','version','rig','animation','fps','loop','bones','frames'],['weapons']);header(b,'riglab.baked',1);
 if(b.rig!==rig.name||b.animation!==clip.name||b.fps!==60||b.loop!==clip.loop)fail('baked animation identity differs');
 const bones=list(b.bones,128,1);if(JSON.stringify(bones)!==JSON.stringify(rig.bones.map(b=>b.name)))fail('baked bone order differs');
 const count=clip.length+(clip.loop?0:1),frames=list(b.frames,7201,1);if(frames.length!==count||frames.length*bones.length>250_000)fail('baked frame length or aggregate budget');
 for(const frame of frames){const transforms=list(frame,bones.length,bones.length);transforms.forEach(t=>point(t,3));}
 if(b.weapons!==undefined){const held=list(b.weapons,count,count);for(const h of held){if(h===null){if(clip.class!=='unarmed')fail('missing baked weapon');continue;}const item=obj(h,['name','bodies']),weapon=weapons.find(w=>w.name===item.name);if(!weapon||weapon.name!==clip.class)fail('unknown baked weapon');const bodies=record(item.bodies),expected=weapon.bodies.map(b=>b.name);if(Object.keys(bodies).length!==expected.length||expected.some(n=>!Object.hasOwn(bodies,n)))fail('baked weapon bodies differ');Object.values(bodies).forEach(t=>point(t,3));}}
 else if(clip.class!=='unarmed')fail('missing baked weapon transforms');
 return b as Baked;
}
