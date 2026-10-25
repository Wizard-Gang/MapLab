import {useEffect,useState,type ReactNode} from 'react';
import {parseJson,type JsonValue} from '../contracts';
import type {Asset} from '../contracts/common-types';
import type {Entity,RigPresentationBinding} from '../contracts/gameplay-types';
import {insertOp,setOp,transaction} from '../domain/commands';
import {records} from '../render/scene';
import {bytesBase64} from '../render/assets';
import {importRigZip} from '../library/client';
import {validateBinding} from '../riglab/presentation';
import type {RigView} from '../riglab/model';
import {lockReason,type LibraryStore,type OpenDoc} from './store';
import {RigPreview,useRigBundle} from './RigPreview';
export function RigLabPanel({store,doc}:{readonly store:LibraryStore;readonly doc:OpenDoc}):ReactNode {
 const model=doc.state.model,bindings=records<RigPresentationBinding>(model,'presentations'),deps=records<{id:string;kind:string;path:string}>(model,'dependencies'),assets=records<Asset>(model,'assets'),entities=records<Entity>(model,'entities');
 const [selected,setSelected]=useState(''),[target,setTarget]=useState(''),[draft,setDraft]=useState(''),[imported,setImported]=useState<{path:string;bundle:RigView}|null>(null),[notice,setNotice]=useState(''),[tick,setTick]=useState(0),[facing,setFacing]=useState<'left'|'right'>('right'),[semantic,setSemantic]=useState('locomotion.idle');
 const chosen=bindings.find(b=>b.id===selected)??bindings[0];
 let preview:RigPresentationBinding|undefined;try{const p=parseJson(draft);if(p.ok)preview=p.value as unknown as RigPresentationBinding;}catch{}
 const loaded=useRigBundle(deps.find(d=>d.id===(preview?.bundleDependencyId??chosen?.bundleDependencyId))?.path),bundle=imported?.bundle??loaded.bundle;
 useEffect(()=>{if(chosen)setDraft(JSON.stringify(chosen,null,2));},[chosen]);
 const locked=!!lockReason(doc)||store.getSnapshot().busy||!!store.getSnapshot().library?.readOnly;
 const run=async(work:()=>Promise<void>|void):Promise<void>=>{try{await work();}catch(e){setNotice(String(e));}};
 return <details><summary>RigLab presentation</summary><p>Optional baked artwork. Import a RigLab export ZIP, then explicitly bind art slots, ground anchor and semantic actions. Actor collision and motion stay authoritative.</p>
 <fieldset disabled={locked}><label>RigLab export ZIP<input type="file" aria-label="RigLab export ZIP" accept=".zip" onChange={e=>{const file=e.target.files?.[0];if(!file)return;void run(async()=>{if(file.size>16*1024*1024)throw Error('RigLab ZIP exceeds 16 MiB');const r=await importRigZip(bytesBase64(new Uint8Array(await file.arrayBuffer())));if(!r.ok)throw Error(r.message);setImported(r);const b:RigPresentationBinding={id:'presentation.rig',kind:'riglab',bundleDependencyId:deps.find(d=>d.kind==='riglab'&&d.path===r.path)?.id??`rig.${r.bundle.digest.slice(0,12)}`,expectedExportVersion:1,rigGroundAnchor:[0,0],worldUnitsPerRigUnit:{num:1,den:1},nativeFacing:'right',rootMotion:'visualOnly',groundContact:'supportLine',artSlots:[],actions:[{semantic:'locomotion.idle',animation:r.bundle.clips[0]?.name??null,fallbackSemantic:null}]};setDraft(JSON.stringify(b,null,2));setNotice('Imported verified bytes; choose explicit art and action bindings');});}}/></label>
 <label>Saved RigLab binding<select aria-label="Saved RigLab binding" value={chosen?.id??''} onChange={e=>{setSelected(e.target.value);setImported(null);}}>{bindings.map(b=><option key={b.id} value={b.id}>{b.id}</option>)}</select></label>
 <p>Available art: {assets.map(a=>a.id).join(', ')||'Import approved image assets first'}. Slots: {bundle?.rig.bones.map(b=>b.slot).join(', ')||'No loaded rig'}.</p>
 <label>RigLab binding JSON<textarea aria-label="RigLab binding JSON" value={draft} onChange={e=>setDraft(e.target.value)}/></label>
 <label>Bind actor<select aria-label="RigLab target actor" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choose actor</option>{entities.map(e=><option key={e.id} value={e.id}>{e.id}</option>)}</select></label>
 <button type="button" disabled={!bundle||!target} onClick={()=>void run(()=>{const parsed=parseJson(draft);if(!parsed.ok)throw Error(parsed.diagnostic.message);const b=parsed.value as unknown as RigPresentationBinding;validateBinding(bundle!,b,assets);const path=imported?.path??deps.find(d=>d.id===b.bundleDependencyId)?.path;if(!path)throw Error('Import or choose a saved bundle');
 const requested=deps.find(d=>d.id===b.bundleDependencyId);if(requested&&(requested.path!==path||requested.kind!=='riglab'))throw Error('Dependency ID names another bundle');
 const existing=deps.find(d=>d.path===path&&d.kind==='riglab'),normalized={...b,bundleDependencyId:existing?.id??b.bundleDependencyId},bindingValue=normalized as unknown as Record<string,JsonValue>,ops=[];
 if(!existing)ops.push(insertOp(model,'dependencies',[{id:b.bundleDependencyId,kind:'riglab',path,required:false}]));
 if(bindings.some(x=>x.id===b.id)){for(const [key,value]of Object.entries(bindingValue))if(key!=='id')ops.push(setOp(model,'presentations',b.id,key,value));}else ops.push(insertOp(model,'presentations',[bindingValue]));
 ops.push(setOp(model,'entities',target,'presentationId',b.id));if(!store.edit(doc.id,transaction('Bind RigLab presentation',ops)))throw Error(store.selection(doc.id).getSnapshot().message);setSelected(b.id);setDraft(JSON.stringify(normalized,null,2));setNotice(`Bound presentation as one undoable edit${existing?`; reused bundle dependency ${existing.id}`:''}; save the map to persist`);})}>Apply RigLab binding</button></fieldset>
 <label>RigLab preview tick<input aria-label="RigLab preview tick" type="range" min={0} max={3600} value={tick} onChange={e=>setTick(Number(e.target.value))}/></label><label>RigLab facing<select aria-label="RigLab facing" value={facing} onChange={e=>setFacing(e.target.value as 'left'|'right')}><option>right</option><option>left</option></select></label><label>RigLab action<input aria-label="RigLab action" value={semantic} onChange={e=>setSemantic(e.target.value)}/></label>
 {preview&&<RigPreview bundle={bundle} binding={preview} assets={assets} input={{tick,stateEnterTick:0,semantic,foot:[0,0],facing,supportY:0}}/>}<p aria-label="RigLab notice">{notice||loaded.notice}</p></details>;
}
