// Separate-process consumer: imports only the independent reader and published schemas.
import {readFileSync} from 'node:fs';
import {compile,validate} from './reader/schema.mjs';
import {parseStrict} from './reader/json.mjs';
const map=parseStrict(readFileSync(process.argv[2])),schema=compile(parseStrict(readFileSync('schemas/maplab.map.v1.schema.json')),'maplab.map');
const errors=validate(schema,map);if(errors.length)throw Error(JSON.stringify(errors.slice(0,4)));
const cells=map.terrain.reduce((n,l)=>n+l.chunks.reduce((n,c)=>n+c.cells.filter(Boolean).length,0),0);
const ids=new Set();for(const key of ['layers','visuals','bodies','footholds'])for(const item of map[key]){if(ids.has(item.id))throw Error('Duplicate ID');ids.add(item.id);}
if(cells!==100000||map.layers.length!==20||map.visuals.length!==5000||map.bodies.length!==5000||map.footholds.length!==10000)throw Error('Wrong workload cardinality');
let previous=-1;for(const f of map.footholds){const i=Number(f.id.slice(3));if(i<=previous||f.b[0]-f.a[0]!==64)throw Error('Unstable geometry');previous=i;}
console.log(JSON.stringify({cells,layers:map.layers.length,objects:map.visuals.length,bodies:map.bodies.length,footholds:map.footholds.length}));
