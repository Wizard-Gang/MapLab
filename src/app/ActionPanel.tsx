import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {denormalize} from '../domain/model';
import type {MapDocument} from '../contracts';
import type {LibraryStore,OpenDoc} from './store';
import {lockReason} from './store';
import {createActionWorker} from '../actions/client';
import {ActionWorld,type ActionInput} from '../actions/controller';
import {ActionTestSession} from '../actions/replay';
import {resolveStance} from '../physics-reference/controller';
function Controls({store,doc,runtime}:{store:LibraryStore;doc:OpenDoc;runtime:ReturnType<typeof createActionWorker>}){
 const map=useMemo(()=>denormalize(doc.state.model) as unknown as MapDocument,[doc.state.model]);
 const profiles=store.testProfiles().filter(p=>p.abilities.some(a=>['teleport','launch','modifier'].includes(a.kind)));
 const [id,setId]=useState(profiles[0]?.id??''),profile=profiles.find(p=>p.id===id)??profiles[0];
 const revision=useRef(0),submitted=useRef<{map:MapDocument;profile:unknown}|null>(null);
 const [x,setX]=useState(8),[y,setY]=useState(40),[gx,setGX]=useState(48),[gy,setGY]=useState(40);
 const [kind,setKind]=useState<'teleport'|'launch'|'modifier'>('teleport'),[ix,setIX]=useState(256),[iy,setIY]=useState(-512);
 const [num,setNum]=useState(2),[den,setDen]=useState(1),[duration,setDuration]=useState(60),[notice,setNotice]=useState('');
 const view=useSyncExternalStore(runtime.session.subscribe,runtime.session.getSnapshot,runtime.session.getSnapshot);
 const current=submitted.current?.map===map&&submitted.current.profile===profile,proof=current?view.proof:null;
 const reset=()=>{submitted.current=null;runtime.session.invalidate();setNotice('');};
 useEffect(()=>{submitted.current=null;runtime.session.invalidate();revision.current++;},[map,profile,runtime]);
 const solve=()=>{if(!profile)return;try{
  const w=new ActionWorld(map,profile),stance=resolveStance(w.collision,x*256).find(s=>s.y===y*256);
  let input:ActionInput;
  if(kind==='teleport'){const teleport=profile.abilities.find(a=>a.kind==='teleport'),anchor=map.waypoints.find(w=>w.anchor.kind==='world'&&w.anchor.point[0]===gx&&w.anchor.point[1]===gy);input={kind,target:[gx*256,gy*256],anchorId:teleport?.target==='anchor'?anchor?.id??null:null};}
  else if(kind==='launch')input={kind,impulse:[ix,iy],mode:'set'};
  else input={kind,id:'buff.preview',definition:{key:'maplab.modifier.kinematic',version:1,params:{field:'ground.runSpeed',num,den,durationTicks:duration}}};
  submitted.current={map,profile};setNotice('');void runtime.session.solve(map,profile,{initial:{x:x*256,y:y*256,vx:0,vy:0,tick:0,mode:stance?'ground':'air',supportId:stance?.face.supportId??null,planeId:stance?(stance.face.planeId??w.collision.defaultPlane):null,facing:1,cooldownTicks:0,launched:false,modifiers:[]},goal:{x:gx*256,y:gy*256,toleranceSu:0,mode:'ground',rest:true},actions:[input],algorithm:'astar'},++revision.current);
 }catch(e){reset();setNotice(String(e));}};
 const replay=()=>{if(!proof||!profile)return;try{const test=new ActionTestSession(new ActionWorld(map,profile),proof.initial);setNotice(test.replay(proof.frames)?'Action Test replay verified':'Action Test replay rejected');}catch(e){setNotice(String(e));}};
 return <section aria-label="Stateful action navigation"><h4>Teleport, launch and modifiers</h4>
 <p>Find a route from an explicit action and walking controls. Destinations need full body clearance; launches must recover to a grounded stop. Temporary speed modifiers expire during the route.</p>
 <fieldset disabled={lockReason(doc)!==null}><legend>Stateful route</legend>
 <label>Action profile<select aria-label="Action profile" value={profile?.id??''} onChange={e=>{reset();setId(e.target.value);}}>{profiles.map(p=><option key={p.id}>{p.id}</option>)}</select></label>
 <label>Action kind<select aria-label="Action kind" value={kind} onChange={e=>{reset();setKind(e.target.value as typeof kind);}}><option value="teleport">Teleport</option><option value="launch">Launch / knockback</option><option value="modifier">Temporary speed modifier</option></select></label>
 {([['Action start X',x,setX],['Action start Y',y,setY],['Action goal X',gx,setGX],['Action goal Y',gy,setGY]] as const).map(([label,value,set])=><label key={label}>{label}<input aria-label={label} type="number" step={1/256} value={value} onChange={e=>{reset();set(Number(e.target.value));}}/></label>)}
 {kind==='launch'&&([['Launch impulse X',ix,setIX],['Launch impulse Y',iy,setIY]] as const).map(([label,value,set])=><label key={label}>{label}<input aria-label={label} type="number" step="1" value={value} onChange={e=>{reset();set(Number(e.target.value));}}/></label>)}
 {kind==='modifier'&&([['Speed multiplier numerator',num,setNum],['Speed multiplier denominator',den,setDen],['Modifier duration ticks',duration,setDuration]] as const).map(([label,value,set])=><label key={label}>{label}<input aria-label={label} type="number" step="1" value={value} onChange={e=>{reset();set(Number(e.target.value));}}/></label>)}
 <button disabled={!profile||current&&view.phase==='building'} onClick={solve}>Find action route</button><button onClick={reset}>Cancel action search</button><button disabled={proof?.status!=='verified reachable with replay witness'} onClick={replay}>Replay action witness in Test</button></fieldset>
 {current&&view.phase==='building'&&<p>Searching action states…</p>}{current&&view.error&&<p>{view.error}</p>}{notice&&<p aria-label="Action notice">{notice}</p>}
 {proof&&<><p aria-label="Action status">{proof.status}</p><p>{proof.costTicks} ticks · {proof.expanded} expansions</p>{proof.diagnostics.map((d,i)=><p key={i}>{d}</p>)}<details><summary>Action witness</summary><pre aria-label="Action proof">{JSON.stringify(proof,null,2)}</pre></details></>}
 </section>;
}
export function ActionPanel({store,doc}:{store:LibraryStore;doc:OpenDoc}){
 const [runtime,setRuntime]=useState<ReturnType<typeof createActionWorker>|null>(null);
 useEffect(()=>{const r=createActionWorker();setRuntime(r);return()=>r.dispose();},[]);
 return runtime?<Controls store={store} doc={doc} runtime={runtime}/>:null;
}
