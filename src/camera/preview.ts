// Read-only reference presentation intent. No controller, DOM, storage, audio playback or engine handlers.
import {validateDocumentSchema,type JsonValue,type MapDocument} from '../contracts';
import type {CameraSettings,EnvironmentZone} from '../contracts/gameplay-types';
import type {State} from '../physics-reference';
import {sensorSpans} from '../gameplay/sensors';
type Vec=readonly [number,number];type Rect=readonly [number,number,number,number];
const own=<T>(value:T):T=>{const v=structuredClone(value);const freeze=(x:unknown):void=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}};freeze(v);return v;};
const q=(n:number)=>Math.sign(n)*Math.floor(Math.abs(n)*256+0.5)/256;
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const curve=(t:number,kind:'linear'|'smoothstep')=>kind==='linear'?t:t*t*(3-2*t);
const viewSize=(s:CameraSettings):Vec=>[s.viewWU[0]/s.zoom,s.viewWU[1]/s.zoom];
function bounded(center:number,size:number,start:number,length:number):number{return length<size?start+length/2:clamp(center,start+size/2,start+length-size/2);}
function dead(center:number,point:number,size:number,start:number,length:number):number{
 const lo=center+(start-0.5)*size,hi=lo+length*size;return point<lo?point-(start-0.5)*size:point>hi?point-(start+length-0.5)*size:center;
}
function blended(a:CameraSettings,b:CameraSettings,t:number):CameraSettings{
 const v=(x:readonly number[],y:readonly number[])=>x.map((n,i)=>mix(n,y[i]!,t));
 return {...b,viewWU:v(a.viewWU,b.viewWU) as unknown as Vec,zoom:mix(a.zoom,b.zoom,t),bounds:v(a.bounds,b.bounds) as unknown as Rect,deadZone:v(a.deadZone,b.deadZone) as unknown as Rect,dampingTicks:v(a.dampingTicks,b.dampingTicks) as unknown as Vec,lookaheadWU:v(a.lookaheadWU,b.lookaheadWU) as unknown as Vec};
}
export interface CameraView {
 readonly identity:Readonly<{key:'maplab.reference-camera-preview';version:1;canCertifyEngine:false}>;
 readonly mapId:string;readonly tick:number;readonly zoneId:string|null;readonly activeZoneIds:readonly string[];
 readonly center:Vec;readonly view:Rect;readonly effective:CameraSettings;readonly deadZoneWorld:Rect;readonly letterboxWU:Vec;
 readonly transition:Readonly<{fromZoneId:string|null;elapsedTicks:number;totalTicks:number;progress:number}>|null;
 readonly warnings:readonly string[];
 readonly environment:Readonly<{
  ambientColor:string;effects:MapDocument['environment']['effects'];shakeEffects:MapDocument['camera']['shakeEffects'];
  audio:Readonly<{zoneId:string|null;trackAssetId:string|null;loop:boolean;fadeTicks:number;fromZoneId:string|null;elapsedTicks:number;progress:number}>;
  visualZoneId:string|null;visualEffect:Extract<EnvironmentZone,{kind:'transition'}>['effect']|null;
  configuredZones:readonly Readonly<{id:string;kind:EnvironmentZone['kind'];priority:number}>[];
 }>;
}
interface Blend {from:CameraSettings;center:Vec;zoneId:string|null;elapsed:number;total:number}
/** Tick rules, quantization, safety/dead-zone behavior and preview-only fade semantics are published
 * in conformance/camera/README.md. Source contracts remain maplab.camera@1; this preview has its own identity. */
