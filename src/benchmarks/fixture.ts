// Original owned CC0 workload recipes; generated maps remain ordinary source documents.
import type { MapDocument } from '../contracts/document-types';
import type { TerrainChunk, Cell } from '../contracts';
import type { MovementDocument } from '../contracts/movement-types';
export interface Workload { readonly cells: number; readonly layers: number; readonly objects: number; readonly bodies: number; readonly footholds: number; readonly dense: boolean }
/** The complete editor additionally requires one default start and its closed movement dependency. */
export function editorFixture(base:MapDocument,w:Workload,profile:MovementDocument):MapDocument {
  const map=materialize(base,w);if(!map.footholds.length)throw Error('Editor workload requires a support');
  return {...map,dependencies:[...map.dependencies,{id:profile.id,kind:'movement',path:'movement/enemy.movement.json',required:true}],
    entities:[{id:'start.performance',name:'Performance player start',anchor:{kind:'surface',footholdId:'fh.0',u:.25,normalOffset:0},enabled:true,
      facing:'right',visualId:null,presentationId:null,kind:'playerStart',movementId:profile.id,default:true}]};
}
export function materialize(base: MapDocument, w: Workload): MapDocument {
  if (![w.cells,w.layers,w.objects,w.bodies,w.footholds].every(n=>Number.isSafeInteger(n)&&n>=0) || w.cells>100000 || w.layers<3 || w.layers>20 || w.objects>5000 || w.bodies>5000 || w.footholds>10000) throw Error('Invalid bounded workload');
  const body=base.bodies[0]!, foothold=base.footholds[0]!;
  const columns=w.footholds<=300?10:1000;
  const position=(i:number):readonly [number,number]=>w.dense?[i%10,100+i/16]:[(i%columns)*128,128+Math.floor(i/columns)*512];
  const cell:Cell={tileId:'tile.grass',quarterTurns:0,mirrorX:false,mirrorY:false}, chunks=new Map<string,TerrainChunk>();
  for(let i=0;i<w.cells;i++) {
    const x=i%5000,y=Math.floor(i/5000),column=Math.floor(x/32),row=Math.floor(y/32),key=`${column},${row}`;
    let c=chunks.get(key);if(!c){c={column,row,cells:Array<Cell|null>(1024).fill(null)};chunks.set(key,c);}
    (c.cells as (Cell|null)[])[(y%32)*32+x%32]=cell;
  }
  return {...structuredClone(base),id:'map.performance',bounds:[-80000,0,210000,20000],
    dependencies:w.cells?[{id:'tileset.forest',kind:'tileset',path:'tilesets/forest.tileset.json',required:true}]:[],
    layers:Array.from({length:w.layers},(_,i)=>i===0?{id:'layer.tiles',name:'Tiles',parentId:null,order:i,visible:true,opacity:1,kind:'tile' as const,occlusionFade:null}:i===w.layers-1?{id:'layer.actors',name:'Actors',parentId:null,order:i,visible:true,opacity:1,kind:'actors' as const}:{id:`layer.art${i}`,name:`Art ${i}`,parentId:null,order:i,visible:true,opacity:1,kind:'sprite' as const,occlusionFade:null}),
    terrain:w.cells?[{layerId:'layer.tiles',tilesetId:'tileset.forest',origin:[-80000,0],cellSize:[32,32],chunkSize:32,chunks:[...chunks.values()],terrainIntent:[],rulesVersion:1,variationSeed:7}]:[],
    visuals:Array.from({length:w.objects},(_,i)=>({id:`visual.${i}`,name:`Object ${i}`,layerId:`layer.art${1+i%(w.layers-2)}`,parentId:null,order:i,transform:{position:position(i),rotation:0,scale:[1,1],mirrorX:false,mirrorY:false},source:{kind:'shape',shape:{kind:'rect',rect:[0,0,32,32]},fill:'#80b090'},bodyId:null})),
    bodies:Array.from({length:w.bodies},(_,i)=>({...body,id:`body.${i}`,name:`Body ${i}`,position:position(i),shapes:[{id:`shape.${i}`,kind:'rect',rect:[0,0,64,16]}]})),
    footholds:Array.from({length:w.footholds},(_,i)=>{const [x,y]=position(i);return {...foothold,id:`fh.${i}`,name:`Support ${i}`,a:[x,y],b:[x+64,y],ownerBodyId:null,mode:'oneWay',solidEdge:null,dropAllowed:true,dropGroupId:`drop.${i}`,connections:{a:[],b:[]}};})};
}
export function costFixture() {
  return {nodes:Array.from({length:2000},(_,i)=>({id:`n${i}`,x:i})),edges:Array.from({length:8000},(_,i)=>{const from=Math.floor(i/4),step=1+i%4,to=Math.min(1999,from+step);return {id:`e${i}`,from:`n${from}`,to:`n${to}`,ticks:step,penalty:0};})};
}
