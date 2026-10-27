import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {denormalize} from '../domain/model';import type {MapDocument} from '../contracts';
import type {LibraryStore,OpenDoc} from './store';import {lockReason} from './store';
import {createGrappleWorker} from '../grapple/client';import {GrappleWorld} from '../grapple/controller';import {GrappleTestSession} from '../grapple/replay';
function Controls({store,doc,runtime}:{store:LibraryStore;doc:OpenDoc;runtime:ReturnType<typeof createGrappleWorker>}){
 const map=useMemo(()=>denormalize(doc.state.model) as unknown as MapDocument,[doc.state.model]),profiles=store.testProfiles().filter(p=>p.abilities.some(a=>a.kind==='grapple'));
 const [id,setId]=useState(profiles[0]?.id??''),profile=profiles.find(p=>p.id===id)??profiles[0],revision=useRef(0),submitted=useRef<{map:MapDocument;profile:unknown}|null>(null);
 const [x,setX]=useState(32),[y,setY]=useState(26),[gx,setGX]=useState(32),[gy,setGY]=useState(26),[vx,setVX]=useState(0),[vy,setVY]=useState(0),[mode,setMode]=useState<'attached'|'free'>('attached'),[notice,setNotice]=useState('');
 const view=useSyncExternalStore(runtime.session.subscribe,runtime.session.getSnapshot,runtime.session.getSnapshot),current=submitted.current?.map===map&&submitted.current.profile===profile,proof=current?view.proof:null;
 const reset=()=>{submitted.current=null;runtime.session.invalidate();setNotice('');};useEffect(()=>{submitted.current=null;runtime.session.invalidate();revision.current++;},[map,profile,runtime]);
 const solve=()=>{if(!profile)return;submitted.current={map,profile};setNotice('');void runtime.session.solve(map,profile,{initial:{x:x*256,y:y*256,vx,vy,tick:0,attachment:null},goal:{x:gx*256,y:gy*256,toleranceSu:0,mode}},++revision.current);};
 const replay=()=>{if(!proof||!profile)return;try{const test=new GrappleTestSession(new GrappleWorld(map,profile),proof.initial);setNotice(test.replay(proof.frames)?'Grapple Test replay verified':'Grapple Test replay rejected');}catch(e){setNotice(String(e));}};
 return <section aria-label="Grapple navigation"><h4>Grapple navigation</h4><p>Plan attachment, reel and swing actions using authored physical anchors. Straight ropes require clear lines and full body clearance. Search has a finite budget.</p>
 <fieldset disabled={lockReason(doc)!==null}><legend>Grapple route</legend><label>Grapple profile<select aria-label="Grapple profile" value={profile?.id??''} onChange={e=>{reset();setId(e.target.value);}}>{profiles.map(p=><option key={p.id}>{p.id}</option>)}</select></label>
 {([['Grapple start X',x,setX],['Grapple start Y',y,setY],['Grapple goal X',gx,setGX],['Grapple goal Y',gy,setGY],['Grapple initial VX',vx,setVX],['Grapple initial VY',vy,setVY]] as const).map(([label,value,set])=><label key={label}>{label}<input aria-label={label} type="number" step={label.includes('initial')?1:1/256} value={value} onChange={e=>{reset();set(Number(e.target.value));}}/></label>)}
 <label>Grapple goal mode<select aria-label="Grapple goal mode" value={mode} onChange={e=>{reset();setMode(e.target.value as typeof mode);}}><option value="attached">Attached</option><option value="free">Released / free</option></select></label>
 <button disabled={!profile||current&&view.phase==='building'} onClick={solve}>Find grapple route</button><button onClick={reset}>Cancel grapple search</button><button disabled={proof?.status!=='verified reachable with replay witness'} onClick={replay}>Replay grapple witness in Test</button></fieldset>
 {current&&view.phase==='building'&&<p>Searching grapple states…</p>}{current&&view.error&&<p>{view.error}</p>}{notice&&<p aria-label="Grapple notice">{notice}</p>}
 {proof&&<><p aria-label="Grapple status">{proof.status}</p><p>{proof.costTicks} ticks · {proof.expanded} expansions</p>{proof.diagnostics.map((d,i)=><p key={i}>{d}</p>)}<details><summary>Grapple witness</summary><pre aria-label="Grapple proof">{JSON.stringify(proof,null,2)}</pre></details></>}
 </section>;
}
export function GrapplePanel({store,doc}:{store:LibraryStore;doc:OpenDoc}){const [runtime,setRuntime]=useState<ReturnType<typeof createGrappleWorker>|null>(null);useEffect(()=>{const r=createGrappleWorker();setRuntime(r);return()=>r.dispose();},[]);return runtime?<Controls store={store} doc={doc} runtime={runtime}/>:null;}
