import { expect, test } from 'vitest';
import { readFileSync, readdirSync, cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { JsonValue, CollisionBody } from '../src/contracts';
import { validateSourceGraph } from '../src/contracts';
import { candidate, editProblems, recordOf } from '../src/editor/editing';
import { assignSolidEdge, connectFootholds, disconnectFootholds, editShape, foothold, joinFootholds, moveEndpoint, physicalHandles, splitFoothold } from '../src/editor/geometry';
import { commit, openDocument, undo, redo } from '../src/editor/history';
import { denormalize, encode, normalize } from '../src/domain/model';
import { setOp, transaction } from '../src/domain/commands';
import { records, buildScene } from '../src/render/scene';
import { forestModel, root } from './history-support';
import { SelectionSession } from '../src/editor/selection';
import { ViewportSession } from '../src/editor/viewport';
import { worldToCss } from '../src/render/transform';
import { PickIndex } from '../src/render/picking';
// @ts-expect-error Independent fixture materializer is JavaScript.
import { materialize } from './consumer/mutate.mjs';
const m=forestModel(), fixture=JSON.parse(readFileSync(join(root,'conformance/physical-edits/cases.json'),'utf8'));
const key=(id:string)=>({collection:'footholds' as const,id});
const at=(model:typeof m,id:string)=>recordOf(model,{collection:'entities',id})!.anchor;
const full=(model:typeof m)=>{
  const dirs=['maps','movement','catalogs','tilesets','prefabs'];
  const inputs=dirs.flatMap(dir=>readdirSync(join(root,'placeholder-library',dir)).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(join(root,'placeholder-library',dir,f),'utf8'))));
  const result=validateSourceGraph(inputs.map(d=>d.id===model.id?denormalize(model):d));
  expect(result.diagnostics.filter(d=>d.severity==='error')).toEqual([]);
};
test('owned physical edit fixture hash and full source baseline',()=>{
  const index=JSON.parse(readFileSync(join(root,'conformance/physical-edits/index.json'),'utf8'));
  expect(createHash('sha256').update(readFileSync(join(root,'conformance/physical-edits/cases.json'))).digest('hex')).toBe(index.files[0].sha256);full(m);
});
for(const c of fixture.splits) test(`split ${c.id} remaps exact geometry, reciprocity, anchors and one-step undo`,()=>{
  const tx=splitFoothold(m,c.id,c.x),next=candidate(m,tx),l=foothold(next,c.id),r=foothold(next,c.right);
  expect(l.a).toEqual(c.a);expect(l.b).toEqual(c.seam);expect(r.a).toEqual(c.seam);expect(r.b).toEqual(c.b);
  expect(l.connections.b).toEqual([{footholdId:r.id,endpoint:'a'}]);expect(r.connections.a).toEqual([{footholdId:l.id,endpoint:'b'}]);
  expect(editProblems(next)).toEqual([]);full(next);
  const result=commit(openDocument(m),tx);expect(result.state.past).toHaveLength(1);expect(encode(undo(result.state).model)).toBe(encode(m));expect(encode(redo(undo(result.state)).model)).toBe(encode(next));
  const joined=candidate(next,joinFootholds(next,c.right,c.id));expect(foothold(joined,c.right).a).toEqual(c.a);expect(foothold(joined,c.right).b).toEqual(c.b);expect(joined.owners.has(c.id)).toBe(false);full(joined);
  expect(encode(undo(commit(openDocument(next),joinFootholds(next,c.right,c.id)).state).model)).toBe(encode(next));
});
test('surface anchors across nested AI, routes/access, and typed refs retain geometric x on both sides',()=>{
  const next=candidate(m,splitFoothold(m,'fh.west',240));
  expect(at(next,'start.player')).toEqual({kind:'surface',footholdId:'fh.west',u:0.25,normalOffset:0});
  expect(recordOf(next,{collection:'waypoints',id:'waypoint.west.b'})!.anchor).toEqual({kind:'surface',footholdId:'fh.west-2',u:0.75,normalOffset:0});
  const elevated=candidate(m,splitFoothold(m,'fh.elevated',304));expect((recordOf(elevated,{collection:'traversals',id:'traversal.ladder'})!.access as any)[0].anchor.u).toBe(1);
  const joined=candidate(next,joinFootholds(next,'fh.west-2','fh.west'));expect(at(joined,'start.player')).toEqual({kind:'surface',footholdId:'fh.west-2',u:0.125,normalOffset:0});
});
test('split shifts downstream solid edges and join restores them, preserving stable shape id',()=>{
  const next=candidate(m,splitFoothold(m,'fh.east',704));expect(foothold(next,'fh.slope').solidEdge!.edgeIndex).toBe(2);expect(foothold(next,'fh.boss').solidEdge!.edgeIndex).toBe(3);
  const joined=candidate(next,joinFootholds(next,'fh.east','fh.east-2'));expect(foothold(joined,'fh.slope').solidEdge!.edgeIndex).toBe(1);expect(foothold(joined,'fh.boss').solidEdge!.edgeIndex).toBe(2);expect(encode(joined)).toBe(encode(m));
});
test('welded seam handle moves both supports and collider vertex; invalid geometry is refused',()=>{
  const next=candidate(m,moveEndpoint(m,'fh.slope','a',[800,624]));expect(foothold(next,'fh.east').b).toEqual([800,624]);expect(foothold(next,'fh.slope').a).toEqual([800,624]);full(next);
  expect(()=>moveEndpoint(m,'fh.slope','a',[1000,624])).toThrow();expect(()=>splitFoothold(m,'fh.slope',800.01)).toThrow();expect(()=>splitFoothold(m,'fh.west',480)).toThrow();
});
test('explicit connect/disconnect is reciprocal and idempotent, rejects incompatible links and join',()=>{
  const disconnected=candidate(m,disconnectFootholds(m,'fh.east','b'));expect(foothold(disconnected,'fh.slope').connections.a).toEqual([]);
  const connected=candidate(disconnected,connectFootholds(disconnected,'fh.east','b','fh.slope','a'));expect(encode(connected)).toBe(encode(m));expect(connectFootholds(m,'fh.east','b','fh.slope','a').ops).toHaveLength(0);
  expect(()=>connectFootholds(m,'fh.west','b','fh.east','a')).toThrow('Incompatible');expect(()=>connectFootholds(m,'fh.east','b','fh.upper','a')).toThrow('Incompatible');expect(()=>joinFootholds(m,'fh.east','fh.slope')).toThrow('collinear');
  const split=candidate(m,splitFoothold(m,'fh.upper',528));const mismatch=candidate(split,transaction('fixture',[setOp(split,'footholds','fh.upper-2','materialId','material.earth')]));expect(()=>joinFootholds(mismatch,'fh.upper','fh.upper-2')).toThrow('Incompatible');
});
test('owner assignment cannot silently commit a mismatched or overlapping solid; body shape edits sync support',()=>{
  expect(()=>assignSolidEdge(m,'fh.upper',{bodyId:'body.west',shapeId:'shape.west',edgeIndex:0})).toThrow();
  expect(()=>assignSolidEdge(m,'fh.upper',{bodyId:'body.west',shapeId:'shape.gate',edgeIndex:0})).toThrow('resolve');
  const b=records<CollisionBody>(m,'bodies').find(b=>b.id==='body.west')!;
  const next=candidate(m,editShape(m,b.id,{id:'shape.west',kind:'rect',rect:[0,640,496,160]}));expect(foothold(next,'fh.west').b).toEqual([496,640]);full(next);
  expect(foothold(candidate(m,assignSolidEdge(m,'fh.west',null)),'fh.west').mode).toBe('oneWay');
  expect(()=>assignSolidEdge(m,'fh.east',null)).toThrow('Solid and one-way');
});
test('all physical handle previews cancel without model/history mutation, stale release refuses, one drag one undo',()=>{
  let state=openDocument(m),count=0; const session=new SelectionSession(()=>state.model,tx=>{state=commit(state,tx).state;count++;return true;},()=>true);
  const vp=new ViewportSession();vp.resize([900,600],[0,0,1280,800]);vp.snap({...vp.getSnapshot().snap,free:true});session.select([key('fh.right')]);session.mode('Platforms');
  const h=physicalHandles(m,[key('fh.right')])[1]!,css=worldToCss(vp.getSnapshot().view,h.point),index=new PickIndex(m,buildScene(m));
  for(let i=0;i<5;i++){session.down(css,index,vp.getSnapshot(),false,false);session.move([css[0]+32,css[1]]);expect(session.getSnapshot().handlePreview).not.toBeNull();session.cancel();session.end();expect(state.model).toBe(m);expect(state.past).toHaveLength(0);}
  session.down(css,index,vp.getSnapshot(),false,false);session.move([css[0]+32,css[1]]);session.end();expect(count).toBe(1);expect(state.past).toHaveLength(1);
  expect(encode(undo(state).model)).toBe(encode(m));
  state=openDocument(m);session.down(css,index,vp.getSnapshot(),false,false);session.move([css[0]+32,css[1]]);
  state=commit(state,transaction('Outside edit',[setOp(state.model,'footholds','fh.right','name','Outside name')])).state;
  const changed=state;session.end();expect(state).toBe(changed);expect(count).toBe(1);expect(session.getSnapshot().handlePreview).toBeNull();
});
test('independent isolated consumer accepts final split/join bytes and rejects dangling support corruption',()=>{
  const scratch=realpathSync(mkdtempSync(join(tmpdir(),'maplab-physical-consumer-')));
  try {
    cpSync(join(root,'tests/consumer/reader'),join(scratch,'reader'),{recursive:true});cpSync(join(root,'schemas'),join(scratch,'schemas'),{recursive:true});
    const index=JSON.parse(readFileSync(join(root,'conformance/bundle/cases.json'),'utf8')),golden=join(root,index.golden.export.path);
    const next=candidate(m,splitFoothold(m,'fh.west',240)),doc=denormalize(next);
    const edits=['bodies','footholds','entities','waypoints','traversals','navigation'].map(k=>({file:'maps/forest.map.json',set:`/${k}`,value:doc[k]}));
    const run=(mutations:unknown[])=>{materialize(golden,join(scratch,'bundle'),{id:'ML-012-physical',edits:mutations},join(scratch,'schemas'));return spawnSync(process.execPath,[join(scratch,'reader/read-bundle.mjs'),'--schemas',join(scratch,'schemas'),join(scratch,'bundle')],{cwd:scratch,encoding:'utf8',env:{PATH:process.env.PATH??''}});};
    const good=run(edits);expect(good.stderr).toBe('');expect(good.status,good.stdout).toBe(0);
    const joined=denormalize(candidate(next,joinFootholds(next,'fh.west-2','fh.west')));expect(run(edits.map(e=>({...e,value:joined[e.set.slice(1)]}))).status).toBe(0);
    const bad=run([...edits,{file:'maps/forest.map.json',set:'/entities/0/anchor/footholdId',value:'fh.missing'}]);expect(bad.status).toBe(1);expect(JSON.parse(bad.stdout).diagnostics.some((d:any)=>d.code==='reference.dangling')).toBe(true);
  }finally{rmSync(scratch,{recursive:true,force:true});}
});

