// Final-byte matrix proof: Node + independent reader only, no app, controller or RigLab solver.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {readBundle} from './reader/read-bundle.mjs';
const [root,schemas]=process.argv.slice(2),read=p=>JSON.parse(readFileSync(join(root,p),'utf8'));
const report=readBundle(root,schemas);assert.equal(report.ok,true,JSON.stringify(report.diagnostics));assert.equal(report.foreignBundles.length,1);
const outer=read('manifest.json'),entry=outer.documents.find(d=>d.id===outer.entryMapId),map=read(entry.path),binding=map.presentations[0],dep=map.dependencies.find(d=>d.id===binding.bundleDependencyId),prefix=dep.path.slice(0,-13),inner=read(dep.path);
assert.equal(binding.rootMotion,'visualOnly');assert.equal(binding.groundContact,'supportLine');assert.equal(binding.expectedExportVersion,1);
const rig=read(prefix+inner.rig.file),baked=read(prefix+inner.baked.find(b=>b.animation==='unarmed-idle').file),transform=baked.frames[15][baked.bones.indexOf(rig.root)],bone=rig.bones.find(b=>b.name===rig.root),art=binding.artSlots.find(a=>a.slot===bone.slot),asset=map.assets.find(a=>a.id===art.assetId);
assert.deepEqual(transform,[4,-26,0]);assert.equal(asset.mediaType,'image/svg+xml');assert.equal(rig.depthProfiles.sides.facingLeft.arms.far,rig.depthProfiles.sides.facingRight.arms.near);
const scale=binding.worldUnitsPerRigUnit.num/binding.worldUnitsPerRigUnit.den,[x,y,degrees]=transform,angle=degrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),u=asset.wuPerAssetUnit,[ax,ay]=binding.rigGroundAnchor,[px,py]=art.pivot;
const matrix=f=>[f*scale*c*u,scale*s*u,-f*scale*s*u,scale*c*u,100+f*scale*(x-ax-c*u*px+s*u*py),200+scale*(y-ay-s*u*px-c*u*py)].map(n=>n||0);
const right=matrix(1),left=matrix(-1);assert.deepEqual(right,[2,0,0,2,100,148]);assert.deepEqual(left,[-2,0,0,2,100,148]);
assert.equal(outer.files.some(f=>f.role==='foreign'&&!f.path.startsWith(prefix)),false);
console.log(JSON.stringify({verified:true,frame:15,right,left,physicsAuthority:false}));
