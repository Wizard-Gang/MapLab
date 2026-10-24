import type {CameraView} from '../camera/preview';import type {State} from '../physics-reference';import type {Scene} from '../render/scene';
export function CameraFootprint({view}:{view:CameraView}){
 return <g aria-label="Read-only camera footprint"><rect x={view.view[0]} y={view.view[1]} width={view.view[2]} height={view.view[3]} fill="none" stroke="#ffd98b" strokeWidth={2}/><rect x={view.deadZoneWorld[0]} y={view.deadZoneWorld[1]} width={view.deadZoneWorld[2]} height={view.deadZoneWorld[3]} fill="none" stroke="#86d7ff" strokeDasharray="6 4"/><circle cx={view.center[0]} cy={view.center[1]} r={3} fill="#ffd98b"/></g>;
}
export function CameraViewport({view,scene,state,body}:{view:CameraView;scene:Scene;state:State;body:{width:number;height:number}}){
 const clip='camera-preview-'+view.mapId;
 return <section aria-label="Reference camera preview"><h4>Reference camera and environment intent</h4><p>Read-only presentation. Separate preview identity; no engine parity, audio playback or effect-handler execution.</p>
 <svg aria-label="Reference camera viewport" viewBox={view.view.join(' ')} style={{width:'100%',maxHeight:360,background:'#171c25'}}>
 <defs><clipPath id={clip}><rect x={view.effective.bounds[0]} y={view.effective.bounds[1]} width={view.effective.bounds[2]} height={view.effective.bounds[3]}/></clipPath></defs>
 <g clipPath={'url(#'+clip+')'}><rect x={view.effective.bounds[0]} y={view.effective.bounds[1]} width={view.effective.bounds[2]} height={view.effective.bounds[3]} fill={view.environment.ambientColor}/>
 {scene.art.filter(a=>a.visible).flatMap(a=>a.commands.map((p,i)=><polygon key={a.layer.id+'-'+i} points={p.points.map(v=>v.join(',')).join(' ')} fill={p.fill?p.color:'none'} stroke={p.color} opacity={a.opacity}/>))}
 {(scene.passes.get('Collision')??[]).map((p,i)=><polyline key={i} points={p.points.map(v=>v.join(',')).join(' ')} fill="none" stroke={p.color} strokeWidth={2}/>)}
 <rect x={state.x/256-body.width/2} y={state.y/256-body.height} width={body.width} height={body.height} fill="#86d7ff" stroke="white"/></g>
 <rect x={view.deadZoneWorld[0]} y={view.deadZoneWorld[1]} width={view.deadZoneWorld[2]} height={view.deadZoneWorld[3]} fill="none" stroke="#ffd98b" strokeDasharray="6 4"/>
 </svg>
 <output aria-label="Test camera HUD" data-zone={view.zoneId??'default'} data-tick={view.tick}>{view.identity.key}@{view.identity.version} · Center ({view.center.join(', ')}) · Zone {view.zoneId??'default'} · Letterbox WU ({view.letterboxWU.join(', ')}){view.transition?' · Blend '+view.transition.elapsedTicks+'/'+view.transition.totalTicks:''}</output>
 {view.warnings.map(w=><p className="note" key={w}>{w}</p>)}
 <pre aria-label="Test camera state">{JSON.stringify(view,null,2)}</pre><pre aria-label="Test audio intent">{JSON.stringify(view.environment.audio,null,2)}</pre><pre aria-label="Test visual intent">{JSON.stringify({ambientColor:view.environment.ambientColor,effects:view.environment.effects,zoneId:view.environment.visualZoneId,effect:view.environment.visualEffect,shakeEffects:view.environment.shakeEffects,configuredZones:view.environment.configuredZones},null,2)}</pre></section>;
}