test('solid segment split/join preserves chosen shape identity and undoes losslessly',()=>{
  const b=records<CollisionBody>(m,'bodies').find(b=>b.id==='body.west')!;
  const base=candidate(m,editShape(m,b.id,{id:'shape.west',kind:'segment',a:[0,640],b:[480,640]}));full(base);
  const next=candidate(base,splitFoothold(base,'fh.west',240));expect(foothold(next,'fh.west-2').solidEdge!.shapeId).toBe('shape.west-2');full(next);
  const tx=joinFootholds(next,'fh.west-2','fh.west'),joined=candidate(next,tx);expect(foothold(joined,'fh.west-2').solidEdge!.shapeId).toBe('shape.west-2');expect(joined.owners.has('shape.west')).toBe(false);full(joined);
  expect(encode(undo(commit(openDocument(next),tx).state).model)).toBe(encode(next));
});

test('explicit snap connects quantized free supports and rejects dangling or edge-dependent source',()=>{
  let next=candidate(m,splitFoothold(m,'fh.right',816));
  next=candidate(next,disconnectFootholds(next,'fh.right','b'));next=candidate(next,moveEndpoint(next,'fh.right','b',[800,352]));
  next=candidate(next,connectFootholds(next,'fh.right','b','fh.right-2','a'));expect(foothold(next,'fh.right').b).toEqual([816,352]);full(next);
  const bad=candidate(m,transaction('broken support',[setOp(m,'footholds','fh.west','ownerBodyId','body.missing')]));expect(()=>splitFoothold(bad,'fh.west',240)).toThrow('body.missing');
  // A traversal permission names an entire source edge. Splitting that edge is ambiguous and must report it.
  const traversal={id:'traversal.edge',kind:'wall',edge:{bodyId:'body.west',shapeId:'shape.west',edgeIndex:0},points:[[0,640],[480,640]],approachRegionId:'region.patrol',requiredAbilities:[]};
  const doc=denormalize(m),source={...doc,traversals:[...(doc.traversals as JsonValue[]),traversal]};
  const normalized=normalize(source);if(!normalized.ok)throw new Error('fixture');expect(editProblems(normalized.model)).toEqual([]);
  expect(()=>splitFoothold(normalized.model,'fh.west',240)).toThrow('Repair edge-dependent traversal');
});
