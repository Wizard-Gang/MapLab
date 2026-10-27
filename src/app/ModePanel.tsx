import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {denormalize} from '../domain/model';import type {MapDocument} from '../contracts';
import type {LibraryStore,OpenDoc} from './store';import {lockReason} from './store';
import {createModeWorker} from '../modes/client';import {ModeWorld,type Mode} from '../modes/controller';import {ModeTestSession} from '../modes/replay';
function Controls({store,doc,runtime}:{store:LibraryStore;doc:OpenDoc;runtime:ReturnType<typeof createModeWorker>}){
 const map=useMemo(()=>denormalize(doc.state.model) as unknown as MapDocument,[doc.state.model]),profiles=store.testProfiles().filter(p=>p.abilities.some(a=>a.kind==='swim'||a.kind==='fly'));
 const [id,setId]=useState(profiles[0]?.id??''),profile=profiles.find(p=>p.id===id)??profiles[0],revision=useRef(0),submitted=useRef<{map:MapDocument;profile:unknown}|null>(null);
 const [from,setFrom]=useState<Mode>('swim'),[to,setTo]=useState<Mode>('swim'),[x,setX]=useState(8),[y,setY]=useState(8),[gx,setGX]=useState(16),[gy,setGY]=useState(8),[vx,setVX]=useState(0),[vy,setVY]=useState(0),[notice,setNotice]=useState('');
 const view=useSyncExternalStore(runtime.session.subscribe,runtime.session.getSnapshot,runtime.session.getSnapshot),current=submitted.current?.map===map&&submitted.current.profile===profile,proof=current?view.proof:null;
 const reset=()=>{submitted.current=null;runtime.session.invalidate();setNotice('');};useEffect(()=>{submitted.current=null;runtime.session.invalidate();revision.current++;},[map,profile,runtime]);
 const solve=()=>{if(!profile)return;try{const world=new ModeWorld(map,profile);submitted.current={map,profile};setNotice('');void runtime.session.solve(map,profile,{initial:{x:x*256,y:y*256,vx,vy,tick:0,mode:from,supportId:from==='ground'?world.ground(x*256,y*256):null},goal:{x:gx*256,y:gy*256,mode:to},algorithm:'astar'},++revision.current);}catch(e){setNotice(String(e));}};
 const replay=()=>{if(!proof||!profile)return;try{const test=new ModeTestSession(new ModeWorld(map,profile),proof.initial);setNotice(test.replay(proof.frames)?'Mode Test replay verified':'Mode Test replay rejected');}catch(e){setNotice(String(e));}};
 return <section aria-label="Swimming and flight transitions"><h4>Swimming and flight transitions</h4><p>Choose a movement profile and start/goal poses. Water requires matching volumes; changes of mode require supported authored links.</p>
 <fieldset disabled={lockReason(doc)!==null}><legend>Mode route</legend><label>Mode profile<select aria-label="Mode profile" value={profile?.id??''} onChange={e=>{reset();setId(e.target.value);}}>{profiles.map(p=><option key={p.id}>{p.id}</option>)}</select></label>
 <label>Start mode<select aria-label="Start mode" value={from} onChange={e=>{reset();setFrom(e.target.value as Mode);}}>{['ground','swim','fly'].map(m=><option key={m}>{m}</option>)}</select></label>
 <label>Goal mode<select aria-label="Goal mode" value={to} onChange={e=>{reset();setTo(e.target.value as Mode);}}>{['ground','swim','fly'].map(m=><option key={m}>{m}</option>)}</select></label>
 {([['Mode start X',x,setX],['Mode start Y',y,setY],['Mode goal X',gx,setGX],['Mode goal Y',gy,setGY],['Mode initial VX',vx,setVX],['Mode initial VY',vy,setVY]] as const).map(([label,value,set])=><label key={label}>{label}<input aria-label={label} type="number" step={label.includes('initial')?1:1/256} value={value} onChange={e=>{reset();set(Number(e.target.value));}}/></label>)}
 <button disabled={!profile||current&&view.phase==='building'} onClick={solve}>Find mode route</button><button onClick={reset}>Cancel mode search</button><button disabled={proof?.status!=='verified reachable with replay witness'} onClick={replay}>Replay mode witness in Test</button></fieldset>
 {current&&view.phase==='building'&&<p>Searching mode and velocity states…</p>}{current&&view.error&&<p>{view.error}</p>}{notice&&<p aria-label="Mode notice">{notice}</p>}
 {proof&&<><p aria-label="Mode status">{proof.status}</p><p>{proof.costTicks} ticks · {proof.expanded} expansions</p>{proof.diagnostics.map((d,i)=><p key={i}>{d}</p>)}<details><summary>Mode witness</summary><pre aria-label="Mode proof">{JSON.stringify(proof,null,2)}</pre></details></>}
 </section>;
}
export function ModePanel({store,doc}:{store:LibraryStore;doc:OpenDoc}){const [runtime,setRuntime]=useState<ReturnType<typeof createModeWorker>|null>(null);useEffect(()=>{const r=createModeWorker();setRuntime(r);return()=>r.dispose();},[]);return runtime?<Controls store={store} doc={doc} runtime={runtime}/>:null;}
