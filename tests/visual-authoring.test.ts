import { expect,test,vi } from 'vitest';
import { CanvasViewport } from '../src/render/canvas';
import { forestDocument,modelOf } from './history-support';
import type { Asset, Layer, Visual, Vec2 } from '../src/contracts';
import { addLayer,addVisual,parentVisual,visualFrame } from '../src/editor/visuals';
import { candidate,editProblems } from '../src/editor/editing';
import { setOp,transaction } from '../src/domain/commands';
import { forest } from './terrain-support';
import { buildScene,frameAsset,records } from '../src/render/scene';
import { applyAffine,backgroundShift,backgroundView,modulo,multiply,repeatRange,visualMatrix } from '../src/render/transform';
import { openDocument,commit,undo,redo } from '../src/editor/history';
import { modelText } from '../src/editor/document';
import { PickIndex } from '../src/render/picking';
import { ViewportSession } from '../src/editor/viewport';
const shape={kind:'shape' as const,shape:{kind:'rect' as const,rect:[0,0,8,8] as const},fill:'#73b994'};
function sceneFixture(){let m=forest();const group=addLayer(m,'group');m=candidate(m,group.tx);const sprite=addLayer(m,'sprite');m=candidate(m,sprite.tx);m=candidate(m,transaction('Group',[setOp(m,'layers',sprite.id,'parentId',group.id),setOp(m,'layers',group.id,'opacity',0.5),setOp(m,'layers',sprite.id,'opacity',0.5)]));const parent=addVisual(m,sprite.id,shape);m=candidate(m,parent.tx);const child=addVisual(m,sprite.id,shape);m=candidate(m,child.tx);return {m,group:group.id,layer:sprite.id,parent:parent.id,child:child.id};}
test('fully valid shared-frame visual fixture composes parent transforms, moves children once, and is one undo',()=>{
  let {m,parent,child}=sceneFixture();m=candidate(m,transaction('Pose',[setOp(m,'visuals',parent,'transform',{position:[64,32],rotation:90,scale:[2,2],mirrorX:false,mirrorY:false}),setOp(m,'visuals',child,'transform',{position:[16,8],rotation:0,scale:[1,1],mirrorX:false,mirrorY:false})]));expect(editProblems(m)).toEqual([]);const state=openDocument(m);const tx=parentVisual(m,child,parent),after=commit(state,tx);expect(after.outcome).toBe('recorded');if(after.outcome!=='recorded')throw Error();expect(editProblems(after.state.model)).toEqual([]);const c=buildScene(after.state.model).art.flatMap(a=>a.commands).find(c=>c.objectId===child)!;expect(c.points[0]![0]).toBeCloseTo(48);expect(c.points[0]![1]).toBeCloseTo(64);expect(after.state.model.collections.get('bodies')).toBe(m.collections.get('bodies'));expect(modelText(undo(after.state).model)).toBe(modelText(m));expect(modelText(redo(undo(after.state)).model)).toBe(modelText(after.state.model));
});
test('layer groups multiply visibility/opacity, have no transform and preserve physical overlays',()=>{let {m,group,layer}=sceneFixture();const scene=buildScene(m);expect(scene.art.find(a=>a.layer.id===layer)?.opacity).toBe(0.25);expect(records<Layer>(m,'layers').find(l=>l.id===group)).not.toHaveProperty('transform');m=candidate(m,transaction('Hide',[setOp(m,'layers',group,'visible',false)]));const hidden=buildScene(m);expect(hidden.art.find(a=>a.layer.id===layer)?.visible).toBe(false);expect(hidden.passes).toEqual(scene.passes);});
test('cycles and cross-frame parents reject; changing root frame carries descendants and leaves body data intact',()=>{let {m,parent,child,layer}=sceneFixture();m=candidate(m,parentVisual(m,child,parent));expect(editProblems(candidate(m,parentVisual(m,parent,child))).join(' ')).toMatch(/cycle/);const other=addLayer(m,'sprite');m=candidate(m,other.tx);expect(editProblems(candidate(m,transaction('Bad',[setOp(m,'visuals',child,'layerId',other.id)]))).join(' ')).toMatch(/frame/);const after=candidate(m,visualFrame(m,parent,other.id,null));expect(records<Visual>(after,'visuals').filter(v=>[parent,child].includes(v.id)).every(v=>v.layerId===other.id)).toBe(true);expect(after.collections.get('bodies')).toBe(m.collections.get('bodies'));expect(()=>visualFrame(m,child,layer,null)).toThrow(/Detach/);expect(editProblems(after)).toEqual([]);});
test('pivot, WU scale, mirrored transform and inverse painter picking share exact source bounds',()=>{let {m,layer}=sceneFixture();const asset:Asset={id:'asset.test',path:'assets/test.png',mediaType:'image/png',size:[8,8],wuPerAssetUnit:2};const a=addVisual(m,layer,{kind:'asset',assetId:asset.id,pivot:[2,4]},asset);m=candidate(m,a.tx);const scene=buildScene(m),p=scene.art.flatMap(a=>a.commands).find(p=>p.objectId===a.id)!;expect(p.bounds).toEqual([-4,-8,16,16]);const viewport=new ViewportSession();viewport.resize([800,600],[0,0,800,600]);const view={...viewport.getSnapshot(),view:{camera:[0,0] as Vec2,origin:[0,0] as Vec2,zoom:1,pixelsPerWU:1}};expect(new PickIndex(m,scene).pick([0,0],view,'Objects')[0]?.id).toBe(a.id);});
test('background negative repeats, independent axes, origin parallax, phase and scroll are exact presentation math',()=>{let m=forest();const a=addLayer(m,'background');m=candidate(m,a.tx);const b={...records<Layer>(m,'layers').find(l=>l.id===a.id)!,parallax:[0.5,0.25],origin:[100,-20],repeat:'xy',repeatSize:[32,16],phase:[-3,-4],scrollWUPerTick:[-1,0.5]} as Extract<Layer,{kind:'background'}>;const view={camera:[-100,60] as Vec2,origin:[400,300] as Vec2,zoom:2,pixelsPerWU:1};expect(backgroundView(view,b).camera).toEqual([0,0]);expect(backgroundView(view,{...b,space:'camera'}).camera).toEqual([0,0]);expect(backgroundShift(b,2)).toEqual([27,13]);expect(modulo(-65,32)).toBe(31);expect(repeatRange([0,0,8,8],[-40,-20,48,28],[16,16],'xy')).toEqual([-3,0,-1,0]);expect(repeatRange([0,0,8,8],[-40,-20,48,28],[16,16],'none')).toEqual([0,0,0,0]);});
test('frame boundary, loop and once clamps are deterministic and nonphysical',()=>{const s={kind:'frames' as const,assetIds:['a','b','c'],pivot:[0,0] as Vec2,frameTicks:[2,3,1],loop:true};expect([0,1,2,4,5,6,100].map(t=>frameAsset(s,t))).toEqual(['a','a','b','b','c','a','b']);expect(frameAsset({...s,loop:false},100)).toBe('c');});
test('shared affine matches explicit mirror-scale-rotate-translate for all mirror pairs',()=>{for(const mirrorX of [false,true])for(const mirrorY of [false,true]){const t={position:[9,-6] as Vec2,rotation:90,scale:[2,3] as Vec2,mirrorX,mirrorY};const p:Vec2=[7,11],pivot:Vec2=[2,4],q=applyAffine(visualMatrix(t,pivot),p);expect(q[0]).toBeCloseTo(9-(11-4)*3*(mirrorY?-1:1));expect(q[1]).toBeCloseTo(-6+(7-2)*2*(mirrorX?-1:1));const both=multiply(visualMatrix(t),visualMatrix({...t,position:[3,4]}));const a=applyAffine(both,p),b=applyAffine(visualMatrix(t),applyAffine(visualMatrix({...t,position:[3,4]}),p));expect(a[0]).toBeCloseTo(b[0]);expect(a[1]).toBeCloseTo(b[1]);}});

