import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {denormalize} from '../domain/model';import type {MapDocument} from '../contracts';
import type {LibraryStore,OpenDoc} from './store';import {lockReason} from './store';
import {createFlightWorker} from '../flight/client';import {flightAnchor,type FlightQuery} from '../flight/planner';import {buildScene} from '../render/scene';
function Controls({store,doc,runtime}:{store:LibraryStore;doc:OpenDoc;runtime:ReturnType<typeof createFlightWorker>}){
 const map=useMemo(()=>denormalize(doc.state.model) as unknown as MapDocument,[doc.state.model]),scene=useMemo(()=>buildScene(doc.state.model),[doc.state.model]),profiles=store.testProfiles().filter(p=>p.abilities.some(a=>a.kind==='fly'));
 const [profileId,setProfile]=useState(profiles[0]?.id??''),profile=profiles.find(p=>p.id===profileId)??profiles[0],actors=map.entities.filter(e=>e.enabled&&'movementId'in e&&e.movementId===profile?.id&&'ai'in e),[actorId,setActor]=useState(''),actor=actors.find(e=>e.id===actorId)??actors[0];
 const [algorithm,setAlgorithm]=useState<'astar'|'dijkstra'>('astar'),[x,setX]=useState(832),[y,setY]=useState(176),[notice,setNotice]=useState(''),submitted=useRef<{map:MapDocument;profile:unknown}|null>(null),revision=useRef(0);
 const view=useSyncExternalStore(runtime.session.subscribe,runtime.session.getSnapshot,runtime.session.getSnapshot),current=submitted.current?.map===map&&submitted.current.profile===profile;
 const reset=()=>{submitted.current=null;runtime.session.invalidate();setNotice('');};useEffect(()=>{submitted.current=null;runtime.session.invalidate();revision.current++;},[map,profile,runtime]);
 const solve=(patrol:boolean)=>{if(!profile||!actor)return;try{const pos=flightAnchor(map,actor.anchor),query:FlightQuery=patrol?{kind:'patrol',entityId:actor.id,algorithm}:{kind:'route',initial:{x:pos[0],y:pos[1],vx:0,vy:0,tick:0,mode:'fly'},goal:[x*256,y*256],algorithm};submitted.current={map,profile};setNotice('');void runtime.session.solve(map,profile,query,++revision.current);}catch(e){setNotice(String(e));}};
 const proof=current?view.proof:null;
 return <section aria-label="Free-space flight navigation"><h4>Reference flight</h4><p>Separate full-body flight planner. Native hover/fly only; no ground-graph reuse or inferred mode entry. Engine AI and fallback execution remain consumer-owned.</p>
 <fieldset disabled={lockReason(doc)!==null}><legend>Flight query</legend>
 <label>Flight profile<select aria-label="Flight profile" value={profile?.id??''} onChange={e=>{reset();setProfile(e.target.value);}}>{profiles.map(p=><option key={p.id}>{p.id}</option>)}</select></label>
 <label>Flying actor<select aria-label="Flight actor" value={actor?.id??''} onChange={e=>{reset();setActor(e.target.value);}}>{actors.map(e=><option key={e.id}>{e.id}</option>)}</select></label>
 <p aria-label="Flight bindings">{JSON.stringify({bindings:map.navigation.modeVolumes.filter(v=>v.mode==='fly'&&v.profileIds.includes(profile?.id??'')),category:profile?.category,mask:profile?.mask,collider:profile?.collider})}</p>
 <label>Flight target X (WU)<input aria-label="Flight target X" type="number" step={1/256} value={x} onChange={e=>{reset();setX(Number(e.target.value));}}/></label><label>Flight target Y (WU)<input aria-label="Flight target Y" type="number" step={1/256} value={y} onChange={e=>{reset();setY(Number(e.target.value));}}/></label>
 <label>Flight search<select aria-label="Flight search" value={algorithm} onChange={e=>{reset();setAlgorithm(e.target.value as typeof algorithm);}}><option value="astar">A*</option><option value="dijkstra">Dijkstra</option></select></label>
 <button disabled={!actor||!profile||current&&view.phase==='building'} onClick={()=>solve(false)}>Find flight route</button><button disabled={!actor||!profile||current&&view.phase==='building'} onClick={()=>solve(true)}>Verify flying patrol</button><button onClick={reset}>Cancel flight search</button></fieldset>
 {notice&&<p aria-label="Flight notice">{notice}</p>}{current&&view.phase==='building'&&<p aria-label="Flight progress">Building bounded free-space flight witness…</p>}{current&&view.error&&<p aria-label="Flight error">{view.error}</p>}
 {proof&&<><span aria-label="Flight status" data-status={proof.status}>{proof.status}</span><p>{proof.durationTicks} movement/wait ticks · {proof.expanded} lattice expansions · {proof.replayTicks} replay work ticks</p>{proof.diagnostics.map((d,i)=><p key={i}>{d}</p>)}
 <p aria-label="Flight fallback">{JSON.stringify(proof.fallback)}</p><p>Reference static proof only; no engine parity or global reachability claim.</p>
 {proof.status==='verified reachable with replay witness'&&<svg aria-label="Flight route overlay" viewBox={scene.bounds.join(' ')} style={{width:'100%',maxHeight:360,background:'#16251f'}}>
 {(scene.passes.get('Collision')??[]).map((p,i)=><polyline key={i} points={p.points.map(v=>v.join(',')).join(' ')} fill="none" stroke={p.color}/>)}
 <polyline points={[proof.initial!,...proof.frames].map(s=>s.x/256+','+s.y/256).join(' ')} fill="none" stroke="#ffd98b" strokeWidth={2}/>
 {proof.legs.map((l,i)=><rect key={i} x={l.target[0]/256-(profile?.collider.kind==='rect'?profile.collider.width/2:0)} y={l.target[1]/256-(profile?.collider.height??0)} width={profile?.collider.kind==='rect'?profile.collider.width:0} height={profile?.collider.height??0} fill="none" stroke="#86d7ff"/>)}
 </svg>}<details><summary>Flight witness and assumptions</summary><pre aria-label="Flight proof">{JSON.stringify(proof,null,2)}</pre></details></>}
 </section>;
}
export function FlightPanel({store,doc}:{store:LibraryStore;doc:OpenDoc}){const [runtime,setRuntime]=useState<ReturnType<typeof createFlightWorker>|null>(null);useEffect(()=>{const r=createFlightWorker();setRuntime(r);return()=>r.dispose();},[]);return runtime?<Controls store={store} doc={doc} runtime={runtime}/>:null;}
