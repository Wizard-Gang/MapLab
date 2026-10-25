import {test,expect} from 'vitest';
import {readFileSync,mkdtempSync,realpathSync,writeFileSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import type {MapDocument} from '../src/contracts/document-types';
import type {MovementDocument} from '../src/contracts/movement-types';
import {blockers,overlayMap,regenerate,WitnessIndex,regionKeys,type BlockerReport} from '../src/navigation/blockers';
import {createBlockerEndpoint,BlockerSession,type BlockerRequest,type BlockerReply} from '../src/navigation/blocker-protocol';
import {buildAirborneActions,type Witness} from '../src/navigation/airborne';
import {createHash} from 'node:crypto';
const root='conformance/blockers',read=<T>(p:string):T=>JSON.parse(readFileSync(join(root,p),'utf8'));
const map=()=>read<MapDocument>('source.map.json'),profile=()=>read<MovementDocument>('player.movement.json'),cases=read<any>('cases.json'),yieldNow=async()=>{};
let baseline:BlockerReport,blocked:BlockerReport,restored:BlockerReport;
test('empty-space insertion disables witnesses, deletion regenerates the expanded candidate envelope and equals clean output',async()=>{
 const m=map(),p=profile(),before=JSON.stringify([m,p]);baseline=await regenerate(m,p,1,[],cases.settings,null,undefined,yieldNow);
 expect(baseline.result.status).toBe('candidate');const witness=read<Witness>('empty-corridor.witness.json');expect(baseline.result.edges.some(e=>e.key===witness.key)).toBe(true);
 expect(new WitnessIndex(baseline.result.edges).query(cases.blocker.boundsSu)).toContain(witness.key);
 blocked=await regenerate(m,p,2,[cases.blocker],cases.settings,baseline,undefined,yieldNow);
 expect(blocked.disabledKeys).toContain(witness.key);expect(blocked.result.edges).toEqual([]);expect(blocked.result.status).toBe('no route found within declared search/sampling budget');
 const cleanBlocked=await buildAirborneActions(overlayMap(m,p,[cases.blocker]),p,2,cases.settings,undefined,yieldNow);expect(blocked.result.edges).toEqual(cleanBlocked.edges);expect(blocked.result.intervals).toEqual(cleanBlocked.intervals);
 restored=await regenerate(m,p,3,[],cases.settings,blocked,undefined,yieldNow);expect(restored.result.edges).toEqual(baseline.result.edges);expect(restored.result.identity).toEqual(baseline.result.identity);expect(restored.regenerationBoundsSu).not.toBeNull();expect(restored.result.edges.some(e=>e.key===witness.key)).toBe(true);
 expect(JSON.stringify([m,p])).toBe(before);expect(m.bodies.some(b=>b.id.startsWith('runtime.'))).toBe(false);
 const scratch=realpathSync(mkdtempSync(join(realpathSync(tmpdir()),'maplab-blocker-consumer-')));
 try{cpSync(root,join(scratch,'fixtures'),{recursive:true});cpSync('tests/consumer/blockers.mjs',join(scratch,'consumer.mjs'));writeFileSync(join(scratch,'reports.json'),JSON.stringify({baseline,blocked,restored}));const output=JSON.parse(execFileSync(process.execPath,[join(scratch,'consumer.mjs'),join(scratch,'fixtures'),join(scratch,'reports.json')],{cwd:scratch,encoding:'utf8'}));expect(output).toMatchObject({verified:true,emptySpaceInvalidation:true,deletionReopens:true});
 const corrupt={baseline,restored,blocked:{...blocked,result:{...blocked.result,edges:[baseline.result.edges[0]!]}}};writeFileSync(join(scratch,'reports.json'),JSON.stringify(corrupt));expect(()=>execFileSync(process.execPath,[join(scratch,'consumer.mjs'),join(scratch,'fixtures'),join(scratch,'reports.json')],{cwd:scratch,stdio:'pipe'})).toThrow();
 }finally{rmSync(scratch,{recursive:true,force:true});}
},120000);
test('art-only changes stay warm, far edits retain exact edges and physical region revisions stay local',async()=>{
 const m=map(),p=profile(),warm=await regenerate(read<MapDocument>('art-only.map.json'),p,4,[],cases.settings,restored,undefined,yieldNow);
 expect(warm.cacheWarm).toBe(true);expect(warm.regeneratedSamples).toBe(0);expect(warm.result.edges).toEqual(restored.result.edges);
 const far=await regenerate(m,p,5,[cases.farBlocker],cases.settings,warm,undefined,yieldNow);expect(far.disabledKeys).toEqual([]);expect(far.reusedEdges).toBe(baseline.result.edges.length);expect(far.regeneratedSamples).toBe(0);
 const clean=await buildAirborneActions(overlayMap(m,p,[cases.farBlocker]),p,5,cases.settings,undefined,yieldNow);expect(far.result.edges).toEqual(clean.edges);expect(far.result.intervals).toEqual(clean.intervals);expect(Object.keys(far.regionRevisions).filter(k=>far.regionRevisions[k]===5)).toEqual(regionKeys(cases.farBlocker.boundsSu));
 const moved={...m,footholds:m.footholds.map(f=>f.id==='fh.east'?{...f,enabled:false}:f)};const incremental=await regenerate(moved,p,6,[],cases.settings,restored,undefined,yieldNow),rebuilt=await buildAirborneActions(moved,p,6,cases.settings,undefined,yieldNow);expect(incremental.result.edges).toEqual(rebuilt.edges);expect(incremental.result.intervals).toEqual(rebuilt.intervals);expect(incremental.affectedGeometry).toContain('foothold:fh.east');
 const changed=await regenerate(m,{...p,air:{...p.air,gravity:97}},7,[],cases.settings,restored,undefined,yieldNow);expect(changed.cacheWarm).toBe(false);expect(changed.reusedEdges).toBe(0);
},120000);
test('runtime input bounds, aliases and source collisions refuse without changing author data',()=>{
 const m=map(),p=profile();for(const bad of [[cases.blocker,cases.blocker],[{...cases.blocker,id:'body.west'}],[{...cases.blocker,boundsSu:[0,0,0,1]}],[{...cases.blocker,boundsSu:[0,0,NaN,1]}],[{...cases.blocker,boundsSu:[0,0,1e12,1]}],Array(129).fill(cases.blocker)])expect(()=>blockers(bad)).toThrow();
 expect(()=>overlayMap({...m,bodies:[...m.bodies,{...m.bodies[0]!,id:cases.blocker.id}]},p,[cases.blocker])).toThrow('collides');expect(regionKeys([-1e9,-1e9,1e9,1e9])).toEqual(['*']);
});
test('revisioned cancellation is synchronous, stale/forged replies refuse, and bounded exhaustion never publishes edges',async()=>{
 const sent:BlockerRequest[]=[],s=new BlockerSession(r=>sent.push(r)),m=map(),p=profile();s.update(m,p,1,[],cases.settings);const first=sent[0]!;expect(first.kind).toBe('regenerate');expect(s.accept({kind:'result',job:first.job,report:{...baseline,revision:1,result:{...baseline.result,revision:1}}})).toBe(true);
 s.update(m,p,2,[cases.blocker],cases.settings);expect(s.getSnapshot().report).toBeNull();expect(s.getSnapshot().disabledKeys.length).toBeGreaterThan(0);expect(s.accept({kind:'result',job:first.job,report:baseline})).toBe(false);
 const latest=sent.at(-1)!;expect(s.accept({kind:'result',job:latest.job,report:{...blocked,revision:999}})).toBe(false);s.invalidate();expect(sent.at(-1)!.kind).toBe('cancel');expect(s.accept({kind:'result',job:latest.job,report:blocked})).toBe(false);s.dispose();expect(()=>s.update(m,p,3,[])).toThrow('Disposed');
 let yields=0;const cancelled=await regenerate(m,p,8,[],cases.settings,null,()=>yields>0,async()=>{yields++;}).catch(()=>null);expect(cancelled===null||cancelled.result.status==='cancelled').toBe(true);expect(yields).toBeLessThanOrEqual(1);
 const replies:BlockerReply[]=[],endpoint=createBlockerEndpoint(r=>replies.push(r));const pending=endpoint({kind:'regenerate',job:1,revision:9,map:m,profile:p,blockers:[],settings:cases.settings});await endpoint({kind:'cancel',job:1});await pending;expect(replies).toEqual([]);
 const exhausted=await regenerate(m,p,10,[],{...cases.settings,maxClearanceSamples:1},null,undefined,yieldNow);expect(exhausted.result.status).toBe('budget');expect(exhausted.result.edges).toEqual([]);
 for(const f of read<any>('index.json').files)expect(createHash('sha256').update(readFileSync(join(root,f.path))).digest('hex')).toBe(f.sha256);
},120000);
