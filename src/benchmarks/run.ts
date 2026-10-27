import type { MapDocument } from '../contracts/document-types';
import type { MovementDocument } from '../contracts/movement-types';
import type { TilesetDocument, JsonValue } from '../contracts';
import { normalize } from '../domain/model';
import { PaintBuffer } from '../domain/paint';
import { openDocument, commit, undo, redo } from '../editor/history';
import { TerrainSession } from '../editor/terrain-session';
import { ViewportSession } from '../editor/viewport';
import { buildScene } from '../render/scene';
import { PickIndex } from '../render/picking';
import { CanvasViewport } from '../render/canvas';
import { searchCostGraph } from '../navigation/search';
import { CONTROLLER_SHA256 } from '../navigation/identity';
import { materialize, costFixture, type Workload } from './fixture';
export const summarize=(raw:readonly number[])=>{
  if(raw.length!==5||raw.some(n=>!Number.isFinite(n)||n<0))throw Error('Expected five finite warm measurements');
  const sorted=[...raw].sort((a,b)=>a-b);return {raw,p50:sorted[2]!,p95:sorted[4]!};
};
const frame=()=>new Promise<number>(resolve=>requestAnimationFrame(resolve));
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const heap=():number|null=>(performance as Performance & {memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize??null;
async function warm(fn:()=>void|Promise<unknown>) {
  await fn();const raw:number[]=[];for(let i=0;i<5;i++){const start=performance.now();await fn();raw.push(performance.now()-start);}return summarize(raw);
}
async function navigation(map:MapDocument,profile:MovementDocument,cancel:boolean) {
  const worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
  let stop=()=>{};
  try {
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker startup timeout')),10000);worker.onmessage=e=>{if(e.data.kind==='ready'){clearTimeout(timer);resolve();}};});
    const start=performance.now();
    const result=new Promise<{status:string;ms:number}>((resolve)=>{
      const timer=setTimeout(()=>resolve({status:'timeout; terminated',ms:performance.now()-start}),20000);stop=()=>clearTimeout(timer);
      worker.onmessage=e=>{if(e.data.kind==='result'){stop();resolve({status:e.data.graph.status,ms:performance.now()-start});}
        else if(e.data.kind==='pong'){stop();resolve({status:'cancel processed; event loop responsive',ms:performance.now()-cancelAt});}
        else if(e.data.kind==='error'){stop();resolve({status:e.data.reason,ms:performance.now()-start});}};
    });
    let cancelAt=start;
    worker.postMessage({kind:'build',job:1,revision:1,map,profile,settings:{maxSamples:cancel?2000000:4096,maxTicks:60}});
    if(cancel){await wait(20);cancelAt=performance.now();worker.postMessage({kind:'cancel',job:1});worker.postMessage({kind:'ping',id:1});}
    return await result;
  } finally {stop();worker.terminate();}
}
export async function runBenchmarks(base:MapDocument,profile:MovementDocument,tileset:TilesetDocument,recipes:{standard:Workload;dense:Workload;baseline:Workload;multilevel:Workload}) {
  const baselineHeap=heap(),map=materialize(base,recipes.standard),n=normalize(map as unknown as JsonValue);
  if(!n.ok)throw Error(JSON.stringify(n.problems));
  let state=openDocument(n.model),view=new ViewportSession();view.resize([1440,900],map.bounds);view.zoom([720,450],1);
  const scene=buildScene(state.model,new Map([[tileset.id,tileset]])),pick=new PickIndex(state.model,scene);
  const art=document.querySelector<HTMLCanvasElement>('#art')!,overlay=document.querySelector<HTMLCanvasElement>('#overlay')!;
  const renderer=new CanvasViewport(art,overlay,scene,view.getSnapshot());
  const session=new TerrainSession(()=>state.model,()=>tileset,tx=>{const r=commit(state,tx);state=r.state;return r.outcome==='recorded';},()=>true);
  session.choose({tileId:'tile.grass',quarterTurns:0,mirrorX:false,mirrorY:false});
  const input=await warm(()=>{const model=state.model;session.down([16,16]);session.move([48,16]);renderer.setTerrainPreview(session.getSnapshot().preview);if(state.model!==model)throw Error('Preview mutated document');session.cancel();});
  const buffer=new PaintBuffer(state.model.terrain!.byLayer.get('layer.tiles')!.cells);
  for(let i=0;i<10000;i++)buffer.write({column:i%100,row:100+Math.floor(i/100),cell:{tileId:'tile.grass',quarterTurns:0,mirrorX:false,mirrorY:false}});
  const delta=buffer.delta()!;const committed=commit(state,{label:'Benchmark 10k paint',ops:[{op:'paint',layerId:'layer.tiles',delta}]});
  if(committed.outcome!=='recorded')throw Error('Paint was refused');state=committed.state;
  const history=await warm(()=>{state=redo(undo(state));if(state.bytes>state.budget)throw Error('History exceeded budget');});
  const select=await warm(()=>{pick.pick([32,128],view.getSnapshot(),'Objects');});
  const search=await warm(()=>{state.model.collections.get('visuals')!.order.filter(id=>state.model.collections.get('visuals')!.byId.get(id)!.name!.toString().includes('42'));});
  const graph=costFixture(),query=await warm(async()=>{const r=await searchCostGraph(graph,'n0','n1999','astar');if(r.status!=='candidate'||r.cost!==1999)throw Error('Wrong graph result');});
  const frames:number[][]=[],longTasks:number[][]=[];
  let tasks:number[]=[];const observer=typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes.includes('longtask')?new PerformanceObserver(list=>{tasks.push(...list.getEntries().map(e=>e.duration));}):null;
  observer?.observe({type:'longtask'});
  try {
    // One discarded warm sweep, then five ten-second camera sweeps at the specified viewport/DPR.
    for(let run=-1;run<5;run++){
      const raw:number[]=[];tasks=[];const start=performance.now();let previous=await frame();
      do {view.pan([-2,0]);renderer.update(scene,view.getSnapshot());const now=await frame();raw.push(now-previous);previous=now;}while(performance.now()-start<(run<0?500:10000));
      if(run>=0){frames.push(raw);longTasks.push(tasks);}view.pan([2000,0]);
    }
  } finally {observer?.disconnect();renderer.dispose();session.cancel();}
  const frameP95=frames.map(raw=>[...raw].sort((a,b)=>a-b)[Math.ceil(raw.length*0.95)-1]!);
  const memory={baselineHeap,usedHeap:heap(),historyBytes:state.bytes,historyBudget:state.budget,scope:'JS heap snapshot only; browser/GPU working set unmeasured'};
  const nav:Record<string,unknown>={};
  for(const key of ['baseline','multilevel','dense'] as const){const source=materialize(base,recipes[key]),raw=[];let status='';
    await navigation(source,profile,key==='dense');
    for(let i=0;i<5;i++){const r=await navigation(source,profile,key==='dense');raw.push(r.ms);status=r.status;}nav[key]={...summarize(raw),status};}
  return {controller:CONTROLLER_SHA256,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,userAgent:navigator.userAgent,
    counts:recipes.standard,input,history,select,search,query,camera:{...summarize(frameP95),frames,longTasks,taskObservation:observer?'supported':'unavailable'},memory,nav,
    scopeSplits:['CI browser build on Linux is not the Apple M1/16 GiB hardware-accelerated baseline or Safari.',
      'Input measures synchronous preview preparation; end-to-end pointer-to-present latency remains unmeasured.',
      '4096-sample graph jobs report budget honestly; full 100/300-support and incremental-edit targets remain unproven.',
      '10 MiB validated plugin save and 100 MiB cancellable worker export require a separate storage workload.',
      'JS heap excludes browser/GPU allocations; total 512 MiB working-set target remains unproven.']};
}