test('world-space repeated background picking follows parallax/phase, while camera-space art stays hierarchy-only',()=>{
  let m=forest();const l=addLayer(m,'background');m=candidate(m,l.tx);
  m=candidate(m,transaction('Background',[setOp(m,'layers',l.id,'parallax',[0.5,0.5]),setOp(m,'layers',l.id,'repeat','xy'),setOp(m,'layers',l.id,'repeatSize',[64,64])]));
  const a=addVisual(m,l.id,shape);m=candidate(m,a.tx);const viewport=new ViewportSession();const state={...viewport.getSnapshot(),size:[800,600] as Vec2,view:{camera:[100,40] as Vec2,origin:[0,0] as Vec2,zoom:1,pixelsPerWU:1}};
  expect(new PickIndex(m,buildScene(m)).pick([15,46],state,'Objects')[0]?.id).toBe(a.id);
  m=candidate(m,transaction('Camera space',[setOp(m,'layers',l.id,'space','camera')]));expect(new PickIndex(m,buildScene(m)).items.some(p=>p.key.id===a.id)).toBe(false);
});

test('spatial index construction stays bounded for extreme composed parent transforms',()=>{
  let {m,layer}=sceneFixture(),parent:string|null=null;
  for(let i=0;i<18;i++){const a=addVisual(m,layer,shape);m=candidate(m,a.tx);m=candidate(m,transaction('Large local frame',[setOp(m,'visuals',a.id,'transform',{position:[64,64],rotation:0,scale:[16,16],mirrorX:false,mirrorY:false}),setOp(m,'visuals',a.id,'parentId',parent)]));parent=a.id;}
  const scene=buildScene(m);expect(scene.art.flatMap(a=>a.commands).some(p=>p.bounds[0]>Number.MAX_SAFE_INTEGER)).toBe(true);const index=new PickIndex(m,scene);expect(index.items.length).toBeGreaterThan(18);
});

