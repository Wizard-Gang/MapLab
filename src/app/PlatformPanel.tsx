import {useState,type ReactNode} from 'react';
import type {Motion,CollisionBody} from '../contracts';
import type {MapModel} from '../domain/model';
import type {SelectionSession} from '../editor/selection';
import {platformMotion} from '../editor/platforms';
import {records} from '../render/scene';
function MotionForm({body,model,session,locked}:{body:CollisionBody;model:MapModel;session:SelectionSession;locked:boolean}):ReactNode{
 const [draft,setDraft]=useState<Motion>(body.motion??{points:[[0,0],[0,-64]],legTicks:[64],mode:'pingPong',initialPhaseTicks:0,easing:'linear',carry:'delta',departure:'none',crushAction:null}),[enabled,setEnabled]=useState(body.enabled);
 const update=(change:Partial<Motion>)=>setDraft({...draft,...change});
 return <fieldset disabled={locked} aria-label="Translating platform motion"><legend>Motion for {body.id}</legend>
  <p>Rigid translation only. Points are WU offsets from the body origin; durations and initial phase use 60 Hz ticks. Carry uses each tick’s displacement. Timed navigation links are unsupported.</p>
  <label><input aria-label="Platform enabled" type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Enabled</label>
  <label>Motion mode<select aria-label="Platform motion mode" value={draft.mode} onChange={e=>update({mode:e.target.value as Motion['mode']})}><option value="once">Once</option><option value="loop">Loop (repeat first point)</option><option value="pingPong">Ping-pong</option></select></label>
  <label>Initial phase (ticks)<input aria-label="Platform initial phase" type="number" min={0} step={1} value={draft.initialPhaseTicks} onChange={e=>update({initialPhaseTicks:Number(e.target.value)})}/></label>
  <label>Departure<select aria-label="Platform departure" value={draft.departure} onChange={e=>update({departure:e.target.value as Motion['departure']})}><option value="none">Keep actor velocity</option><option value="addPlatformVelocity">Add last platform velocity once on departure</option></select></label>
  <ol>{draft.points.map((point,i)=><li key={i}>{([0,1] as const).map(axis=><label key={axis}>{axis===0?'X':'Y'}<input aria-label={`Platform point ${i+1} ${axis===0?'X':'Y'}`} type="number" step={0.0625} value={point[axis]} onChange={e=>update({points:draft.points.map((p,j)=>j===i?(axis===0?[Number(e.target.value),p[1]]:[p[0],Number(e.target.value)]):p)})}/></label>)}
   {i<draft.legTicks.length&&<label>Duration to next point<input aria-label={`Platform leg ${i+1} ticks`} type="number" min={1} step={1} value={draft.legTicks[i]} onChange={e=>update({legTicks:draft.legTicks.map((t,j)=>j===i?Number(e.target.value):t)})}/></label>}
  </li>)}</ol>
  <button type="button" disabled={draft.points.length>=64} onClick={()=>update({points:[...draft.points,draft.points[0]!],legTicks:[...draft.legTicks,64]})}>Add platform point</button>
  <button type="button" disabled={draft.points.length<=2} onClick={()=>update({points:draft.points.slice(0,-1),legTicks:draft.legTicks.slice(0,-1)})}>Remove last platform point</button>
  <p>Crush stops this reference run and reports the declared engine action: {draft.crushAction?.key??'none'}. This preview does not execute engine actions.</p>
  <button type="button" onClick={()=>session.run(()=>platformMotion(model,body.id,draft,enabled))}>Apply platform motion</button>
  <button type="button" disabled={body.mobility==='static'&&!body.motion} onClick={()=>session.run(()=>platformMotion(model,body.id,null,enabled))}>Make platform static</button>
 </fieldset>;
}
export function PlatformPanel({model,session,locked}:{model:MapModel;session:SelectionSession;locked:boolean}):ReactNode{
 const bodies=records<CollisionBody>(model,'bodies'),[id,setId]=useState(''),body=bodies.find(b=>b.id===id)??bodies[0];
 return <section aria-label="Moving platform authoring"><h4>Translating platforms</h4><label>Body<select aria-label="Platform body" value={body?.id??''} onChange={e=>setId(e.target.value)}>{bodies.map(b=><option key={b.id}>{b.id}</option>)}</select></label>
  {body?<MotionForm key={body.id+JSON.stringify([body.motion,body.enabled])} body={body} model={model} session={session} locked={locked}/>:<p>Add a collision body before authoring platform motion.</p>}
 </section>;
}
