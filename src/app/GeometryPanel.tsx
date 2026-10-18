import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { MapModel } from '../domain/model';
import type { SelectionSession } from '../editor/selection';
import { assignSolidEdge, connectFootholds, disconnectFootholds, foothold, joinFootholds, physicalHandles, splitFoothold, type Endpoint } from '../editor/geometry';
import { records } from '../render/scene';
import { shapeEdges, type CollisionBody } from '../contracts';

export function GeometryPanel({ model, session, locked }: { readonly model: MapModel; readonly session: SelectionSession; readonly locked: boolean }): ReactNode {
  const s=useSyncExternalStore(session.subscribe,session.getSnapshot,session.getSnapshot);
  const [x,setX]=useState(''),[target,setTarget]=useState(''),[end,setEnd]=useState<Endpoint>('b'),[other,setOther]=useState<Endpoint>('a'),[edge,setEdge]=useState('');
  const key=s.keys.length===1?s.keys[0]:undefined,f=key?.collection==='footholds'?foothold(model,key.id):null;
  const handles=useMemo(()=>physicalHandles(model,s.keys),[model,s.keys]);
  const edges=useMemo(()=>records<CollisionBody>(model,'bodies').flatMap(b=>b.shapes.flatMap(shape=>shapeEdges(shape).map((_,edgeIndex)=>({value:JSON.stringify({bodyId:b.id,shapeId:shape.id,edgeIndex}),label:`${b.id} / ${shape.id} / ${edgeIndex}`})))),[model]);
  return <details className="selection-panel" open={s.mode==='Platforms'||s.mode==='Collision'}><summary>Physical geometry tools</summary>
    <p className="note">Platforms and Collision modes expose endpoint, body origin and collider vertex handles. Grid/free snap uses world coordinates; drag a handle to preview, release for one undo, Escape to cancel. Solid edits update the owning collider. Art has independent visibility.</p>
    <ul aria-label="Physical handles">{handles.map(h=><li key={h.label}><span aria-label={h.label}>{h.label}: {h.point.join(', ')} WU</span></li>)}</ul>
    {f&&<fieldset disabled={locked}><legend>Foothold {f.id}</legend>
      <p>{f.mode} · owner {f.ownerBodyId??'world'} · normal up · direction {f.direction}</p>
      <label>Split X in owner frame<input aria-label="Split X in owner frame" type="number" step={0.0625} value={x} placeholder={String((f.a[0]+f.b[0])/2)} onChange={e=>setX(e.target.value)} /></label>
      <button type="button" onClick={()=>session.run(()=>splitFoothold(model,f.id,x.trim()?Number(x):(f.a[0]+f.b[0])/2))}>Split foothold</button>
      <label>Endpoint<select aria-label="Endpoint" value={end} onChange={e=>setEnd(e.target.value as Endpoint)}><option>a</option><option>b</option></select></label>
      <label>Target foothold<select aria-label="Target foothold" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choose foothold</option>{model.collections.get('footholds')?.order.filter(id=>id!==f.id).map(id=><option key={id}>{id}</option>)}</select></label>
      <label>Target endpoint<select aria-label="Target endpoint" value={other} onChange={e=>setOther(e.target.value as Endpoint)}><option>a</option><option>b</option></select></label>
      <button type="button" disabled={!target} onClick={()=>session.run(()=>connectFootholds(model,f.id,end,target,other))}>Snap and connect</button>
      <button type="button" onClick={()=>session.run(()=>disconnectFootholds(model,f.id,end))}>Disconnect endpoint</button>
      <button type="button" disabled={!target} onClick={()=>session.run(()=>joinFootholds(model,f.id,target))}>Join retaining selected ID</button>
      <label>Solid owner edge<select aria-label="Solid owner edge" value={edge} onChange={e=>setEdge(e.target.value)}><option value="">Choose body / shape / edge</option>{edges.map(({value,label})=><option key={value} value={value}>{label}</option>)}</select></label>
      <button type="button" disabled={!edge} onClick={()=>session.run(()=>assignSolidEdge(model,f.id,JSON.parse(edge)))}>Assign solid edge</button>
      <button type="button" onClick={()=>session.run(()=>assignSolidEdge(model,f.id,null))}>Make one-way</button>
    </fieldset>}
  </details>;
}
