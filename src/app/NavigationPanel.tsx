import {BlockerPanel} from './BlockerPanel';
import {FlightPanel} from './FlightPanel';
import {useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import type {LibraryStore,OpenDoc} from './store';
import {lockReason} from './store';
import {denormalize} from '../domain/model';
import type {MapDocument} from '../contracts/document-types';
import {createWorld,type ContactMap,type ClimbState} from '../physics-reference';
import {anchorState,type Goal,type RouteProof} from '../navigation/routes';
import {createRoutingWorker} from '../navigation/routing-client';
import type {RouteQuery} from '../navigation/routing-protocol';
import {buildScene} from '../render/scene';

function Proof({proof,doc}:{readonly proof:RouteProof;readonly doc:OpenDoc}):ReactNode{
 const scene=useMemo(()=>buildScene(doc.state.model),[doc.state.model]);
 return <div>
  <output aria-label="Reference route status" data-status={proof.status}>{proof.status}</output>
  <p>{proof.durationTicks} movement/wait ticks · cost {proof.costTicks} ticks · {proof.expanded} augmented states · {proof.refinements} replayed refinements</p>
  {proof.diagnostics.map((d,i)=><p className="note" key={i}>{d}</p>)}
  <p className="note">Named reference controller and static source only. Bounded sampling; no runtime AI, engine parity or global completeness claim. Failed search is not proof of physical unreachability.</p>
  <ol aria-label="Route breakdown">{proof.actions.map((a,i)=><li key={i}>{a.kind}: {a.durationTicks} ticks + {a.penaltyTicks} penalty · {a.initial.supportId??a.initial.mode} → {a.terminal.supportId??a.terminal.mode} · velocity ({a.initial.vx},{a.initial.vy}) → ({a.terminal.vx},{a.terminal.vy})</li>)}</ol>
  {proof.status==='verified reachable with replay witness'&&<svg aria-label="Reference route overlay" viewBox={scene.bounds.join(' ')} style={{width:'100%',maxHeight:360,background:'#16251f'}}>
   {['Footholds','Collision'].flatMap(layer=>(scene.passes.get(layer as 'Footholds'|'Collision')??[]).map((p,i)=><polyline key={layer+i} points={p.points.map(p=>p.join(',')).join(' ')} fill="none" stroke={p.color} strokeWidth={2}/>))}
   <polyline aria-label="Verified foot trajectory" points={[proof.initial!,...proof.frames.map(f=>f.state)].map(s=>`${s.x/256},${s.y/256}`).join(' ')} fill="none" stroke="#86d7ff" strokeWidth={2}/>
  </svg>}
  <details><summary>Reference input and terminal state</summary><pre aria-label="Route recording">{JSON.stringify({identity:proof.identity,querySha256:proof.querySha256,settings:proof.settings,goals:proof.goals,targetRegionId:proof.targetRegionId,initial:proof.initial,input:proof.input,terminal:proof.terminal,durationTicks:proof.durationTicks,assumptions:proof.assumptions},null,2)}</pre></details>
 </div>;
}
const noTestSubscribe=()=>()=>{},noTestSnapshot=()=>null;
function Controls({runtime,store,doc}:{readonly runtime:ReturnType<typeof createRoutingWorker>;readonly store:LibraryStore;readonly doc:OpenDoc}):ReactNode{
 const view=useSyncExternalStore(runtime.session.subscribe,runtime.session.getSnapshot,runtime.session.getSnapshot),map=useMemo(()=>denormalize(doc.state.model) as unknown as MapDocument,[doc.state.model]);
 const profiles=store.testProfiles(),sources=map.entities.filter(e=>e.enabled&&['playerStart','enemySpawn','npc'].includes(e.kind));
 const [profileId,setProfile]=useState(profiles[0]?.id??''),profile=profiles.find(p=>p.id===profileId)??profiles[0];
 const [sourceId,setSource]=useState(sources[0]?.id??''),source=sources.find(e=>e.id===sourceId)??sources[0];
 const [supportId,setSupport]=useState(map.footholds[0]?.id??''),support=map.footholds.find(f=>f.id===supportId)??map.footholds[0];
 const [x,setX]=useState(support?(support.a[0]+support.b[0])/2:0),[target,setTarget]=useState('manual'),[algorithm,setAlgorithm]=useState<'astar'|'dijkstra'>('astar'),[notice,setNotice]=useState('');
 const [actual,setActual]=useState<ClimbState|null>(null),revision=useRef(0),submitted=useRef<{map:MapDocument;profile:unknown}|null>(null);
 // Hide a reply immediately on a source/profile render; cancel its transport in the effect.
 const current=submitted.current?.map===map&&submitted.current.profile===profile;
 const reset=()=>{revision.current++;submitted.current=null;runtime.session.invalidate();setNotice('');};
 useEffect(()=>{revision.current++;submitted.current=null;runtime.session.invalidate();setActual(null);},[map,profile,runtime]);
 const run=store.test(doc.id),testView=useSyncExternalStore(run?.subscribe??noTestSubscribe,run?.getSnapshot??noTestSnapshot,run?.getSnapshot??noTestSnapshot),canUseTest=!!run&&testView?.mapId===doc.id&&JSON.stringify(run.profile)===JSON.stringify(profile);
 const solve=(patrol=false):void=>{
  if(!profile||!source)return;
  try{
   let query:RouteQuery;
   if(patrol)query={kind:'patrol',entityId:source.id,algorithm};
   else if(target.startsWith('region:'))query={kind:'region',sourceId:source.id,initial:actual,regionId:target.slice(7),algorithm};
   else{
    if(!support)throw Error('Choose a supported target');let goal:Goal={supportId:support.id,x:Math.round(x*256),toleranceSu:128,vx:0};
    if(target!=='manual'){
     const point=map.waypoints.find(p=>p.id===target);if(!point)throw Error('Missing target waypoint');const w=createWorld(map as unknown as ContactMap,profile),state=anchorState(w,point.anchor);if(state.mode!=='ground'||!state.supportId)throw Error('Target waypoint requires a supported stance');goal={...goal,supportId:state.supportId,x:state.x};
    }
    query={kind:'route',sourceId:source.id,initial:actual,goal,algorithm};
   }
   submitted.current={map,profile};setNotice('');void runtime.session.solve(map,profile,++revision.current,query);
  }catch(e){setNotice(String(e));}
 };
 return <div>
  <fieldset disabled={lockReason(doc)!==null}><legend>Ground/climb reference navigation query</legend>
   <label>Movement profile<select aria-label="Navigation profile" value={profile?.id??''} onChange={e=>{reset();setActual(null);setProfile(e.target.value);}}>{profiles.map(p=><option key={p.id}>{p.id}</option>)}</select></label>
   <label>Source actor<select aria-label="Navigation source" value={source?.id??''} onChange={e=>{reset();setActual(null);setSource(e.target.value);const next=sources.find(s=>s.id===e.target.value);if(next&&'movementId' in next)setProfile(next.movementId);}}>{sources.map(s=><option key={s.id}>{s.id}</option>)}</select></label>
   <button type="button" disabled={!canUseTest} onClick={()=>{reset();if(run!.getSnapshot().mapId!==doc.id)return;run!.pause();setActual(structuredClone(run!.getSnapshot().state) as ClimbState);}}>Use current Test state</button>
   <p>{actual?`Actual Test source at tick ${actual.tick}, velocity (${actual.vx},${actual.vy})`:'Source is the named actor anchor with zero velocity and explicit initial resources.'}</p>
   <label>Target<select aria-label="Navigation target" value={target} onChange={e=>{reset();setTarget(e.target.value);}}><option value="manual">Supported foot position</option>{map.waypoints.map(p=><option key={p.id}>{p.id}</option>)}{map.regions.map(r=><option key={r.id} value={'region:'+r.id}>Region {r.name||r.id}</option>)}</select></label>
   {target==='manual'&&<><label>Target support<select aria-label="Navigation target support" value={support?.id??''} onChange={e=>{reset();setSupport(e.target.value);const f=map.footholds.find(f=>f.id===e.target.value);if(f)setX((f.a[0]+f.b[0])/2);}}>{map.footholds.filter(f=>f.enabled).map(f=><option key={f.id}>{f.id}</option>)}</select></label>
   <label>Target foot X (WU)<input aria-label="Navigation target X" type="number" step={1/256} value={x} onChange={e=>{reset();setX(Number(e.target.value));}}/></label></>}
   <p>Goal: grounded full-footprint support, zero terminal velocity, foot X within 0.5 WU. Region queries use a bounded supported sample and require the terminal foot point inside the region.</p>
   <label>Search<select aria-label="Navigation algorithm" value={algorithm} onChange={e=>{reset();setAlgorithm(e.target.value as typeof algorithm);}}><option value="astar">A*</option><option value="dijkstra">Dijkstra</option></select></label>
   <button type="button" disabled={!profile||!source||current&&view.phase==='building'} onClick={()=>solve()}>Find reference route</button>
   <button type="button" disabled={!profile||!source||!('ai' in source)||current&&view.phase==='building'} onClick={()=>solve(true)}>Verify enemy patrol</button>
   <button type="button" onClick={reset}>Cancel navigation</button>
  </fieldset>
  {notice&&<p role="status">{notice}</p>}
  {current&&view.phase==='building'&&<p role="status">Building bounded reference route…</p>}
  {current&&view.error&&<p role="status">Unsupported navigation query: {view.error}</p>}
  {current&&view.proof&&<Proof proof={view.proof} doc={doc}/>}
 </div>;
}
function Active({store,doc}:{readonly store:LibraryStore;readonly doc:OpenDoc}):ReactNode{
 const [runtime,setRuntime]=useState<ReturnType<typeof createRoutingWorker>|null>(null);
 useEffect(()=>{const r=createRoutingWorker();setRuntime(r);return()=>r.dispose();},[]);
 return runtime?<Controls runtime={runtime} store={store} doc={doc}/>:<p>Opening reference navigation…</p>;
}
export function NavigationPanel({store,doc}:{readonly store:LibraryStore;readonly doc:OpenDoc}):ReactNode{
 const selection=store.selection(doc.id),state=useSyncExternalStore(selection.subscribe,selection.getSnapshot,selection.getSnapshot),active=state.mode==='Navigation';
 return <section className="selection-panel" aria-label="Navigation"><h3>Navigation</h3>
  {Array.from(doc.state.model.collections.get('bodies')?.byId.values()??[]).some(b=>b.enabled&&b.mobility==='kinematic')&&<p aria-label="Moving platform navigation status">Unsupported timed platform links: source motion is visible, but static navigation cannot certify boarding, riding or rendezvous.</p>}
  <button type="button" onClick={()=>selection.mode(active?'All':'Navigation')}>{active?'Exit Navigation':'Navigation mode'}</button>
  {active&&<><Active key={doc.id} store={store} doc={doc}/><FlightPanel key={'flight:'+doc.id} store={store} doc={doc}/><BlockerPanel key={'blocker:'+doc.id} store={store} doc={doc}/></>}
 </section>;
}
