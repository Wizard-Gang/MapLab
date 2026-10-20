import { useState, type ReactNode } from 'react';
import type { MapModel } from '../domain/model';
import type { SelectionSession } from '../editor/selection';
import type { ClimbPath } from '../physics-reference/climb';
import { authorClimb } from '../editor/climb';
import { records } from '../render/scene';
const empty:ClimbPath={id:'traversal.climb',kind:'ladder',points:[[100,100],[100,300]],grabRadius:12,direction:'both',requiredAbilities:['climb.ladder'],visualId:null,planeId:null,access:[{id:'access.climb.top',pathU:0,anchor:{kind:'world',point:[100,100]},entry:'none',exit:'airborne',conditions:[]},{id:'access.climb.bottom',pathU:1,anchor:{kind:'world',point:[100,300]},entry:'airborne',exit:'airborne',conditions:[]}]};
export function ClimbPanel({model,session,locked}:{readonly model:MapModel;readonly session:SelectionSession;readonly locked:boolean}):ReactNode {
 const [draft,setDraft]=useState<ClimbPath>(empty),[access,setAccess]=useState(JSON.stringify(empty.access,null,2));
 const load=(p:ClimbPath):void=>{setDraft(p);setAccess(JSON.stringify(p.access,null,2));};
 const paths=records<ClimbPath>(model,'traversals').filter(p=>'access' in p);
 return <details className="selection-panel"><summary>Ladders and ropes</summary>
  <p className="note">Vertical kinematic climb paths. Access anchors must lie on the path. Grounded access needs profile support and body clearance; airborne rope ends need no floor. Physical swinging is unavailable.</p>
  <fieldset disabled={locked}><legend>Climb path</legend>
   <label>Existing path<select aria-label="Existing climb path" value={paths.some(p=>p.id===draft.id)?draft.id:''} onChange={e=>load(paths.find(p=>p.id===e.target.value)??empty)}><option value="">New path</option>{paths.map(p=><option key={p.id}>{p.id}</option>)}</select></label>
   <button type="button" onClick={()=>load(empty)}>New climb path</button>
   <label>ID<input aria-label="Climb ID" value={draft.id} onChange={e=>setDraft({...draft,id:e.target.value})}/></label>
   <label>Kind<select aria-label="Climb kind" value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as ClimbPath['kind']})}><option>ladder</option><option>rope</option></select></label>
   {(['X','Top Y','Bottom Y'] as const).map((label,i)=><label key={label}>{label}<input aria-label={`Climb ${label}`} type="number" step={0.0625} value={i===0?draft.points[0]![0]:draft.points[i-1]![1]} onChange={e=>{const n=Number(e.target.value),x=i===0?n:draft.points[0]![0];setDraft({...draft,points:[[x,i===1?n:draft.points[0]![1]],[x,i===2?n:draft.points[1]![1]]]});}}/></label>)}
   <label>Grab radius<input aria-label="Climb grab radius" type="number" step={0.0625} value={draft.grabRadius} onChange={e=>setDraft({...draft,grabRadius:Number(e.target.value)})}/></label>
   <label>Direction<select aria-label="Climb direction" value={draft.direction} onChange={e=>setDraft({...draft,direction:e.target.value as ClimbPath['direction']})}>{['both','up','down'].map(v=><option key={v}>{v}</option>)}</select></label>
   <label>Required ability tags<input aria-label="Climb ability tags" value={draft.requiredAbilities.join(',')} onChange={e=>setDraft({...draft,requiredAbilities:e.target.value.split(',').map(v=>v.trim()).filter(Boolean)})}/></label>
   <label>Actor plane<select aria-label="Climb actor plane" value={draft.planeId??''} onChange={e=>setDraft({...draft,planeId:e.target.value||null})}><option value="">Default</option>{records<{id:string;kind:string}>(model,'layers').filter(l=>l.kind==='actors').map(l=><option key={l.id}>{l.id}</option>)}</select></label>
   <label>Access points (JSON)<textarea aria-label="Climb access points" rows={10} value={access} onChange={e=>setAccess(e.target.value)}/></label>
   <p className="note">Each access has id, pathU (0–1 in 1/65536 steps), anchor, entry/exit (grounded, airborne, either, none), and conditions. Add explicit midpoint exits here. Unknown runtime conditions report unsupported.</p>
   <button type="button" onClick={()=>session.run(()=>authorClimb(model,{...draft,access:JSON.parse(access) as ClimbPath['access']}))}>Apply climb path</button>
  </fieldset>
 </details>;
}
