// Separate-process consumer: imports only the independent reader and published schemas.
import {readFileSync} from 'node:fs';
import {compile,validate} from './reader/schema.mjs';
import {parseStrict} from './reader/json.mjs';
const map=parseStrict(readFileSync(process.argv[2])),schema=compile(parseStrict(readFileSync('schemas/maplab.map.v1.schema.json')),'maplab.map');
const errors=validate(schema,map);if(errors.length)throw Error(JSON.stringify(errors.slice(0,4)));
const [x,y,w,h]=map.bounds;if(x< -131072||y< -131072||x+w>131072||y+h>131072)throw Error('World bounds exceed coordinate contract');
for(const layer of map.terrain)for(const chunk of layer.chunks)for(let i=0;i<1024;i++)if(chunk.cells[i]){
 const px=layer.origin[0]+(chunk.column*32+i%32)*layer.cellSize[0],py=layer.origin[1]+(chunk.row*32+Math.floor(i/32))*layer.cellSize[1];
 if(px<x||px+layer.cellSize[0]>x+w||py<y||py+layer.cellSize[1]>y+h)throw Error('Occupied cell outside world bounds');
}
const cells=map.terrain.reduce((n,l)=>n+l.chunks.reduce((n,c)=>n+c.cells.filter(Boolean).length,0),0);
const ids=new Set();for(const key of ['layers','visuals','bodies','footholds'])for(const item of map[key]){if(ids.has(item.id))throw Error('Duplicate ID');ids.add(item.id);}
if(cells!==100000||map.layers.length!==20||map.visuals.length!==5000||map.bodies.length!==5000||map.footholds.length!==10000)throw Error('Wrong workload cardinality');
let previous=-1;for(const f of map.footholds){const i=Number(f.id.slice(3));if(i<=previous||f.b[0]-f.a[0]!==64)throw Error('Unstable geometry');previous=i;}
const result={cells,layers:map.layers.length,objects:map.visuals.length,bodies:map.bodies.length,footholds:map.footholds.length};
if(process.argv[3]==='--editor'){
 const starts=map.entities.filter(e=>e.kind==='playerStart'&&e.default);
 if(starts.length!==1||starts[0].anchor.kind!=='surface'||!map.footholds.some(f=>f.id===starts[0].anchor.footholdId)||!map.dependencies.some(d=>d.id===starts[0].movementId&&d.kind==='movement'&&d.required))throw Error('Incomplete editor start/dependency workload');
 result.defaultStart=starts[0].id;
}
console.log(JSON.stringify(result));
