import {flushSync} from 'react-dom';
import type {LibraryStore} from '../app/store';
import {PaintBuffer} from '../domain/paint';
import {gridOf} from '../editor/terrain';
import {buildScene} from '../render/scene';
import {PickIndex,overlaps} from '../render/picking';
import {visibleWorld,worldToCss} from '../render/transform';
import {ImageLru,IMAGE_BUDGET} from '../render/assets';
import {CONTROLLER_SHA256} from '../navigation/identity';
import {summarize} from './run';
const frame=()=>new Promise<number>(resolve=>requestAnimationFrame(resolve));
const presented=async()=>{await frame();await frame();};
const percentile=(raw:readonly number[],p=.95)=>[...raw].sort((a,b)=>a-b)[Math.ceil(raw.length*p)-1]!;
const post=async(path:string,body:unknown)=>{const r=await fetch('/measurement/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();};
async function warm(fn:()=>void|Promise<void>){await fn();const raw=[];for(let i=0;i<5;i++){const start=performance.now();await fn();raw.push(performance.now()-start);}return summarize(raw);}
export async function runEditorMeasurements(store:LibraryStore,status:(message:string)=>void){
  const browser=/Version\/.+Safari\//.test(navigator.userAgent)?'safari':'chromium';
  const identity=await fetch('/measurement/identity').then(r=>r.json());
  await presented();const doc=store.active();if(!doc)throw Error('Owned map is not open');
  const model=doc.state.model,viewport=store.viewport(doc.id),selection=store.selection(doc.id);
  const canvas=document.querySelector<HTMLDivElement>('[aria-label="World canvas"]')!;
  canvas.scrollIntoView({block:'center'});await presented();
  const reset=()=>{viewport.zoom([0,0],1);const current=viewport.getSnapshot().view.camera;viewport.pan([current[0]-1000,current[1]-300]);};
  reset();await presented();
  const startMemory=await post('start',{browser});
  const scene=buildScene(model,store.getSnapshot().tilesets),index=new PickIndex(model,scene);
  const counts={cells:[...model.terrain!.byLayer.values()].reduce((n,l)=>n+[...l.cells.chunks.values()].reduce((a,c)=>a+c.filter(Boolean).length,0),0),layers:model.collections.get('layers')!.order.length,
    objects:model.collections.get('visuals')!.order.length,bodies:model.collections.get('bodies')!.order.length,footholds:model.collections.get('footholds')!.order.length};
  const visible=()=>{
    const s=viewport.getSnapshot(),rect=visibleWorld(s.view,s.size);
    const objects=scene.art.reduce((n,l)=>n+l.commands.filter(p=>overlaps(p.bounds,rect)).length,0);
    let tiles=0;for(const layer of model.terrain!.byLayer.values())for(const [key,chunk] of layer.cells.chunks){const [cx,cy]=key.split(',').map(Number),p=gridOf(layer);
      for(let i=0;i<1024;i++)if(chunk[i]&&overlaps([p.origin[0]+(cx!*32+i%32)*p.cellSize[0],p.origin[1]+(cy!*32+Math.floor(i/32))*p.cellSize[1],p.cellSize[0],p.cellSize[1]],rect))tiles++;}
    if(!objects||objects>1000||!tiles||tiles>10000)throw Error(`Invalid visible workload: ${tiles} tiles, ${objects} objects; rect=${JSON.stringify(rect)}`);
    return {tiles,objects,rect};
  };
  const camera=[];let tasks:number[]=[];
  const observer=PerformanceObserver.supportedEntryTypes.includes('longtask')?new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration))):null;
  observer?.observe({type:'longtask'});
  status('Measuring the complete editor: five warm ten-second camera sweeps…');
  for(let run=-1;run<5;run++){
    reset();await presented();const before=visible(),raw:number[]=[];tasks=[];const start=performance.now();let previous=await frame();
    do {
      flushSync(()=>{viewport.pan([-2,0]);viewport.zoom([viewport.getSnapshot().size[0]/2,viewport.getSnapshot().size[1]/2],1+.1*Math.sin((performance.now()-start)/1000));});
      const now=await frame();raw.push(now-previous);previous=now;
    }while(performance.now()-start<(run<0?1000:10000));
    await new Promise(r=>setTimeout(r,0));if(run>=0)camera.push({frames:raw,p50:percentile(raw,.5),p95:percentile(raw),longTasks:[...tasks],before,after:visible()});
  }
  observer?.disconnect();reset();await presented();
  status('Measuring indexed hit/miss lookup, selection inspector and hierarchy search…');
  const hit=()=>index.pick(worldToCss(viewport.getSnapshot().view,[16,144]),viewport.getSnapshot(),'Objects');
  const select=await warm(()=>{const found=hit();if(found[0]?.id!=='visual.0')throw Error('Indexed hit missed visual.0');
    const miss=index.pick(worldToCss(viewport.getSnapshot().view,[100000,10000]),viewport.getSnapshot(),'Objects');if(miss.length)throw Error('Indexed miss returned an object');});
  const inspector=await warm(async()=>{flushSync(()=>selection.select([{collection:'visuals',id:'visual.42'}]));await presented();
    if(!document.querySelector('[aria-label="Numeric inspector"]')?.textContent?.includes('visual.42'))throw Error('Inspector did not display selected ID');
    flushSync(()=>selection.select([]));await presented();});
  const input=document.querySelector<HTMLInputElement>('input[type="search"]')!;
  const setSearch=async(value:string)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(input,value);
    flushSync(()=>input.dispatchEvent(new Event('input',{bubbles:true})));await presented();};
  const search=await warm(async()=>{await setSearch('Object 42');const matches=[...document.querySelectorAll<HTMLButtonElement>('ul[data-collection="visuals"] button')];
    if(!matches.length||matches.some(b=>!b.textContent?.includes('Object 42')))throw Error('Inspector search result does not match the workload');await setSearch('');});
  status('Measuring 10,000-cell undo/redo, history pressure and decoded-art LRU pressure…');
  const buffer=new PaintBuffer(store.active()!.state.model.terrain!.byLayer.get('layer.tiles')!.cells);
  for(let i=0;i<10000;i++)buffer.write({column:i%100,row:100+Math.floor(i/100),cell:{tileId:'tile.grass',quarterTurns:0,mirrorX:false,mirrorY:false}});
  if(!store.edit(doc.id,{label:'Owned 10k-cell workload',ops:[{op:'paint',layerId:'layer.tiles',delta:buffer.delta()!}]}))throw Error('10k paint was refused');await presented();
  const history=await warm(async()=>{flushSync(()=>store.undo());await presented();flushSync(()=>store.redo());await presented();});
  const cache=new ImageLru();let closed=0;
  for(let i=0;i<=IMAGE_BUDGET/(1024*1024*4);i++){const surface=document.createElement('canvas');surface.width=surface.height=1024;
    surface.getContext('2d')!.fillRect(0,0,1024,1024);cache.put(String(i),{source:surface,width:1024,height:1024,close(){closed++;surface.width=surface.height=0;}});}
  if(!closed||cache.bytes>cache.budget||cache.get('0'))throw Error('Decoded-art pressure did not evict the oldest surface');
  await presented();const cachePressure={bytes:cache.bytes,budget:cache.budget,closed};await post('snapshot',{browser,label:'cache-pressure'}).catch(()=>{});cache.clear();
  const state=store.active()!.state;
  const summary={camera:summarize(camera.map(r=>r.p95)),select,inspector,search,history};
  const report={browser,controller:CONTROLLER_SHA256,userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,
    build:identity,startMemory,counts,camera,summary,historyPressure:{bytes:state.bytes,budget:state.budget,dropped:state.dropped},cachePressure,
    limitations:['Input-to-presentation samples and history pressure saturation are not yet captured.','Safari has no Long Tasks observer; frame gaps are retained separately.'],
    complete:false};
  return report;
}
