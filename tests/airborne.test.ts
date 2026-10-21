import {test,expect} from 'vitest';
import {readFileSync,readdirSync,writeFileSync,mkdtempSync,realpathSync,cpSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import type {MapDocument} from '../src/contracts/document-types';
import type {MovementDocument} from '../src/contracts/movement-types';
import {buildAirborneActions,airborneIdentity,AIR_DEFAULTS,type AirResult} from '../src/navigation/airborne';
import {createWorld,step,replayBytes,digest,type ContactMap} from '../src/physics-reference';
const folder=join(process.cwd(),'conformance/airborne'),read=<T>(p:string):T=>JSON.parse(readFileSync(join(folder,p),'utf8'));
const cases=read<{license:string;cases:{id:string;map:string;profile:string}[]}>('cases.json');
const docs=():[MapDocument,MovementDocument]=>[read('forest.map.json'),read('player.movement.json')];
const graphs=new Map<string,AirResult>();
for(const c of cases.cases)test('owned exact airborne sampling and full-body controller replay: '+c.id,async()=>{
 const map=read<MapDocument>(c.map),p=read<MovementDocument>(c.profile),before=replayBytes([map,p]);
 const g=await buildAirborneActions(map,p,1,undefined,undefined,async()=>{});graphs.set(c.id,g);
 expect(replayBytes([map,p])).toBe(before);expect(replayBytes(g)+'\n').toBe(readFileSync(join(folder,c.id+'.actions.json'),'utf8'));
 expect(g.complete).toBe(false);expect(g.canCertify).toBe(false);
 const w=createWorld(map as unknown as ContactMap,p);
 for(const e of g.edges){let s=e.initial,index=0,air=false;
  for(const [n,f] of e.frames.entries()){
   while(e.input[index+1]&&e.input[index+1]!.fromTick<=s.tick)index++;
   const {fromTick:_,...controls}=e.input[index]!;expect(step(w,s,controls)).toEqual(f);
   expect(f.status).toBe('ok');if(f.state.mode==='air')air=true;else if(air)expect(n).toBe(e.frames.length-1);
   s=f.state as typeof s;
  }
  expect(s).toEqual(e.terminal);expect(s.supportId).not.toBe(e.initial.supportId);expect(air).toBe(true);
  const d=e.dependencies;expect(d.sha256).toBe(await digest({identity:d.identity,sweptBoundsSu:d.sweptBoundsSu,initial:e.initial,input:e.input,frames:e.frames}));
 }
},120_000);
test('forest equations, short/no jump, ceiling/corner and narrow stance are independently pinned',()=>{
 const forest=graphs.get('forest')!,edge=forest.edges.find(e=>e.initial.x===480*256&&e.initial.vx===1024&&e.terminal.x===660*256)!;
 expect(edge).toBeDefined();expect(edge.costTicks).toBe(45);
 for(let n=1;n<=45;n++)expect(edge.frames[n-1]!.state).toMatchObject({x:(480+n*4)*256,y:300*256-n*2112+96*n*(n-1)/2,vy:n===45?0:-2112+96*n});
 for(const id of ['ceiling','narrow','short','enemy'])expect(graphs.get(id)).toMatchObject({status:'no route found within declared search/sampling budget',edges:[],complete:false,canCertify:false});
 const corner=graphs.get('corner')!;
 expect(corner.edges.some(e=>e.initial.x===480*256&&e.initial.vx===1024&&e.terminal.supportId==='fh.east')).toBe(false);
 // The foot-point parabola clears this corner; the 24x48WU body does not.
 for(let n=1;n<=45;n++){const x=480+n*4,y=300-(n*2112-96*n*(n-1)/2)/256;expect(x>600&&x<601&&y>220&&y<300).toBe(false);}
 const [base,p]=docs(),map=read<MapDocument>('corner.map.json'),w=createWorld(map as unknown as ContactMap,p);let s=edge.initial,hit=false;
 for(let n=0;n<45;n++){const f=step(w,s,{moveX:1,moveY:0,run:true,jump:n===0,drop:false});hit ||= f.contacts.some(c=>c.bodyId==='body.wall');s=f.state as typeof s;}
 expect(hit).toBe(true);expect(base.bounds).toEqual(map.bounds);
 expect(corner.rejected['wall-or-ceiling']).toBeGreaterThan(0);expect(graphs.get('ceiling')!.rejected['wall-or-ceiling']).toBeGreaterThan(0);
 expect(graphs.get('narrow')!.intervals.some(i=>i.supportId==='fh.east')).toBe(false);
 expect(graphs.get('enemy')!.diagnostics).toContain('no jump ability');
});
test('selected-group drops land on the immediately lower other group; edge falls retain launch velocity',()=>{
 const drop=graphs.get('drop')!.edges.filter(e=>e.kind==='drop'&&e.initial.supportId==='fh.elevated'&&e.initial.x===64*256&&e.initial.vx===0&&e.input.every(i=>i.moveX===0));
 expect(drop.length).toBeGreaterThan(0);for(const e of drop){expect(e.terminal.supportId).toBe('fh.lower');expect(e.costTicks).toBe(10);expect(e.terminal.dropSuppression?.group).toBe('drop.upper');}
 expect(graphs.get('forest')!.edges.some(e=>e.kind==='drop')).toBe(false);
 const falls=graphs.get('fall')!.edges.filter(e=>e.kind==='fall');expect(falls.length).toBeGreaterThan(0);
 for(const e of falls){expect(e.input.every(i=>!i.jump&&!i.drop)).toBe(true);}
 expect(falls.some(e=>e.initial.vx===1024)).toBe(true);
});
test('sample, replay, per-action and clearance exhaustion return explicit empty budget; cancellation publishes nothing',async()=>{
 const [m,p]=docs();
 for(const settings of [{...AIR_DEFAULTS,maxCandidates:1},{...AIR_DEFAULTS,maxReplayTicks:1},{...AIR_DEFAULTS,maxTicks:1},{...AIR_DEFAULTS,maxClearanceSamples:1}]){
  const g=await buildAirborneActions(settings.maxTicks===1?read<MapDocument>('drop.map.json'):m,p,1,settings,undefined,async()=>{});expect(g).toMatchObject({status:'budget',intervals:[],edges:[]});
 }
 expect(await buildAirborneActions(m,p,1,AIR_DEFAULTS,()=>true)).toMatchObject({status:'cancelled',edges:[]});
 let cancel=false;expect(await buildAirborneActions(m,p,1,AIR_DEFAULTS,()=>cancel,async()=>{cancel=true;})).toMatchObject({status:'cancelled',edges:[]});
 await expect(buildAirborneActions(m,p,-1)).rejects.toThrow();await expect(buildAirborneActions(m,p,1,{...AIR_DEFAULTS,spacingSu:0})).rejects.toThrow();
},120_000);
test('physical insertion/deletion, coefficient edits and all sampling parameters invalidate; names/art stay warm',async()=>{
 const [m,p]=docs(),a=await airborneIdentity(m,p,AIR_DEFAULTS);
 expect((await airborneIdentity({...m,visuals:[],metadata:{...m.metadata,name:'Art rename'}},p,AIR_DEFAULTS)).cacheKey).toBe(a.cacheKey);
 for(const changed of [{...m,bodies:[]},read<MapDocument>('corner.map.json'),{...m,materials:m.materials.map(v=>({...v,traction:128}))}])expect((await airborneIdentity(changed,p,AIR_DEFAULTS)).cacheKey).not.toBe(a.cacheKey);
 expect((await airborneIdentity(m,{...p,air:{...p.air,gravity:97}},AIR_DEFAULTS)).cacheKey).not.toBe(a.cacheKey);
 for(const key of Object.keys(AIR_DEFAULTS) as (keyof typeof AIR_DEFAULTS)[])expect((await airborneIdentity(m,p,{...AIR_DEFAULTS,[key]:AIR_DEFAULTS[key]-1})).cacheKey).not.toBe(a.cacheKey);
 const swapped={...m,bodies:[...m.bodies].reverse(),footholds:[...m.footholds].reverse()};expect((await airborneIdentity(swapped,p,AIR_DEFAULTS)).cacheKey).toBe(a.cacheKey);
});
test('advanced movement, dynamic bodies and navigation intent cannot be inferred as physical witnesses',async()=>{
 const [m,p]=docs();
 const advanced={...p,abilities:p.abilities.map(a=>a.kind==='jump'?{...a,airJumps:1}:a)};
 expect(await buildAirborneActions(m,advanced,1)).toMatchObject({status:'unsupported',edges:[]});
 expect(await buildAirborneActions({...m,bodies:m.bodies.map(b=>({...b,mobility:'kinematic' as const}))},p,1)).toMatchObject({status:'unsupported',edges:[]});
 const intent={...m,navigation:{...m.navigation,overrides:[{id:'nav.deny',regionId:'region.any',profileIds:[p.id],actions:['jump'],policy:'forbid' as const,penaltyTicks:0}]}};
 expect(await buildAirborneActions(intent,p,1)).toMatchObject({status:'unsupported',edges:[]});
});
test('final-byte isolated independent consumer validates numeric witnesses and rejects semantic corruption',()=>{
 const index=read<{files:{path:string;sha256:string}[]}>('index.json');expect(cases.license).toBe('CC0-1.0');expect(index.files.map(f=>f.path).sort()).toEqual(readdirSync(folder).filter(f=>f!=='index.json').sort());for(const f of index.files)expect(createHash('sha256').update(readFileSync(join(folder,f.path))).digest('hex')).toBe(f.sha256);
 const dir=realpathSync(mkdtempSync(join(realpathSync(tmpdir()),'maplab-airborne-consumer-')));
 try{
  cpSync(folder,join(dir,'fixtures'),{recursive:true});cpSync('tests/consumer/airborne.mjs',join(dir,'consumer.mjs'));
  const run=()=>execFileSync(process.execPath,[join(dir,'consumer.mjs'),join(dir,'fixtures')],{cwd:dir,encoding:'utf8',maxBuffer:10_000_000,stdio:['ignore','pipe','pipe']});
  const out=JSON.parse(run());expect(out).toMatchObject({cases:cases.cases.length,verified:true});expect(out.forest).toBeGreaterThan(0);expect(out.drop).toBeGreaterThan(0);expect(out.fall).toBeGreaterThan(0);
  // Rehash a semantically corrupt package: a consumer must not trust hashes alone.
  const file=join(dir,'fixtures/forest.actions.json'),g=JSON.parse(readFileSync(file,'utf8'));g.edges[0].terminal.supportId='fh.fake';writeFileSync(file,JSON.stringify(g)+'\n');
  const ix=JSON.parse(readFileSync(join(dir,'fixtures/index.json'),'utf8'));ix.files.find((f:{path:string})=>f.path==='forest.actions.json').sha256=createHash('sha256').update(readFileSync(file)).digest('hex');writeFileSync(join(dir,'fixtures/index.json'),JSON.stringify(ix));expect(run).toThrow();
 }finally{rmSync(dir,{recursive:true,force:true});}
},60_000);
