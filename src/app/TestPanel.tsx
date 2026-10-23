import {CameraFootprint,CameraViewport} from './CameraOverlay';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { NEUTRAL, MAX_TICKS } from '../test-runtime/session';
import type { PortalTestSession } from '../test-runtime/portals';
import type { Input } from '../physics-reference';
import type { Entity } from '../contracts/gameplay-types';
import { records } from '../render/scene';
import { buildScene } from '../render/scene';
import { normalize } from '../domain/model';
import type { JsonValue } from '../contracts';
import type { LibraryStore, OpenDoc } from './store';

function RunningTest({ run, stop }: { readonly run: PortalTestSession; readonly stop: () => void }): ReactNode {
  const view = useSyncExternalStore(run.subscribe, run.getSnapshot, run.getSnapshot);
  const controls = useRef<Input>(NEUTRAL), keys = useRef(new Set<string>());
  const [text, setText] = useState(''), [notice, setNotice] = useState(''),[encounter,setEncounter]=useState(''),[portal,setPortal]=useState(''),[showCamera,setShowCamera]=useState(true);
  const scene = useMemo(() => { const normalized = normalize(run.runtimeSource() as unknown as JsonValue); if (!normalized.ok) throw new Error('Invalid Test snapshot'); return buildScene(normalized.model); }, [run,view.mapId,JSON.stringify(view.gameplay?.bodies??{})]);
  const clear = (): void => { keys.current.clear(); controls.current = NEUTRAL; };
  useEffect(() => {
    // Wall time only schedules whole controller ticks. It never enters controller arithmetic.
    if (view.paused) return;
    const timer = setInterval(() => { if (!run.getSnapshot().paused) run.advance(controls.current); }, 1000 / 60);
    const blur = (): void => { clear(); run.pause(); };
    window.addEventListener('blur', blur);
    const visibility = (): void => { if (document.hidden) blur(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(timer); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); };
  }, [run, view.paused]);
  useEffect(() => () => { clear(); run.pause(); }, [run]);
  useEffect(()=>{clear();setEncounter('');setPortal('');},[view.mapId]);
  const state = view.state, body = run.profile.collider;
  const update = (code: string, down: boolean): void => {
    if (down) keys.current.add(code); else keys.current.delete(code);
    const k = keys.current;
    controls.current = { moveX: (Number(k.has('ArrowRight')) - Number(k.has('ArrowLeft'))) as -1|0|1,
      moveY: (Number(k.has('ArrowDown')) - Number(k.has('ArrowUp'))) as -1|0|1,
      run: k.has('ShiftLeft') || k.has('ShiftRight'), jump: k.has('Space'), drop: k.has('KeyD') };
  };
  return <div>
    <output aria-label="Test current map">{view.mapId}</output>
    <p>Generic debug actor · {run.profile.id} · {view.paused ? 'Paused' : 'Running'} · 60 Hz · {MAX_TICKS} tick recording limit</p>
    <div role="toolbar" aria-label="Test controls">
      <button onClick={() => run.pause(false)}>Run Test</button>
      <button onClick={() => run.pause()}>Pause Test</button>
      <button disabled={!view.paused || view.frame.status !== 'ok'} onClick={() => run.advance(controls.current)}>Step Test</button>
      <button onClick={() => { clear(); run.reset(); setNotice('Reset to snapshot spawn'); }}>Reset Test</button>
      <button onClick={() => { clear(); stop(); }}>Stop Test</button>
      <button disabled={!view.frames.length} onClick={() => { setText(JSON.stringify(run.recording(), null, 2)); setNotice('Recording copied to replay input'); }}>Use recorded input</button>
    </div>
    <p>Focus the Test stage: arrows move/climb, Shift runs, Space jumps, D drops, N steps while paused. Blur pauses and clears keys.</p>
    <label>Show camera preview<input aria-label="Show camera preview" type="checkbox" checked={showCamera} onChange={e=>setShowCamera(e.target.checked)}/></label>
    <svg aria-label="Test stage" role="application" tabIndex={0} viewBox={run.source.bounds.join(' ')} style={{ width:'100%', maxHeight:480, background:'#16251f' }}
      onBlur={() => { clear(); run.pause(); }}
      onKeyDown={e => { if (e.code === 'KeyN') { e.preventDefault(); e.stopPropagation(); if (view.paused && !e.repeat) run.advance(controls.current); return; } if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','ShiftLeft','ShiftRight','KeyD'].includes(e.code)) { e.preventDefault(); e.stopPropagation(); update(e.code, true); } }}
      onKeyUp={e => { e.preventDefault(); e.stopPropagation(); update(e.code, false); }}>
      {scene.art.filter(a => a.visible).flatMap(a => a.commands.map((p,i) => <polygon key={`${a.layer.id}-${i}`} points={p.points.map(v=>v.join(',')).join(' ')} fill={p.fill?p.color:'none'} stroke={p.color} opacity={a.opacity} />))}
      {['Footholds','Collision'].flatMap(layer => (scene.passes.get(layer as 'Footholds'|'Collision')??[]).map((p,i)=><polyline key={`${layer}-${i}`} points={p.points.map(v=>v.join(',')).join(' ')} fill="none" stroke={p.color} strokeWidth={2}><title>{p.label}</title></polyline>))}
      {run.source.traversals.filter(t=>'points' in t).map(t=><polyline key={t.id} points={'points' in t?t.points.map(p=>p.join(',')).join(' '):''} fill="none" stroke="#ffd98b" strokeWidth={3}><title>{t.id}</title></polyline>)}
      {body.kind === 'rect' && <rect aria-label="Generic debug actor" x={state.x/256-body.width/2} y={state.y/256-body.height} width={body.width} height={body.height} fill="#86d7ff" stroke="white" />}
      <circle cx={state.x/256} cy={state.y/256} r={3} fill="#ff5b79" />
      {showCamera&&view.camera&&<CameraFootprint view={view.camera}/>}
      {view.frame.contacts.map((c,i)=><circle key={i} cx={c.point[0]/256} cy={c.point[1]/256} r={3} fill="#fff"><title>{`${c.bodyId}/${c.shapeId}/${c.edgeIndex} ${c.kind}`}</title></circle>)}
    </svg>
    {showCamera&&view.camera&&body.kind==='rect'&&<CameraViewport view={view.camera} scene={scene} state={state} body={body}/>}
    {view.cameraDiagnosis&&<p aria-label="Camera preview diagnosis">{view.cameraDiagnosis} · Physics remains independent.</p>}
    <output aria-label="Test movement HUD" data-tick={state.tick} data-state={state.mode} data-support={state.supportId??''}>
      Tick {state.tick} · Foot ({state.x/256}, {state.y/256}) WU · Velocity ({state.vx}, {state.vy}) su/tick · State {state.mode} · Foothold {state.supportId??'none'} · Traversal {state.traversalId??'none'} · Plane {state.planeId??'none'} · Facing {state.facing}
    </output>
    <pre aria-label="Test contacts">{JSON.stringify(view.frame.contacts, null, 2)}</pre>
    {view.gameplay&&<section aria-label="Test gameplay boundary"><h4>Declarative Test events</h4><p>Explicit fixture injection only. No combat victory, AI or wave executor is simulated.</p>
    <label>Test encounter<select aria-label="Test encounter" value={encounter} onChange={e=>setEncounter(e.target.value)}><option value="">Choose active encounter</option>{Object.entries(view.gameplay.encounters).map(([id,status])=><option key={id} value={id}>{id} · {status}</option>)}</select></label>
    <button disabled={!encounter||view.gameplay.encounters[encounter]!=='active'} onClick={()=>{const e=(run.source as unknown as {encounters:{id:string;completionEvent:{key:string;version:number}}[]}).encounters.find(e=>e.id===encounter);if(e)try{clear();run.injectEvent(e.completionEvent,e.id);setNotice('Explicit fixture event injected: '+e.completionEvent.key);}catch(e){setNotice(String(e));}}}>Inject declared completion event</button>
    <pre aria-label="Test gameplay state">{JSON.stringify(view.gameplay,null,2)}</pre></section>}
    <section aria-label="Test portal travel"><h4>Portal travel</h4><p>Captured dependency maps only. Actor velocity, contacts and resources reset on arrival. Every entry creates fresh map flags, encounters and one-shot state. Arrival touch portals stay locked until the full body exits.</p>
    <label>Test portal<select aria-label="Test portal" value={portal} onChange={e=>setPortal(e.target.value)}><option value="">Choose portal</option>{view.portals.map(p=><option key={p.id} value={p.id}>{p.id} · {p.activation} · {p.condition} · {p.inside?'inside':'outside'}{p.suppressed?' · reentry locked':''}</option>)}</select></label>
    <button disabled={!!view.pending||view.travelStatus!=='ready'||!view.portals.some(p=>p.id===portal&&p.activation==='interact'&&p.inside&&p.condition==='passed')} onClick={()=>{try{clear();run.interact(portal);setNotice('Portal interaction recorded');}catch(e){setNotice(String(e));}}}>Interact with portal</button>
    <output aria-label="Test portal status">{view.travelStatus}: {view.travelDiagnosis||'ready'}{view.pending?' · '+view.pending.portalId+' · '+view.pending.remainingTicks+' ticks remaining':''}</output><pre aria-label="Test portal trace">{JSON.stringify(view.travels,null,2)}</pre></section>
    <p aria-label="Test diagnosis">{view.frame.status}: {view.frame.reason??'shared reference controller'} · Preview only; cannot certify navigation. Use Navigation mode to generate a separate reference route from this Test state.</p>
    <label>Test replay input<textarea aria-label="Test replay input" value={text} onChange={e=>setText(e.target.value)} rows={5}/></label>
    <button onClick={() => { clear(); try { run.replay(JSON.parse(text)); setNotice('Replay complete; paused'); } catch(e) { setNotice(`Replay refused: ${e instanceof Error?e.message:String(e)}`); } }}>Replay Test</button>
    <p aria-label="Test notice">{notice}</p>
  </div>;
}

export function TestPanel({ store, doc }: { readonly store: LibraryStore; readonly doc: OpenDoc }): ReactNode {
  const profiles = store.testProfiles();
  const start = records<Entity>(doc.state.model, 'entities').find(e=>e.enabled && e.kind==='playerStart' && e.default);
  const [profileId, setProfileId] = useState(start?.kind==='playerStart'?start.movementId:profiles[0]?.id??''), [notice,setNotice] = useState('');
  const run = store.test(doc.id);
  return <section aria-label="Integrated Test">
    <h3>Test</h3>
    <p>Test freezes the loaded dependency closure and movement profile. Edits stop Test; start again to take an explicit new snapshot. Engine gameplay is configured, not simulated; the labeled declarative event subset has a separate runtime snapshot.</p>
    <label>Test movement profile<select aria-label="Test movement profile" value={profileId} onChange={e=>{ store.stopTest(doc.id); setProfileId(e.target.value); setNotice('Profile changed; start a new snapshot'); }}>
      {profiles.map(p=><option key={p.id} value={p.id}>{p.id}</option>)}
    </select></label>
    {!run && <button onClick={()=>{ try { store.startTest(doc.id,profileId); setNotice(''); } catch(e) { setNotice(`Test refused: ${e instanceof Error?e.message:String(e)}`); } }}>Start Test snapshot</button>}
    <p aria-label="Test startup notice">{notice}</p>
    {run && <RunningTest key={profileId} run={run} stop={()=>store.stopTest(doc.id)}/>}
  </section>;
}
