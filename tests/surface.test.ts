import {test,expect} from 'vitest';
import {readFileSync,readdirSync,mkdtempSync,realpathSync,mkdirSync,writeFileSync,cpSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import type {MapDocument} from '../src/contracts/document-types';
import type {MovementDocument} from '../src/contracts/movement-types';
import {buildSurfaceGraph,identity,DEFAULT_SETTINGS,type Graph} from '../src/navigation/surface';
import {GraphSession,createGraphWorker,type Request,type Reply} from '../src/navigation/protocol';
import {CONTROLLER_SHA256} from '../src/navigation/identity';
import {createWorld,step,overlaps,replayBytes,type ContactMap} from '../src/physics-reference';
const folder=join(process.cwd(),'conformance/surface'),read=<T>(p:string):T=>JSON.parse(readFileSync(join(folder,p),'utf8'));
const cases=read<{license:string;cases:{id:string;map:string;profile:string}[]}>('cases.json');
const docs=(map='flat',profile='enemy'):[MapDocument,MovementDocument]=>[read(map+'.map.json'),read(profile+'.movement.json')];
const graphs=new Map<string,Graph>();
for(const c of cases.cases)test('owned deterministic graph and full-body replay: '+c.id,async()=>{
 const map=read<MapDocument>(c.map),p=read<MovementDocument>(c.profile),before=replayBytes([map,p]);
 const g=await buildSurfaceGraph(map,p,1);graphs.set(c.id,g);expect(g.status).toBe('candidate');expect(g.canCertify).toBe(false);expect(replayBytes([map,p])).toBe(before);
 expect(replayBytes(g)+'\n').toBe(readFileSync(join(folder,c.id+'.graph.json'),'utf8'));
 const w=createWorld(map as unknown as ContactMap,p);
 for(const edge of g.edges){let s=edge.initial;expect(edge.costTicks).toBeGreaterThan(0);for(const frame of edge.frames){expect(step(w,s,edge.input)).toEqual(frame);expect(frame.status).toBe('ok');expect(overlaps(w,frame.state.x,frame.state.y)).toBe(false);s=frame.state as typeof s;}const target=g.nodes.find(n=>n.key===edge.to)!;const i=g.intervals.find(i=>i.key===target.intervalKey)!;expect(s.supportId).toBe(i.supportId);expect(s.x).toBeGreaterThanOrEqual(i.minX);expect(s.x).toBeLessThanOrEqual(i.maxX);}
},30_000);
test('independent numeric restrictions, exact slope stance, directional walking and no-jump climb permissions',()=>{
 const flat=graphs.get('flat-enemy')!;expect(flat.intervals[0]!.minX).toBe(12*256);expect(flat.intervals[0]!.maxX).toBe((256-12)*256);expect(flat.edges.filter(e=>e.kind==='walk')).toHaveLength(2);
 expect(graphs.get('hazard-ban')!.intervals).toHaveLength(0);expect(graphs.get('hazard-allow')!.intervals.length).toBeGreaterThan(0);
 expect(graphs.get('ladder-enemy')!.edges.some(e=>e.kind==='climb')).toBe(false);expect(graphs.get('ladder-climber')!.edges.filter(e=>e.kind==='climb')).toHaveLength(2);
 expect(graphs.get('direction-climber')!.edges.filter(e=>e.kind==='climb')).toHaveLength(1);
 expect(graphs.get('directed')!.edges.every(e=>e.input.moveX===1)).toBe(true);
 const slope=graphs.get('slope-enemy')!;expect(slope.intervals.some(i=>i.supportId==='fh.slope')).toBe(true);expect(slope.intervals.some(i=>i.minX<=60*256&&i.maxX>=60*256)).toBe(false);
 expect(graphs.get('narrow-enemy')!.intervals.every(i=>i.minX>i.maxX)).toBe(true);
});
test('cache keys bind all physical inputs, controller bytes, coefficient edits and settings; art stays warm',async()=>{
 const [m,p]=docs();const a=await identity(m,p,DEFAULT_SETTINGS);
 expect((await identity({...m,visuals:[],metadata:{...m.metadata,name:'Art rename'}},p,DEFAULT_SETTINGS)).cacheKey).toBe(a.cacheKey);
 for(const changed of [{...m,bodies:[]},{...m,materials:m.materials.map(v=>({...v,traction:17}))},{...m,traversals:read<MapDocument>('ladder.map.json').traversals}])expect((await identity(changed,p,DEFAULT_SETTINGS)).cacheKey).not.toBe(a.cacheKey);
 expect((await identity(m,{...p,ground:{...p.ground,acceleration:65}},DEFAULT_SETTINGS)).cacheKey).not.toBe(a.cacheKey);
 expect((await identity(m,p,{...DEFAULT_SETTINGS,maxTicks:1})).cacheKey).not.toBe(a.cacheKey);
 const h=createHash('sha256');for(const f of readdirSync('src/physics-reference').filter(f=>f.endsWith('.ts')).sort())h.update(f+'\0').update(readFileSync('src/physics-reference/'+f));expect(h.digest('hex')).toBe(CONTROLLER_SHA256);
});
test('budgets, cancellation, unsupported profiles and intents never publish partial graphs',async()=>{
 const [m,p]=docs();expect(await buildSurfaceGraph(m,p,1,{...DEFAULT_SETTINGS,maxSamples:1})).toMatchObject({status:'budget',intervals:[],edges:[]});
 let cancel=false;expect(await buildSurfaceGraph(m,p,1,DEFAULT_SETTINGS,()=>cancel,async()=>{cancel=true;})).toMatchObject({status:'cancelled',nodes:[],edges:[]});
 const advanced={...p,abilities:[{kind:'fly' as const,version:1 as const,speed:100,acceleration:10,turnAcceleration:10,hover:true}]};expect((await buildSurfaceGraph(m,advanced,1)).status).toBe('unsupported');
 const intent={...m,navigation:{...m.navigation,overrides:[{id:'nav.deny',regionId:'region.any',profileIds:[p.id],actions:['walk'],policy:'forbid' as const,penaltyTicks:0}]}};expect((await buildSurfaceGraph(intent,p,1)).status).toBe('unsupported');
 await expect(buildSurfaceGraph(m,p,-1)).rejects.toThrow();
});
test('revision, job, profile digest, cancellation, closure and art-only LRU guard publication',async()=>{
 const sent:Request[]=[],session=new GraphSession(r=>sent.push(r));const [m,p]=docs();
 await session.build(m,p,1);const first=sent.at(-1)! as Extract<Request,{kind:'build'}>;const old=graphs.get('flat-enemy')!;
 await session.build(m,{...p,ground:{...p.ground,walkSpeed:513}},2);expect(session.accept({kind:'result',job:first.job,revision:1,graph:old})).toBe(false);expect(session.graph).toBe(null);
 await session.build(m,p,3);const request=sent.at(-1)! as Extract<Request,{kind:'build'}>,g={...old,revision:3};
 expect(session.accept({kind:'result',job:request.job,revision:3,graph:{...g,identity:{...g.identity,cacheKey:'wrong'}}})).toBe(false);
 expect(session.accept({kind:'result',job:request.job,revision:3,graph:g})).toBe(true);
 expect(session.accept({kind:'result',job:request.job,revision:3,graph:g})).toBe(false);
 const count=sent.filter(r=>r.kind==='build').length;await session.build({...m,visuals:[]},p,4);expect(session.graph?.revision).toBe(4);expect(sent.filter(r=>r.kind==='build')).toHaveLength(count);
 session.invalidate();expect(session.graph).toBe(null);session.dispose();await expect(session.build(m,p,5)).rejects.toThrow('disposed');
});
test('real worker endpoint cancels an in-flight old build and posts only newest revision',async()=>{
 const replies:Reply[]=[],endpoint=createGraphWorker(r=>replies.push(r)),[map,profile]=docs();
 const first=endpoint({kind:'build',job:1,revision:1,map,profile,settings:DEFAULT_SETTINGS});
 await endpoint({kind:'cancel',job:1});
 const next=endpoint({kind:'build',job:2,revision:2,map,profile,settings:{maxSamples:1,maxTicks:1}});
 await Promise.all([first,next]);expect(replies).toHaveLength(1);expect(replies[0]).toMatchObject({kind:'result',job:2,revision:2,graph:{status:'budget'}});
});
test('owned package integrity and isolated final-byte independent consumer',()=>{
 const index=read<{files:{path:string;sha256:string}[]}>('index.json');expect(cases.license).toBe('CC0-1.0');expect(index.files.map(f=>f.path).sort()).toEqual(readdirSync(folder).filter(f=>f!=='index.json').sort());for(const f of index.files)expect(createHash('sha256').update(readFileSync(join(folder,f.path))).digest('hex')).toBe(f.sha256);
 const dir=realpathSync(mkdtempSync(join(realpathSync(tmpdir()),'maplab-surface-consumer-')));
 try{writeFileSync(join(dir,'package.json'),'{"type":"module"}');
  cpSync('tests/consumer/surface.mjs',join(dir,'consumer.mjs'));const output=JSON.parse(execFileSync(process.execPath,[join(dir,'consumer.mjs'),folder],{cwd:dir,encoding:'utf8',maxBuffer:10_000_000}));expect(output).toEqual({cases:cases.cases.length,verified:true});
 }finally{rmSync(dir,{recursive:true,force:true});}
},60_000);

test('nonadjacent welded restrictions cover every standing and replay footprint',()=>{
 const hazard=graphs.get('three-hazard')!,direction=graphs.get('three-direction')!;
 expect(hazard.intervals.find(i=>i.supportId==='fh.a')!.maxX).toBe(92*256);
 expect(hazard.intervals.every(i=>i.maxX<=92*256)).toBe(true);
 expect(direction.intervals.some(i=>i.supportId==='fh.a'&&i.direction==='bToA'&&i.maxX>92*256)).toBe(true);
 const crossing=direction.edges.filter(e=>{
  const from=direction.nodes.find(n=>n.key===e.from)!,to=direction.nodes.find(n=>n.key===e.to)!;
  return from.state.supportId==='fh.a'&&to.state.supportId==='fh.a'&&from.intervalKey!==to.intervalKey;
 });
 expect(crossing).toHaveLength(1);expect(crossing[0]!.input.moveX).toBe(-1);
 expect(crossing[0]!.initial.x).toBe(92*256+1);
 expect(crossing[0]!.frames.at(-1)!.state.x).toBeLessThanOrEqual(92*256);

 for(const [g,isHazard] of [[hazard,true],[direction,false]] as const)for(const e of g.edges){
  for(const s of [e.initial,...e.frames.map(f=>f.state)])if(isHazard||e.input.moveX===1)expect(s.x+12*256).toBeLessThanOrEqual(104*256);
 }
});
test.each([['flat','enemy','walk'],['ladder','climber','climb']] as const)('%s tick exhaustion is explicit, empty and never warmed in LRU',async(map,profile,kind)=>{
 const [m,original]=docs(map,profile),settings={...DEFAULT_SETTINGS,maxTicks:kind==='climb'?1000:1};
 const p={...original,abilities:original.abilities.map(a=>kind==='climb'&&a.kind==='climb'?{...a,speed:1}:a)};
 const g=await buildSurfaceGraph(m,p,1,settings);
 expect(g).toMatchObject({status:'budget',diagnostics:[kind+'-tick-budget'],intervals:[],nodes:[],edges:[]});
 const sent:Request[]=[],session=new GraphSession(r=>sent.push(r));await session.build(m,p,1,settings);
 const request=sent.at(-1)! as Extract<Request,{kind:'build'}>;
 expect(session.accept({kind:'result',job:request.job,revision:1,graph:g})).toBe(true);
 await session.build(m,p,2,settings);expect(session.graph).toBe(null);expect(sent.filter(r=>r.kind==='build')).toHaveLength(2);
 session.dispose();
},30_000);
