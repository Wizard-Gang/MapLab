import {useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import type {LibraryStore,OpenDoc} from './store';
import {lockReason} from './store';
import {denormalize} from '../domain/model';
import type {MapDocument} from '../contracts/document-types';
import {blockers,type Blocker} from '../navigation/blockers';
import {createBlockerWorker} from '../navigation/blocker-client';
function Controls({runtime,store,doc}:{readonly runtime:ReturnType<typeof createBlockerWorker>;readonly store:LibraryStore;readonly doc:OpenDoc}):ReactNode{
 const view=useSyncExternalStore(runtime.session.subscribe,runtime.session.getSnapshot,runtime.session.getSnapshot),map=useMemo(()=>denormalize(doc.state.model) as unknown as MapDocument,[doc.state.model]);
 const profiles=store.testProfiles(),[profileId,setProfile]=useState(profiles[0]?.id??''),profile=profiles.find(p=>p.id===profileId)??profiles[0];
 const [items,setItems]=useState<readonly Blocker[]>([]),[started,setStarted]=useState(false),[notice,setNotice]=useState('');
 const [x,setX]=useState(map.bounds[0]+map.bounds[2]/2),[y,setY]=useState(map.bounds[1]+map.bounds[3]/3),[width,setWidth]=useState(16),[height,setHeight]=useState(64);
 const serial=useRef(0),revision=useRef(0),submitted=useRef<{map:MapDocument;profile:unknown;items:readonly Blocker[]}|null>(null);
 const current=submitted.current?.map===map&&submitted.current.profile===profile&&submitted.current.items===items&&started;
 useEffect(()=>{
  if(!started||!profile)return;submitted.current={map,profile,items};runtime.session.update(map,profile,++revision.current,items);
  return()=>{runtime.session.invalidate();};
 },[map,profile,items,started,runtime]);
 const report=current?view.report:null;
 return <section aria-label="Runtime blocker preview"><h4>Runtime blockers</h4><p>Temporary static blocker snapshots. These do not edit or save the map. Previewed jump, fall and drop actions retain their launch conditions; they are not a complete route or gameplay AI.</p>
  <fieldset disabled={lockReason(doc)!==null}><legend>Blocker snapshot</legend>
   <label>Blocker movement profile<select aria-label="Blocker movement profile" value={profile?.id??''} onChange={e=>setProfile(e.target.value)}>{profiles.map(p=><option key={p.id}>{p.id}</option>)}</select></label>
   <label>X (WU)<input aria-label="Blocker X" type="number" value={x} onChange={e=>setX(Number(e.target.value))}/></label>
   <label>Y (WU)<input aria-label="Blocker Y" type="number" value={y} onChange={e=>setY(Number(e.target.value))}/></label>
   <label>Width (WU)<input aria-label="Blocker width" type="number" value={width} onChange={e=>setWidth(Number(e.target.value))}/></label>
   <label>Height (WU)<input aria-label="Blocker height" type="number" value={height} onChange={e=>setHeight(Number(e.target.value))}/></label>
   <button type="button" disabled={!profile} onClick={()=>{setNotice('');setStarted(true);if(started&&profile){submitted.current={map,profile,items};runtime.session.update(map,profile,++revision.current,items);}}}>Build blocker preview</button>
   <button type="button" onClick={()=>{try{const next=blockers([...items,{id:`runtime.preview-${++serial.current}`,boundsSu:[x*256,y*256,(x+width)*256,(y+height)*256]}]);setItems(next);setStarted(true);setNotice('');}catch(e){setNotice(String(e));}}}>Insert runtime blocker</button>
   <button type="button" onClick={()=>{setStarted(false);submitted.current=null;runtime.session.invalidate();}}>Cancel blocker preview</button>
  </fieldset>
  <ul aria-label="Runtime blocker list">{items.map(b=><li key={b.id}>{b.id} · [{b.boundsSu.map(v=>v/256).join(', ')}] WU <button type="button" onClick={()=>{setItems(items.filter(i=>i.id!==b.id));setStarted(true);}}>Remove {b.id}</button></li>)}</ul>
  {notice&&<p aria-label="Blocker input notice">{notice}</p>}
  <output aria-label="Blocker preview status">{!started?'Idle':!current||view.phase==='building'?'Regenerating bounded candidates':view.error||report?.result.status||view.phase}</output>
  {current&&view.phase==='building'&&<p>{view.disabledKeys.length} old swept witnesses disabled; no obsolete proof is displayed.</p>}
  {report&&<><p aria-label="Blocker cache status">{report.cacheWarm?'Physical cache warm':'Physical candidates regenerated'} · {report.reusedEdges} retained witnesses · {report.regeneratedSamples} sampled candidates · {report.disabledKeys.length} swept witnesses invalidated</p>
   <p>{report.result.edges.length} reference action witnesses · regions {Object.keys(report.regionRevisions).join(' / ')||'none'}</p>
   {report.result.diagnostics.map((d,i)=><p key={i}>{d}</p>)}
   <svg aria-label="Runtime blocker action overlay" viewBox={map.bounds.join(' ')} style={{width:'100%',maxHeight:320,background:'#16251f'}}>
    {map.footholds.map(f=><line key={f.id} x1={f.a[0]} y1={f.a[1]} x2={f.b[0]} y2={f.b[1]} stroke="#83bc9f"/>)}
    {report.result.edges.slice(0,64).map(e=><polyline key={e.key} points={[e.initial,...e.frames.map(f=>f.state)].map(s=>`${s.x/256},${s.y/256}`).join(' ')} fill="none" stroke="#86d7ff" strokeWidth={1}/>)}
    {items.map(b=><rect key={b.id} x={b.boundsSu[0]/256} y={b.boundsSu[1]/256} width={(b.boundsSu[2]-b.boundsSu[0])/256} height={(b.boundsSu[3]-b.boundsSu[1])/256} fill="#ed9a45" opacity={0.8}/>)}
   </svg><p>Showing up to 64 action trajectories. Source remains immutable. No route found is only a bounded sampling result.</p>
   <details><summary>Blocker revisions and assumptions</summary><pre aria-label="Blocker dependency report">{JSON.stringify({revision:report.revision,sourceKey:report.sourceKey,identity:report.result.identity,affectedGeometry:report.affectedGeometry,dirtyBoundsSu:report.dirtyBoundsSu,regenerationBoundsSu:report.regenerationBoundsSu,regionRevisions:report.regionRevisions,disabledKeys:report.disabledKeys,assumptions:report.assumptions},null,2)}</pre></details>
  </>}
 </section>;
}
export function BlockerPanel({store,doc}:{readonly store:LibraryStore;readonly doc:OpenDoc}):ReactNode{
 const [runtime,setRuntime]=useState<ReturnType<typeof createBlockerWorker>|null>(null);
 useEffect(()=>{const r=createBlockerWorker();setRuntime(r);return()=>r.dispose();},[]);
 return runtime?<Controls runtime={runtime} store={store} doc={doc}/>:<p>Opening runtime blocker preview…</p>;
}
