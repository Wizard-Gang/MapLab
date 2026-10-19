// ML-015 authoring commands: existing closed source contracts, one transaction per command, no physical inference.
import type { Asset, Layer, Visual, VisualSource } from '../contracts';
import type { JsonObject, MapModel } from '../domain/model';
import { insertOp, setOp, transaction } from '../domain/commands';
import { allocateId } from '../domain/remap';
import type { Transaction } from '../domain/transaction';
import { records } from '../render/scene';
export const visualLayers=(m:MapModel):Layer[]=>records<Layer>(m,'layers').filter(l=>l.kind==='sprite'||l.kind==='background');
const json=(v:unknown):JsonObject=>v as JsonObject;
const id=(m:MapModel,base:string):string=>{const taken=(k:string)=>m.owners.has(k)||m.groups.has(k);return taken(base)?allocateId(base,taken):base;};
export function addLayer(m:MapModel,kind:'group'|'sprite'|'background'|'actors'): {id:string;tx:Transaction} {
  const key=id(m,`layer.${kind}`),order=Math.max(-1,...records<Layer>(m,'layers').filter(l=>l.parentId===null).map(l=>l.order))+1;
  const base={id:key,name:kind==='sprite'?'Scenery':kind==='background'?'Background':kind==='actors'?'Actors':'Group',parentId:null,order,visible:true,opacity:1};
  const layer:Layer=kind==='background'?{...base,kind,occlusionFade:null,space:'world',parallax:[1,1],origin:[0,0],repeat:'none',repeatSize:[256,256],scrollWUPerTick:[0,0],phase:[0,0]}:kind==='sprite'?{...base,kind,occlusionFade:null}:{...base,kind};
  return {id:key,tx:transaction('Add visual layer',[insertOp(m,'layers',[json(layer)])])};
}
export function addVisual(m:MapModel,layerId:string,source:VisualSource,asset?:Asset):{id:string;tx:Transaction} {
  if(!visualLayers(m).some(l=>l.id===layerId))throw new Error('Choose a sprite or background layer');
  const key=id(m,'visual.scenery'),order=Math.max(-1,...records<Visual>(m,'visuals').filter(v=>v.layerId===layerId&&v.parentId===null).map(v=>v.order))+1;
  const visual:Visual={id:key,name:source.kind==='shape'?'Shape':source.kind==='frames'?'Frame animation':'Sprite',layerId,parentId:null,order,bodyId:null,transform:{position:[0,0],rotation:0,scale:[1,1],mirrorX:false,mirrorY:false},source};
  return {id:key,tx:transaction('Add visual',[...(asset&&!m.owners.has(asset.id)?[insertOp(m,'assets',[json(asset)])]:[]),insertOp(m,'visuals',[json(visual)])])};
}
/** Changing a root's frame carries descendants together, without altering physical body records. */
export function visualFrame(m:MapModel,key:string,layerId:string,bodyId:string|null):Transaction {
  const vs=records<Visual>(m,'visuals'),root=vs.find(v=>v.id===key);if(!root)throw new Error('Visual no longer exists');
  if(root.parentId!==null)throw new Error('Detach from the parent before changing layer/body frame');
  const selected=new Set([key]);for(let size=0;size!==selected.size;){size=selected.size;for(const v of vs)if(v.parentId&&selected.has(v.parentId))selected.add(v.id);}
  return transaction('Change visual frame',vs.filter(v=>selected.has(v.id)).flatMap(v=>[setOp(m,'visuals',v.id,'layerId',layerId),setOp(m,'visuals',v.id,'bodyId',bodyId)]));
}
export function parentVisual(m:MapModel,key:string,parentId:string|null):Transaction {
  // Keep source-local coordinates explicit. A reparent changes the composed world pose; it is not a lossy matrix decomposition.
  return transaction('Set visual parent',[setOp(m,'visuals',key,'parentId',parentId)]);
}
export function addAssetRecord(m:MapModel,asset:Asset):Transaction {if(m.owners.has(asset.id)&&!m.collections.get('assets')?.byId.has(asset.id))throw new Error('Asset ID collides with another object');return transaction('Import visual asset',[m.owners.has(asset.id)?null:insertOp(m,'assets',[json(asset)])]);}
