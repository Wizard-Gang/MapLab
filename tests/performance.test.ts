import {test,expect} from 'vitest';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {MapDocument} from '../src/contracts/document-types';
import {materialize,costFixture} from '../src/benchmarks/fixture';
import {searchCostGraph} from '../src/navigation/search';
const read=(f:string)=>JSON.parse(readFileSync(f,'utf8'));
const recipes=read('conformance/performance/cases.json'),base=read('conformance/surface/flat.map.json') as MapDocument;
test('standard recipe materializes stable ordinary source bytes readable by an independent process',()=>{
  const map=materialize(base,recipes.standard),bytes=JSON.stringify(map);expect(JSON.stringify(materialize(base,recipes.standard))).toBe(bytes);
  const dir=mkdtempSync(join(tmpdir(),'maplab-performance-'));
  try{const file=join(dir,'standard.map.json');writeFileSync(file,bytes);const result=JSON.parse(execFileSync(process.execPath,['tests/consumer/performance.mjs',file],{encoding:'utf8'}));expect(result).toMatchObject({cells:100000,layers:20,objects:5000,bodies:5000,footholds:10000});}
  finally{rmSync(dir,{recursive:true,force:true});}
});
test('negative recipes refuse unsafe or out-of-scope allocations',()=>{
  for(const change of [{cells:100001},{cells:-1},{objects:5001},{bodies:5001},{footholds:10001},{layers:2},{cells:NaN}])expect(()=>materialize(base,{...recipes.standard,...change})).toThrow('Invalid bounded workload');
});
test('dense stress retains all bodies and footholds rather than silently truncating',()=>{
  const map=materialize(base,recipes.dense);expect(map.bodies).toHaveLength(5000);expect(map.footholds).toHaveLength(10000);expect(new Set(map.footholds.map(f=>f.a.join(','))).size).toBe(100);
});
test('2000/8000 query agrees with independent analytic shortest cost and Dijkstra',async()=>{
  const graph=costFixture();expect(graph.nodes).toHaveLength(2000);expect(graph.edges).toHaveLength(8000);
  for(const algorithm of ['astar','dijkstra'] as const){const r=await searchCostGraph(graph,'n0','n1999',algorithm);expect([r.status,r.cost]).toEqual(['candidate',1999]);}
  expect((await searchCostGraph(graph,'n0','n1999','astar',0)).status).toBe('budget');
});
test('owned recipe index pins final bytes',()=>{
  const index=read('conformance/performance/index.json');for(const file of index.files)expect(createHash('sha256').update(readFileSync('conformance/performance/'+file.path)).digest('hex')).toBe(file.sha256);
});
