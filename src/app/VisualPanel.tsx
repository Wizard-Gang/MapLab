import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Asset, Layer, RegionShape, Visual, VisualSource } from '../contracts';
import { parseJson } from '../contracts';
import type { MapModel } from '../domain/model';
import { setOp, transaction } from '../domain/commands';
import type { SelectionSession } from '../editor/selection';
import { addAssetRecord, addLayer, addVisual, parentVisual, visualFrame, visualLayers } from '../editor/visuals';
import { buildScene, records } from '../render/scene';
import { inspectImage } from '../assets/inspect';
import { bytesBase64, decodeImage } from '../render/assets';
import { importImage } from '../library/client';

export function VisualPanel({model,session,locked}:{readonly model:MapModel;readonly session:SelectionSession;readonly locked:boolean}):ReactNode {
  const selected=useSyncExternalStore(session.subscribe,session.getSnapshot,session.getSnapshot);
  const [layerId,setLayer]=useState(''),[kind,setKind]=useState<'group'|'sprite'|'background'|'actors'>('sprite'),[sourceKind,setSource]=useState('rect'),[assetId,setAsset]=useState(''),[points,setPoints]=useState('[[0,0],[64,0],[32,64]]'),[fill,setFill]=useState('#73b994'),[frames,setFrames]=useState<string[]>([]),[ticks,setTicks]=useState('6'),[busy,setBusy]=useState(false);
  const layers=records<Layer>(model,'layers'),visuals=records<Visual>(model,'visuals'),assets=records<Asset>(model,'assets').filter(a=>a.mediaType.startsWith('image/'));
  const currentLayer=visualLayers(model).find(l=>l.id===layerId)?.id??visualLayers(model)[0]?.id??'';
  const key=selected.keys.length===1?selected.keys[0]:undefined,l=key?.collection==='layers'?layers.find(l=>l.id===key.id):undefined,v=key?.collection==='visuals'?visuals.find(v=>v.id===key.id):undefined;
  const set=(collection:'layers'|'visuals',id:string,field:string,value:unknown):void=>{session.run(()=>transaction('Set visual property',[setOp(model,collection,id,field,value as never)]));};
  const create=():void=>{
    let key='';if(session.run(()=>{
      let source:VisualSource;
      if(sourceKind==='asset'){const a=assets.find(a=>a.id===assetId);if(!a)throw new Error('Choose an imported asset');source={kind:'asset',assetId:a.id,pivot:[0,0]};}
      else if(sourceKind==='frames'){if(!frames.length||!Number.isSafeInteger(Number(ticks))||Number(ticks)<=0)throw new Error('Choose frame assets and positive integer ticks');source={kind:'frames',assetIds:frames,pivot:[0,0],frameTicks:frames.map(()=>Number(ticks)),loop:true};}
      else {let shape:RegionShape=sourceKind==='circle'?{kind:'circle',center:[32,32],radius:32}:{kind:'rect',rect:[0,0,64,64]};if(sourceKind==='polygon'){const p=parseJson(points);if(!p.ok)throw new Error('Polygon points must be JSON coordinates');shape={kind:'polygon',points:p.value as never};}source={kind:'shape',shape,fill};}
      const result=addVisual(model,currentLayer,source);key=result.id;return result.tx;
    }))session.select([{collection:'visuals',id:key}]);
  };
  const upload=async(file:File):Promise<void>=>{
    setBusy(true);session.message('Validating visual asset…');try{
      const ext=file.name.split('.').at(-1)?.toLowerCase(),type=ext==='svg'?'image/svg+xml':ext==='png'?'image/png':ext==='webp'?'image/webp':'';if(file.size>(type==='image/svg+xml'?2:16)*1024*1024)throw new Error('Asset exceeds its encoded byte limit');
      const approved=inspectImage(new Uint8Array(await file.arrayBuffer()),type),decoded=await decodeImage(approved,new AbortController().signal);decoded.close();
      const result=await importImage(type,bytesBase64(approved.bytes));if(!result.ok)throw new Error(result.message);
      if(session.run(()=>addAssetRecord(model,result.asset))){setAsset(result.asset.id);setSource('asset');session.message('Approved project-owned asset imported; add a sprite to place it.');}
    }catch(e){session.message(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const order=useMemo(()=>buildScene(model).art,[model]);let plane=false;const relative=new Map<string,string>();for(const a of order){if(a.layer.kind==='actors')plane=true;relative.set(a.layer.id,plane?'after an actors plane':'before the first actors plane');}
  return <details className="selection-panel" open={selected.mode==='Objects'}><summary>Visual authoring</summary>
    <p className="note">Layer groups multiply opacity and visibility and have no transform. Visual parents compose local transforms; they must share a layer and rigid body frame. Foreground means paint order after an actors plane. Artwork never changes collision.</p>
    <fieldset disabled={locked||busy} aria-label="Visual creation"><legend>Layers and scenery</legend>
      <div className="commands"><label>New layer kind<select aria-label="New layer kind" value={kind} onChange={e=>setKind(e.target.value as typeof kind)}>{['sprite','background','group','actors'].map(k=><option key={k}>{k}</option>)}</select></label><button type="button" onClick={()=>{let id='';if(session.run(()=>{const r=addLayer(model,kind);id=r.id;return r.tx;})){setLayer(id);session.select([{collection:'layers',id}]);}}}>Add layer</button></div>
      <label>Scenery layer<select aria-label="Scenery layer" value={currentLayer} onChange={e=>setLayer(e.target.value)}>{visualLayers(model).map(l=><option key={l.id} value={l.id}>{l.name} · {l.id}</option>)}</select></label>
      <label>Visual source<select aria-label="Visual source" value={sourceKind} onChange={e=>setSource(e.target.value)}>{['rect','circle','polygon','asset','frames'].map(k=><option key={k}>{k}</option>)}</select></label>
      {sourceKind==='polygon'&&<label>Polygon points<textarea value={points} onChange={e=>setPoints(e.target.value)} /></label>}
      {['rect','circle','polygon'].includes(sourceKind)&&<label>Shape fill<input value={fill} onChange={e=>setFill(e.target.value)} pattern="#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?" /></label>}
      {sourceKind==='asset'&&<label>Sprite asset<select aria-label="Sprite asset" value={assetId} onChange={e=>setAsset(e.target.value)}><option value="">Choose asset</option>{assets.map(a=><option key={a.id}>{a.id}</option>)}</select></label>}
      {sourceKind==='frames'&&<>
        <label>New frame asset<select aria-label="New frame asset" value={assetId} onChange={e=>setAsset(e.target.value)}><option value="">Choose asset</option>{assets.map(a=><option key={a.id}>{a.id}</option>)}</select></label>
        <button type="button" disabled={!assetId} onClick={()=>setFrames([...frames,assetId])}>Append frame</button>
        <ol aria-label="Ordered frames">{frames.map((id,i)=><li key={i}>{id}<button type="button" aria-label={`Move frame ${i+1} up`} disabled={i===0} onClick={()=>{const next=[...frames];[next[i-1],next[i]]=[next[i]!,next[i-1]!];setFrames(next);}}>↑</button><button type="button" aria-label={`Remove frame ${i+1}`} onClick={()=>setFrames(frames.filter((_,j)=>j!==i))}>Remove</button></li>)}</ol>
        <label>Ticks per frame<input type="number" min={1} value={ticks} onChange={e=>setTicks(e.target.value)} /></label>
      </>}
      <button type="button" disabled={!currentLayer} onClick={create}>Add visual</button>
      <label>Import PNG, WebP or SVG<input aria-label="Import visual asset" type="file" accept=".png,.webp,.svg" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file);}} /></label>
      <p className="note">Imports validate before decoding, then store an approved immutable copy. SVG supports literal geometry, groups, internal gradients and clips; unsupported or executable features reject. Raster limits:16 MiB,4096 per dimension,16 MP. SVG:2 MiB,20,000 nodes,200,000 path commands.</p>
      <ul aria-label="Asset browser">{assets.map(a=><li key={a.id}><button type="button" onClick={()=>{setAsset(a.id);setSource('asset');}}>{a.id}</button> · {a.mediaType} · {a.size.join(' × ')} · {a.path}</li>)}</ul>
    </fieldset>
    {l&&<fieldset disabled={locked} aria-label="Layer inspector"><legend>Layer {l.name}</legend><p>{l.kind} · {relative.get(l.id)}</p>
      <label>Layer parent<select aria-label="Layer parent" value={l.parentId??''} onChange={e=>set('layers',l.id,'parentId',e.target.value||null)}><option value="">Root</option>{layers.filter(p=>p.kind==='group'&&p.id!==l.id).map(p=><option key={p.id}>{p.id}</option>)}</select></label>
      <label className="inline">Authored visible<input type="checkbox" checked={l.visible} onChange={e=>set('layers',l.id,'visible',e.target.checked)} /></label>
      {'occlusionFade' in l&&<label className="inline">Advisory occlusion fade<input type="checkbox" checked={l.occlusionFade!==null} onChange={e=>set('layers',l.id,'occlusionFade',e.target.checked?0.5:null)} /></label>}
      {l.kind==='background'&&<><label>Background space<select aria-label="Background space" value={l.space} onChange={e=>set('layers',l.id,'space',e.target.value)}><option>world</option><option>camera</option></select></label><label>Repeat axes<select aria-label="Repeat axes" value={l.repeat} onChange={e=>set('layers',l.id,'repeat',e.target.value)}>{['none','x','y','xy'].map(n=><option key={n}>{n}</option>)}</select></label></>}
      <p className="note">Edit order, opacity, parallax, origin, repeat size, phase and scroll in the numeric inspector above. Advisory fade never hides collision.</p>
    </fieldset>}
    {v&&<fieldset disabled={locked} aria-label="Visual inspector"><legend>Visual {v.name}</legend>
      <label>Visual layer<select aria-label="Visual layer" disabled={v.parentId!==null} value={v.layerId} onChange={e=>session.run(()=>visualFrame(model,v.id,e.target.value,v.bodyId))}>{visualLayers(model).map(l=><option key={l.id}>{l.id}</option>)}</select></label>
      <label>Visual parent<select aria-label="Visual parent" value={v.parentId??''} onChange={e=>session.run(()=>parentVisual(model,v.id,e.target.value||null))}><option value="">No parent</option>{visuals.filter(p=>p.id!==v.id&&p.layerId===v.layerId&&p.bodyId===v.bodyId).map(p=><option key={p.id}>{p.id}</option>)}</select></label>
      <label>Rigid body frame<select aria-label="Rigid body frame" disabled={v.parentId!==null} value={v.bodyId??''} onChange={e=>session.run(()=>visualFrame(model,v.id,v.layerId,e.target.value||null))}><option value="">World</option>{model.collections.get('bodies')?.order.map(id=><option key={id}>{id}</option>)}</select></label>
      {(['mirrorX','mirrorY'] as const).map(k=><label className="inline" key={k}>{k}<input type="checkbox" checked={v.transform[k]} onChange={e=>set('visuals',v.id,'transform',{...v.transform,[k]:e.target.checked})} /></label>)}
      {v.source.kind==='asset'&&<label>Visual asset<select aria-label="Visual asset" value={v.source.assetId} onChange={e=>set('visuals',v.id,'source',{...v.source,assetId:e.target.value})}>{assets.map(a=><option key={a.id}>{a.id}</option>)}</select></label>}
      {v.source.kind==='frames'&&v.source.assetIds.map((id,i)=><label key={i}>Frame {i+1} asset<select aria-label={`Frame ${i+1} asset`} value={id} onChange={e=>{if(v.source.kind==='frames')set('visuals',v.id,'source',{...v.source,assetIds:v.source.assetIds.map((a,j)=>j===i?e.target.value:a)});}}>{assets.map(a=><option key={a.id}>{a.id}</option>)}</select></label>)}
      {v.source.kind==='shape'&&<label>Visual fill<input key={`${v.id}/${v.source.fill}`} defaultValue={v.source.fill} onBlur={e=>set('visuals',v.id,'source',{...v.source,fill:e.target.value})} /></label>}
      {v.source.kind==='frames'&&<label className="inline">Loop frames<input type="checkbox" checked={v.source.loop} onChange={e=>set('visuals',v.id,'source',{...v.source,loop:e.target.checked})} /></label>}
      <p className="note">Numeric fields above edit local position, scale, rotation, order, shape geometry, asset pivot and frame durations. Reparenting retains local values and changes the composed world pose.</p>
    </fieldset>}
  </details>;
}
