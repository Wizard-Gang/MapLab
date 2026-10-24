import {useEffect,useMemo,useState,type ReactNode} from 'react';
import type {LibraryStore,OpenDoc} from './store';import {lockReason} from './store';
import {denormalize,isObject} from '../domain/model';
import type {MapDocument,CatalogDocument,JsonValue} from '../contracts';
import {defs,type FormSchema} from '../gameplay/inspector';import {Node,type Context} from './GameplayPanel';
import {presentationEdit,type PresentationField} from '../camera/authoring';
export function CameraPanel({store,doc}:{store:LibraryStore;doc:OpenDoc}):ReactNode{
 const map=useMemo(()=>denormalize(doc.state.model) as unknown as MapDocument,[doc.state.model]);
 const [camera,setCamera]=useState(map.camera),[environment,setEnvironment]=useState(map.environment),[cameraId,setCameraId]=useState(''),[environmentId,setEnvironmentId]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{setCamera(map.camera);setEnvironment(map.environment);},[map]);
 const all=store.gameplaySources(),allowed=new Set([map.id]),pending=[map.id];while(pending.length){const id=pending.pop();const d=all.find(s=>isObject(s)&&s.id===id);if(isObject(d)&&Array.isArray(d.dependencies))for(const dep of d.dependencies)if(isObject(dep)&&typeof dep.id==='string'&&!allowed.has(dep.id)){allowed.add(dep.id);pending.push(dep.id);}}
 const sources=all.filter(s=>isObject(s)&&allowed.has(String(s.id))),context:Context={map,maps:sources.filter(s=>isObject(s)&&s.format==='maplab.map') as unknown as MapDocument[],entries:sources.filter(s=>isObject(s)&&s.format==='maplab.catalog').flatMap(s=>(s as unknown as CatalogDocument).entries),profiles:store.testProfiles().map(p=>p.id),entityKind:'',lockIds:true};
 const newId=(field:PresentationField)=>store.reservePresentationId(doc.id,field,[...camera.zones.map(z=>z.id),...environment.zones.map(z=>z.id)]);
 const apply=(field:PresentationField)=>{try{if(store.edit(doc.id,presentationEdit(doc.state.model,field,(field==='camera'?camera:environment) as unknown as JsonValue)))setNotice(field+' intent applied');else setNotice(store.selection(doc.id).getSnapshot().message);}catch(e){setNotice(String(e));}};
 const zoneSchema=typeof defs.camera!.properties!.zones!.items==='object'?defs.camera!.properties!.zones!.items as FormSchema:{};
 const cz=camera.zones.find(z=>z.id===cameraId),ez=environment.zones.find(z=>z.id===environmentId);
 const ties=camera.zones.some((z,i)=>camera.zones.some((v,j)=>i!==j&&v.priority===z.priority));
 return <section aria-label="Camera and environment editor"><h3>Camera and environment</h3><p>Source intent. Test shows a read-only reference preview; engine camera, audio playback and effects remain consumer-owned.</p>
 <fieldset disabled={lockReason(doc)!==null}><legend>Camera</legend><span aria-label="Camera contract">{camera.model.key}@{camera.model.version}</span>
 <Node schema={defs['camera-settings']!} value={camera.defaults as unknown as JsonValue} path="camera.defaults" context={context} onChange={v=>setCamera({...camera,defaults:v as unknown as MapDocument['camera']['defaults']})}/>
 <Node schema={defs.camera!.properties!.shakeEffects!} value={camera.shakeEffects as unknown as JsonValue} path="camera.shakeEffects" context={context} onChange={v=>setCamera({...camera,shakeEffects:v as unknown as MapDocument['camera']['shakeEffects']})}/>
 <label>Camera zone<select aria-label="Camera zone" value={cameraId} onChange={e=>setCameraId(e.target.value)}><option value="">Choose camera zone</option>{camera.zones.map(z=><option key={z.id}>{z.id}</option>)}</select></label>
 <button onClick={()=>{const id=newId('camera');setCamera({...camera,zones:[...camera.zones,{id,regionId:map.regions[0]?.id??'',priority:0,settings:structuredClone(camera.defaults)}]});setCameraId(id);}}>New camera zone</button>
 {cz&&<><Node schema={zoneSchema} value={cz as unknown as JsonValue} path="camera.zone" context={context} onChange={v=>setCamera({...camera,zones:camera.zones.map(z=>z.id===cameraId?v as unknown as typeof cz:z)})}/><button onClick={()=>{setCamera({...camera,zones:camera.zones.filter(z=>z.id!==cameraId)});setCameraId('');}}>Delete camera zone</button></>}
 {ties&&<p role="alert">Equal-priority camera zones exist. Overlap is resolved by ascending stable zone ID.</p>}<button onClick={()=>apply('camera')}>Apply camera changes</button></fieldset>
 <fieldset disabled={lockReason(doc)!==null}><legend>Environment</legend>
 <Node schema={{...defs.environment!,properties:Object.fromEntries(Object.entries(defs.environment!.properties!).filter(([k])=>k!=='zones'))}} value={environment as unknown as JsonValue} path="environment" context={context} onChange={v=>setEnvironment(v as unknown as MapDocument['environment'])}/>
 <label>Environment zone<select aria-label="Environment zone" value={environmentId} onChange={e=>setEnvironmentId(e.target.value)}><option value="">Choose environment zone</option>{environment.zones.map(z=><option key={z.id}>{z.id}</option>)}</select></label>
 <button onClick={()=>{const id=newId('environment');setEnvironment({...environment,zones:[...environment.zones,{id,kind:'transition',regionId:map.regions[0]?.id??'',priority:0,effect:structuredClone(map.environment.effects[0]??{key:'',version:1,params:{}})}]});setEnvironmentId(id);}}>New environment zone</button>
 {ez&&<><Node schema={defs['environment-zone']!} value={ez as unknown as JsonValue} path="environment.zone" context={context} onChange={v=>setEnvironment({...environment,zones:environment.zones.map(z=>z.id===environmentId?v as unknown as typeof ez:z)})}/><button onClick={()=>{setEnvironment({...environment,zones:environment.zones.filter(z=>z.id!==environmentId)});setEnvironmentId('');}}>Delete environment zone</button></>}
 <button onClick={()=>apply('environment')}>Apply environment changes</button></fieldset>
 <button onClick={()=>{setCamera(map.camera);setEnvironment(map.environment);setNotice('Drafts discarded');}}>Discard camera/environment drafts</button><p aria-label="Camera authoring notice">{notice}</p></section>;
}