test('owned numeric scene vectors pin affine, parent, parallax/repeat and primitive acceptance',async()=>{
  const {readFileSync}=await import('node:fs');const {createHash}=await import('node:crypto');const bytes=readFileSync(new URL('../conformance/visuals/scene-cases.json',import.meta.url));const index=JSON.parse(readFileSync(new URL('../conformance/visuals/index.json',import.meta.url),'utf8'));expect(createHash('sha256').update(bytes).digest('hex')).toBe(index.sceneCases.sha256);
  const f=JSON.parse(bytes.toString()),a=f.affine,p=applyAffine(visualMatrix(a,a.pivot),a.point);expect(p[0]).toBeCloseTo(a.expected[0]);expect(p[1]).toBeCloseTo(a.expected[1]);
  const b=f.background,base={kind:'background',origin:b.origin,parallax:b.parallax,space:'world',phase:b.phase,scrollWUPerTick:b.scroll,repeatSize:b.period,repeat:'xy'} as Extract<Layer,{kind:'background'}>;expect(backgroundView({camera:b.camera,origin:[0,0],zoom:1,pixelsPerWU:1},base).camera).toEqual(b.expectedCamera);expect(backgroundShift(base,b.tick)).toEqual(b.expectedShift);
  const r=f.repeat;expect(repeatRange(r.bounds,r.visible,r.period,r.axes)).toEqual(r.expectedIndices);
  let m=forest();const l=addLayer(m,'sprite');m=candidate(m,l.tx);for(const shape of f.primitives){const a=addVisual(m,l.id,{kind:'shape',shape,fill:'#448866'});m=candidate(m,a.tx);}expect(editProblems(m)).toEqual([]);
});


