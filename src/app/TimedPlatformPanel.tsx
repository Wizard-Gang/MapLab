import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import type {MapDocument} from '../contracts';
import {denormalize} from '../domain/model';
import {resolveStance,replayBytes,type ContactMap,type State} from '../physics-reference';
import {TestSession} from '../test-runtime/session';
import {platformWorld} from '../platforms/world';
import {WAIT,phases} from '../platforms/timing';
import {TIMED_CONTROLS} from '../platforms/navigation';
import {followTimed} from '../platforms/replay';
import {createTimedWorker} from '../platforms/client';
import {lockReason,type LibraryStore,type OpenDoc} from './store';
function Controls({store,doc,runtime}:{store:LibraryStore;doc:OpenDoc;runtime:ReturnType<typeof createTimedWorker>}){
 const map=useMemo(()=>denormalize(doc.state.model) as unknown as MapDocument,[doc.state.model]);
 const profiles=store.testProfiles(),[id,setId]=useState(profiles[0]?.id??''),profile=profiles.find(p=>p.id===id)??profiles[0];
 const [x,setX]=useState(64),[y,setY]=useState(100),[gx,setGX]=useState(64),[tick,setTick]=useState(0),[drift,setDrift]=useState(0);
 const [support,setSupport]=useState(''),[walking,setWalking]=useState(false),[notice,setNotice]=useState('');
 const goal=map.footholds.find(f=>f.id===support&&f.enabled)?.id??map.footholds.find(f=>f.enabled)?.id??'';
 const revision=useRef(0),submitted=useRef<{map:MapDocument;profile:unknown}|null>(null);
 const view=useSyncExternalStore(runtime.session.subscribe,runtime.session.getSnapshot,runtime.session.getSnapshot);
 const current=submitted.current?.map===map&&submitted.current.profile===profile,proof=current?view.proof:null;
 const reset=()=>{submitted.current=null;runtime.session.invalidate();setNotice('');};
 useEffect(()=>{submitted.current=null;runtime.session.invalidate();revision.current++;setNotice('');},[map,profile,runtime]);
 const solve=()=>{if(!profile)return;try{
  const w=platformWorld(map as unknown as ContactMap,profile,tick),s=resolveStance(w,x*256).find(s=>s.y===y*256);
  const initial:State={x:x*256,y:y*256,vx:0,vy:0,tick,mode:s?'ground':'air',supportId:s?.face.supportId??null,planeId:s?.face.planeId??w.defaultPlane,facing:1,jumpHeldPrev:false,jumpReleased:false,ticksSinceJump:0,dropSuppression:null,resources:{airJumps:0,dashCharges:0,cooldowns:{}},traversalId:null,climbReady:true};
  submitted.current={map,profile};setNotice('');void runtime.session.solve(map,profile,{initial,goal:{supportId:goal,x:gx*256,toleranceSu:0,rest:true,notBeforeTick:tick,notAfterTick:tick+120},controls:walking?TIMED_CONTROLS:[WAIT],algorithm:'astar'},++revision.current);
 }catch(e){reset();setNotice(String(e));}};
 const replay=()=>{if(!proof||!profile)return;try{
  const test=new TestSession(map as unknown as ContactMap,profile,proof.initial);let valid=true;
  for(const f of proof.frames)if(replayBytes(test.advance(f.input))!==replayBytes(f.frame)){valid=false;break;}
  setNotice(valid?'Timed platform Test replay verified':'Timed platform Test replay rejected');
 }catch(e){setNotice(String(e));}};
 const feedback=()=>{if(!proof||!profile)return;try{
  const measured={tick:proof.initial.tick,phases:phases(map,proof.initial.tick+drift)};
  const status=followTimed(map,profile,proof.initial,proof.frames,0,proof.initial,measured);
  setNotice(status.status==='follow'?'Phase feedback matches; follow next tick':'Replan required: '+status.reason);
 }catch(e){setNotice(String(e));}};
 return <section aria-label="Timed platform navigation"><h4>Periodic platform routes</h4>
 <p>Search wait, board, ride and exit states for periodic platforms. Supply the current clock and phase before following a route. Once or unpredictable motion requires engine prediction.</p>
 <fieldset disabled={lockReason(doc)!==null}><legend>Timed route</legend>
 <label>Timed profile<select aria-label="Timed profile" value={profile?.id??''} onChange={e=>{reset();setId(e.target.value);}}>{profiles.map(p=><option key={p.id}>{p.id}</option>)}</select></label>
 {([['Timed start X',x,setX],['Timed start Y',y,setY],['Timed goal X',gx,setGX],['Timed start tick',tick,setTick]] as const).map(([label,value,set])=><label key={label}>{label}<input aria-label={label} type="number" step={label.endsWith('tick')?1:1/256} value={value} onChange={e=>{reset();set(Number(e.target.value));}}/></label>)}
 <label>Timed goal support<select aria-label="Timed goal support" value={goal} onChange={e=>{reset();setSupport(e.target.value);}}>{map.footholds.filter(f=>f.enabled).map(f=><option key={f.id}>{f.id}</option>)}</select></label>
 <label><input aria-label="Include walking and jumping" type="checkbox" checked={walking} onChange={e=>{reset();setWalking(e.target.checked);}}/>Include walking and jumping</label>
 <button disabled={!profile||current&&view.phase==='building'} onClick={solve}>Find timed platform route</button><button onClick={reset}>Cancel timed search</button>
 <button disabled={proof?.status!=='verified reachable with replay witness'} onClick={replay}>Replay timed witness in Test</button>
 <label>Observed phase shift (ticks)<input aria-label="Observed phase shift" type="number" step="1" value={drift} onChange={e=>{setDrift(Number(e.target.value));setNotice('');}}/></label>
 <button disabled={proof?.status!=='verified reachable with replay witness'||!proof.frames.length} onClick={feedback}>Check phase feedback</button></fieldset>
 {current&&view.phase==='building'&&<p>Searching periodic platform states…</p>}{current&&view.error&&<p>{view.error}</p>}{notice&&<p aria-label="Timed platform notice">{notice}</p>}
 {proof&&<><p aria-label="Timed platform status">{proof.status}</p><p>{proof.costTicks} ticks · {proof.expanded} expansions</p>{proof.diagnostics.map((d,i)=><p key={i}>{d}</p>)}
 <ol aria-label="Timed transitions">{proof.frames.map((f,i)=><li key={i}>Tick {f.frame.state.tick}: {f.kind} · {f.frame.state.supportId??'air'}</li>)}</ol>
 <details><summary>Timed platform witness</summary><pre aria-label="Timed platform proof">{JSON.stringify(proof,null,2)}</pre></details></>}
 </section>;
}
export function TimedPlatformPanel({store,doc}:{store:LibraryStore;doc:OpenDoc}){
 const [runtime,setRuntime]=useState<ReturnType<typeof createTimedWorker>|null>(null);
 useEffect(()=>{const r=createTimedWorker();setRuntime(r);return()=>r.dispose();},[]);
 return runtime?<Controls store={store} doc={doc} runtime={runtime}/>:null;
}
