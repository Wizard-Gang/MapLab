// Presentation consumes values only: it cannot access a controller, actor mutator or clock.
import type { RigPresentationBinding } from '../contracts/gameplay-types';
import type { Asset,Vec2 } from '../contracts/common-types';
import { multiply,visualMatrix,type Affine } from '../render/transform';
import type { RigView,Clip } from './model';
export interface RigPart {readonly slot:string;readonly asset:Asset;readonly matrix:Affine}
export interface RigSample {readonly status:'baked'|'placeholder';readonly reason:string;readonly frame:number|null;readonly parts:readonly RigPart[]}
const refuse=(reason:string):never=>{throw Error(`Presentation: ${reason}`);};
export function validateBinding(bundle:RigView,b:RigPresentationBinding,assets:readonly Asset[]):void {
 if(b.kind!=='riglab'||b.expectedExportVersion!==1||b.rootMotion!=='visualOnly'||!['left','right'].includes(b.nativeFacing)||!['supportLine','footReference'].includes(b.groundContact))refuse('unsupported binding');
 if(!Array.isArray(b.artSlots)||b.artSlots.length>256||!Array.isArray(b.actions)||b.actions.length>128)refuse('binding resource limits');
 const {num,den}=b.worldUnitsPerRigUnit;if(![num,den].every(v=>Number.isSafeInteger(v)&&v>0)||!Number.isFinite(num/den))refuse('invalid scale');
 if(b.rigGroundAnchor.length!==2||!b.rigGroundAnchor.every(Number.isFinite))refuse('invalid ground anchor');
 const slots=[...bundle.rig.bones.map(b=>b.slot),...bundle.weapons.flatMap(w=>w.bodies.map(b=>b.slot))],used=new Set<string>();
 for(const art of b.artSlots){if(!slots.includes(art.slot)||used.has(art.slot)||!assets.some(a=>a.id===art.assetId&&a.mediaType.startsWith('image/'))||art.pivot.length!==2||!art.pivot.every(Number.isFinite))refuse('invalid or missing art binding');used.add(art.slot);}
 const semantics=new Set(b.actions.map(a=>a.semantic));if(semantics.size!==b.actions.length)refuse('duplicate semantic action');
 for(const action of b.actions){if(action.animation!==null&&!bundle.clips.some(c=>c.name===action.animation))refuse('unknown animation');const seen=new Set<string>();let at:typeof action|undefined=action;while(at?.fallbackSemantic){if(seen.has(at.semantic))refuse('fallback cycle');seen.add(at.semantic);const next=b.actions.find(a=>a.semantic===at!.fallbackSemantic);if(!next)refuse('missing fallback');at=next;}}
}
function order(bundle:RigView,clip:Clip,facing:'left'|'right'):readonly string[]|null {
 const r=bundle.rig,d=r.depthProfiles;if(!d)return r.bones.map(b=>b.name);
 const p=d.profiles[d.byClip[clip.name]??d.byClip[clip.class]??d.default]!,s=d.sides[facing==='left'?'facingLeft':'facingRight'];
 const descendants=(root:string):string[]=>r.bones.filter(b=>{let at:typeof b|undefined=b;while(at){if(at.name===root)return true;const parent:string|null=at.parent;at=r.bones.find(b=>b.name===parent);}return false;}).map(b=>b.name);
 const names=[...(p.underLowerBody?descendants(s.arms[p.underLowerBody]):[]),...descendants(s.legs.far),...descendants(s.legs.near),'pelvis',...(p.behindTorso?descendants(s.arms[p.behindTorso]):[]),'torso',...(p.head==='below-arms'?descendants('head'):[]),...p.foreground.flatMap(side=>descendants(s.arms[side])),...(p.head==='above-arms'?descendants('head'):[])];
 return names.length===r.bones.length&&new Set(names).size===r.bones.length&&names.every(n=>r.bones.some(b=>b.name===n))?names:null;
}
export interface PresentationInput {readonly tick:number;readonly stateEnterTick:number;readonly semantic:string;readonly foot:Vec2;readonly facing:'left'|'right';readonly supportY?:number;readonly rotation?:number}
export function samplePresentation(bundle:RigView|null,b:RigPresentationBinding,assets:readonly Asset[],input:PresentationInput):RigSample {
 const placeholder=(reason:string):RigSample=>({status:'placeholder',reason,frame:null,parts:[]});if(!bundle)return placeholder('Bundle unavailable; generic actor');
 validateBinding(bundle,b,assets);
 if(input.tick<0||input.stateEnterTick<0||!Number.isSafeInteger(input.tick)||!Number.isSafeInteger(input.stateEnterTick)||input.tick<input.stateEnterTick||input.foot.some(v=>!Number.isFinite(v))||input.supportY!==undefined&&!Number.isFinite(input.supportY)||!Number.isFinite(input.rotation??0))return placeholder('Invalid presentation sample');
 let action=b.actions.find(a=>a.semantic===input.semantic);while(action&&!action.animation&&action.fallbackSemantic)action=b.actions.find(a=>a.semantic===action!.fallbackSemantic);
 const clip=bundle.clips.find(c=>c.name===action?.animation),baked=bundle.baked.find(c=>c.animation===clip?.name);if(!clip||!baked)return placeholder('Missing action or unbaked animation; generic actor');
 const names=order(bundle,clip,input.facing);if(!names)return placeholder('Unsupported depth profile; generic actor');
 const elapsed=input.tick-input.stateEnterTick,frame=clip.loop?elapsed%baked.frames.length:Math.min(elapsed,baked.frames.length-1),pose=baked.frames[frame]!;
 const scale=b.worldUnitsPerRigUnit.num/b.worldUnitsPerRigUnit.den,reflection=input.facing===b.nativeFacing?1:-1;
 const at:Vec2=[input.foot[0],b.groundContact==='supportLine'&&input.supportY!==undefined?input.supportY:input.foot[1]];
 const actor=visualMatrix({position:at,rotation:input.rotation??0,scale:[reflection*scale,scale],mirrorX:false,mirrorY:false},b.rigGroundAnchor);
 const parts:RigPart[]=[];let missing=false;
 const add=(slot:string,t:readonly[number,number,number]):void=>{const art=b.artSlots.find(a=>a.slot===slot),asset=assets.find(a=>a.id===art?.assetId);if(!art||!asset){missing=true;return;}const part=visualMatrix({position:[t[0],t[1]],rotation:t[2],scale:[asset.wuPerAssetUnit,asset.wuPerAssetUnit],mirrorX:false,mirrorY:false},art.pivot);const matrix=multiply(actor,part);if(matrix.some(v=>!Number.isFinite(v)||Math.abs(v)>1e9)){missing=true;return;}parts.push({slot,asset,matrix});};
 for(const name of names){const bone=bundle.rig.bones.find(b=>b.name===name)!;add(bone.slot,pose[baked.bones.indexOf(name)]!);}
 const held=baked.weapons?.[frame];if(held){const weapon=bundle.weapons.find(w=>w.name===held.name)!;for(const body of weapon.bodies)add(body.slot,held.bodies[body.name]!);}
 return missing?placeholder('Missing approved art; generic actor'):{status:'baked',reason:'Validated baked presentation; actor physics unchanged',frame,parts};
}
