import {useRef,useState,type ReactNode} from 'react';
import type {MapDocument} from '../contracts/document-types';
import type {State} from '../physics-reference';
import {RigPreview,useRigBundle} from './RigPreview';
/** Only immutable source and actor values cross this boundary; it cannot advance Test or edit physics. */
export function TestRig({source,state}:{readonly source:MapDocument;readonly state:State}):ReactNode {
 const [enabled,setEnabled]=useState(true),[id,setId]=useState('');const binding=source.presentations.find(p=>p.id===id)??source.presentations[0];
 const loaded=useRigBundle(source.dependencies.find(d=>d.id===binding?.bundleDependencyId)?.path);
 const semantic=state.mode==='climb'?'climb.ladder':state.mode==='air'?(state.vy<0?'locomotion.jump.rise':'locomotion.fall'):state.vx===0?'locomotion.idle':'locomotion.walk';
 const phase=useRef({key:'',tick:0,last:0}),key=`${source.id}/${binding?.id}/${semantic}`;
 if(phase.current.key!==key||state.tick<phase.current.last)phase.current={key,tick:state.tick,last:state.tick};else phase.current.last=state.tick;
 const foot=[state.x/256,state.y/256] as const,f=state.mode==='ground'?source.footholds.find(f=>f.id===state.supportId):undefined,body=f?.ownerBodyId?source.bodies.find(b=>b.id===f.ownerBodyId):undefined;
 const x=(f?.a[0]??0)+(body?.position[0]??0),y=(f?.a[1]??0)+(body?.position[1]??0),dx=f?f.b[0]-f.a[0]:0;
 const supportY=f&&dx!==0?y+(foot[0]-x)*(f.b[1]-f.a[1])/dx:undefined;
 if(!binding)return null;
 return <section aria-label="Test RigLab presentation"><label>Show RigLab artwork<input type="checkbox" aria-label="Show RigLab artwork" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/></label><label>Test RigLab binding<select aria-label="Test RigLab binding" value={binding.id} onChange={e=>setId(e.target.value)}>{source.presentations.map(p=><option key={p.id}>{p.id}</option>)}</select></label>
 {enabled&&<RigPreview bundle={loaded.bundle} binding={binding} assets={source.assets} input={{tick:state.tick,stateEnterTick:phase.current.tick,semantic,foot,facing:state.facing===1?'right':'left',...(supportY===undefined?{}:{supportY})}}/>}<p>{loaded.notice}</p></section>;
}