export class CameraPreview {
 readonly source:MapDocument;private view:CameraView|null=null;private actor:State|null=null;private groundY:number|null=null;private blend:Blend|null=null;
 private samples=0;private audio:{id:string|null;from:string|null;elapsed:number;total:number}={id:null,from:null,elapsed:0,total:0};
 constructor(map:MapDocument,private readonly collider:Readonly<{width:number;height:number}>){
  const diagnostics=validateDocumentSchema(map as unknown as JsonValue);if(diagnostics.some(d=>d.severity==='error'))throw Error('Invalid preview source schema');
  if(map.camera.model.key!=='maplab.camera'||map.camera.model.version!==1)throw Error('Unsupported camera contract');
  if(![collider.width,collider.height].every(n=>Number.isFinite(n)&&n>0&&n<=262144))throw Error('Invalid preview collider');
  if(!Number.isSafeInteger(collider.width*256)||collider.width*256%2||!Number.isSafeInteger(collider.height*256))throw Error('Invalid preview collider precision');
  const zones=[...map.camera.zones,...map.environment.zones];if(map.camera.zones.length>256||map.environment.zones.length>256)throw Error('Camera/environment zone budget');
  let work=0;for(const zone of zones){const region=map.regions.find(r=>r.id===zone.regionId);if(!region)throw Error('Missing preview region');const shape=region.shape;if(shape.kind==='polygon'&&shape.points.length>256)throw Error('Camera geometry budget');work+=shape.kind==='polygon'?shape.points.length**3:16;}
  if(work>100000)throw Error('Camera sensor work budget');
  for(const s of [map.camera.defaults,...map.camera.zones.map(z=>z.settings)]){
   if(s.deadZone[0]+s.deadZone[2]>1||s.deadZone[1]+s.deadZone[3]>1)throw Error('Invalid normalized camera dead zone');
   if(s.bounds[0]+s.bounds[2]>131072||s.bounds[1]+s.bounds[3]>131072)throw Error('Camera bounds exceed range');
  }
  for(const z of map.environment.zones)if(z.kind==='audio'&&!map.assets.some(a=>a.id===z.trackAssetId&&a.mediaType.startsWith('audio/')))throw Error('Audio intent requires a declared audio asset');
  this.source=own(map);this.collider=own(collider);
 }
 getSnapshot=():CameraView|null=>this.view;
 reset(actor:State):CameraView {return this.sample(actor,true);}
 step(actor:State):CameraView {return this.sample(actor,false);}
 private active<T extends {regionId:string;priority?:number;id:string}>(zones:readonly T[],actor:State):T[]{
  return zones.filter(z=>{const region=this.source.regions.find(r=>r.id===z.regionId)!;return sensorSpans(region.shape,actor,actor,this.collider.width*256,this.collider.height*256).length>0;}).sort((a,b)=>(a.priority??0)>(b.priority??0)?-1:(a.priority??0)<(b.priority??0)?1:a.id<b.id?-1:a.id>b.id?1:0);
 }
 private sample(actor:State,reset:boolean):CameraView {
  if(![actor.x,actor.y,actor.vx,actor.vy,actor.tick].every(Number.isSafeInteger)||actor.tick<0||Math.abs(actor.x)>131072*256||Math.abs(actor.y)>131072*256||!['ground','air','climb'].includes(actor.mode))throw Error('Invalid preview actor state');
  if(!reset&&(!this.actor||actor.tick!==this.actor.tick+1))throw Error('Preview requires consecutive physics ticks or explicit reset');
  if(!reset&&this.samples>=3601)throw Error('Camera sample budget');
  const previous=reset?null:this.view,oldActor=reset?null:this.actor;
  const zones=this.active(this.source.camera.zones,actor),zone=zones[0],zoneId=zone?.id??null,target=zone?.settings??this.source.camera.defaults;
  let blend=reset?null:this.blend;
  if(previous&&zoneId!==previous.zoneId)blend=target.transitionTicks?{from:previous.effective,center:previous.center,zoneId:previous.zoneId,elapsed:0,total:target.transitionTicks}:null;
  if(blend)blend={...blend,elapsed:Math.min(blend.total,blend.elapsed+1)};
  const progress=blend?curve(blend.elapsed/blend.total,target.transition):1,effective=blend?blended(blend.from,target,progress):target;
  const [w,h]=viewSize(target),x=actor.x/256,y=actor.y/256,top=y-this.collider.height;
  const lookX=clamp(actor.vx/256*12,-Math.abs(target.lookaheadWU[0]),Math.abs(target.lookaheadWU[0]));
  const lookY=clamp(actor.vy/256*12,0,Math.abs(target.lookaheadWU[1]));
  const point:Vec=[x+lookX,y-this.collider.height/2+lookY];
  let groundY=reset?null:this.groundY;const higherLanding=actor.mode==='ground'&&groundY!==null&&y<groundY&&oldActor?.mode!=='ground';
  if(actor.mode==='ground')groundY=y;
  let desired:Vec=[point[0]-(target.deadZone[0]+target.deadZone[2]/2-0.5)*w,point[1]-(target.deadZone[1]+target.deadZone[3]/2-0.5)*h];
  if(previous){
   let cx=dead(previous.center[0],point[0],w,target.deadZone[0],target.deadZone[2]),cy=previous.center[1];
   if(target.verticalPolicy==='continuous'||actor.mode==='climb'&&target.climbFollow||groundY===null||actor.mode==='ground')cy=dead(cy,point[1],h,target.deadZone[1],target.deadZone[3]);
   else {
    const safety=cy-h/2+target.deadZone[1]*h;
    if(top<safety)cy=top-(target.deadZone[1]-0.5)*h;
    else if(y>groundY+h/4)cy=dead(cy,point[1],h,target.deadZone[1],target.deadZone[3]);
   }
   if(higherLanding&&target.verticalPolicy==='platformSnap')cy=y-this.collider.height/2-(target.deadZone[1]+target.deadZone[3]/2-0.5)*h;
   desired=[cx,cy];
  }
  const lockX=!target.followX,lockY=!target.followY||target.verticalPolicy==='locked';
  desired=[lockX?target.bounds[0]+target.bounds[2]/2:desired[0],lockY?target.bounds[1]+target.bounds[3]/2:desired[1]];
  let center:Vec;
  if(blend)center=[mix(blend.center[0],desired[0],progress),mix(blend.center[1],desired[1],progress)];
  else if(previous)center=[lockX?desired[0]:previous.center[0]+(desired[0]-previous.center[0])/Math.max(1,target.dampingTicks[0]),lockY||higherLanding?desired[1]:previous.center[1]+(desired[1]-previous.center[1])/Math.max(1,target.dampingTicks[1])];
  else center=desired;
  const size=viewSize(effective);center=[bounded(lockX?effective.bounds[0]+effective.bounds[2]/2:q(center[0]),size[0],effective.bounds[0],effective.bounds[2]),bounded(lockY?effective.bounds[1]+effective.bounds[3]/2:q(center[1]),size[1],effective.bounds[1],effective.bounds[3])];
  const rect:Rect=[center[0]-size[0]/2,center[1]-size[1]/2,size[0],size[1]];
  const environment=this.active(this.source.environment.zones,actor),audioZone=environment.find((z):z is Extract<EnvironmentZone,{kind:'audio'}>=>z.kind==='audio'),visual=environment.find((z):z is Extract<EnvironmentZone,{kind:'transition'}>=>z.kind==='transition');
  let audio=reset?{id:audioZone?.id??null,from:null,elapsed:0,total:0}:this.audio;
  if(!reset&&audio.id!==(audioZone?.id??null)){const old=this.source.environment.zones.find(z=>z.id===audio.id);audio={id:audioZone?.id??null,from:audio.id,elapsed:0,total:audioZone?.fadeTicks??(old?.kind==='audio'?old.fadeTicks:0)};}
  if(audio.elapsed<audio.total)audio={...audio,elapsed:audio.elapsed+1};
  const warnings:string[]=[];
  const ties=(kind:string,z:readonly {id:string;priority?:number}[])=>{if(z.length>1&&z[0]!.priority===z[1]!.priority)warnings.push('Equal-priority '+kind+' zones; stable ID '+z[0]!.id+' wins');};ties('camera',zones);
  for(const kind of ['audio','transition','movementModifier','launch'] as const)ties(kind,environment.filter(z=>z.kind===kind));
  if(effective.bounds[2]<size[0]||effective.bounds[3]<size[1])warnings.push('Bounds smaller than viewport: centered letterbox');
  const view:CameraView=own({identity:{key:'maplab.reference-camera-preview',version:1,canCertifyEngine:false},mapId:this.source.id,tick:actor.tick,zoneId,activeZoneIds:zones.map(z=>z.id),center,view:rect,effective,deadZoneWorld:[rect[0]+size[0]*effective.deadZone[0],rect[1]+size[1]*effective.deadZone[1],size[0]*effective.deadZone[2],size[1]*effective.deadZone[3]],letterboxWU:[Math.max(0,(size[0]-effective.bounds[2])/2),Math.max(0,(size[1]-effective.bounds[3])/2)],transition:blend?{fromZoneId:blend.zoneId,elapsedTicks:blend.elapsed,totalTicks:blend.total,progress}:null,warnings,environment:{ambientColor:this.source.environment.ambientColor,effects:this.source.environment.effects,shakeEffects:this.source.camera.shakeEffects,audio:{zoneId:audio.id,trackAssetId:audioZone?.trackAssetId??null,loop:audioZone?.loop??false,fadeTicks:audioZone?.fadeTicks??audio.total,fromZoneId:audio.from,elapsedTicks:audio.elapsed,progress:audio.total?audio.elapsed/audio.total:1},visualZoneId:visual?.id??null,visualEffect:visual?.effect??null,configuredZones:environment.filter((z,i)=>environment.findIndex(p=>p.kind===z.kind)===i).map(z=>({id:z.id,kind:z.kind,priority:'priority'in z?z.priority:0}))}});
  this.view=view;this.actor=own(actor);this.groundY=groundY;this.blend=blend&&blend.elapsed<blend.total?blend:null;this.audio=audio;this.samples=reset?1:this.samples+1;return view;
 }
}