test('repeat ranges reject unsafe arithmetic and excessive copies, preserving bounded negative indices',()=>{
  expect(repeatRange([8.76874194493811e25,0,0,8],[0,0,800,600],[64,64],'x')).toBeNull();
  expect(repeatRange([0,0,8,8],[0,0,800,600],[Number.MIN_VALUE,64],'x')).toBeNull();
  expect(repeatRange([0,0,8,8],[Infinity,0,800,600],[64,64],'x')).toBeNull();
  expect(repeatRange([0,0,8,8],[0,0,800,600],[0,64],'x')).toBeNull();
  expect(repeatRange([0,0,8,8],[0,0,800,600],[0.0625,0.0625],'xy')).toBeNull();
  expect(repeatRange([0,0,0,0],[-4095,0,4095,0],[1,1],'x')).toEqual([-4095,0,0,0]);
  expect(repeatRange([0,0,0,0],[-4096,0,4096,0],[1,1],'x')).toBeNull();
  expect(repeatRange([0,0,8,8],[20,20,1,1],[64,64],'xy')).toEqual([0,-1,0,-1]);
});

test('accepted cancelling parent scales cannot hang background rendering or picking',()=>{
  const doc:any=forestDocument(),layer=doc.layers.find((l:Layer)=>l.id==='layer.far');Object.assign(layer,{repeat:'x',repeatSize:[64,64]});
  doc.visuals=doc.visuals.filter((v:Visual)=>v.layerId!==layer.id);let parent:string|null=null;
  for(let i=0;i<40;i++){const id=`visual.extreme${i}`;doc.visuals.push({id,name:id,layerId:layer.id,parentId:parent,order:i,bodyId:null,transform:{position:[64,0],rotation:0,scale:i<20?[16,16]:[1/16,1/16],mirrorX:false,mirrorY:false},source:shape});parent=id;}
  const m=modelOf(doc);expect(editProblems(m)).toEqual([]);const before=modelText(m),scene=buildScene(m),leaf=scene.art.flatMap(a=>a.commands).find(p=>p.objectId===parent)!;
  expect(leaf.bounds[0]).toBeGreaterThan(Number.MAX_SAFE_INTEGER);expect(repeatRange(leaf.bounds,[0,0,800,600],[64,64],'x')).toBeNull();
  let translations=0;const ctx=new Proxy({translate(){if(++translations>10000)throw new Error('Repeat watchdog');}},{get:(t,k)=>k in t?Reflect.get(t,k):()=>{}});
  const canvas=()=>({width:800,height:600,dataset:{},getContext:()=>ctx}) as unknown as HTMLCanvasElement;
  const session=new ViewportSession();session.resize([800,600],[0,0,800,600]);const state={...session.getSnapshot(),view:{camera:[0,0] as Vec2,origin:[0,0] as Vec2,zoom:1,pixelsPerWU:1}};
  vi.stubGlobal('window',{devicePixelRatio:1});vi.stubGlobal('requestAnimationFrame',()=>1);vi.stubGlobal('cancelAnimationFrame',()=>{});
  const notices:string[]=[];const renderer=new CanvasViewport(canvas(),canvas(),scene,state,s=>notices.push(s));
  try{
    expect(()=>(renderer as any).render()).not.toThrow();expect(notices.join(' ')).toContain('extreme parent transforms');
    const index=new PickIndex(m,scene);expect(index.pick([0,0],state,'Objects').some(k=>k.id===parent)).toBe(false);expect(index.marquee([0,0],[800,600],state,'Objects').some(k=>k.id===parent)).toBe(false);
    const extreme={...state,view:{...state.view,camera:[1e26,1e26] as Vec2}};expect(()=>index.pick([0,0],extreme,'Objects')).not.toThrow();
    expect(modelText(m)).toBe(before);
  }finally{renderer.dispose();vi.unstubAllGlobals();}
});
