// ML-015: real image decoders/pixels, safe asset boundary, grouping, background math and final saved bytes.
import { expect,test,type Page } from '@playwright/test';
import { readFileSync,mkdirSync,writeFileSync,cpSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectImage } from '../../src/assets/inspect';
import { createHash } from 'node:crypto';
import { libraryForm } from '../../src/library/library-form';
import { command,libraryFile,openEditor,openMap,resetLibrary,repoRoot,saveElsewhere,scratch } from './support';
const host=(p:Page)=>p.getByRole('group',{name:'World canvas',exact:true});
const notice=(p:Page)=>p.getByLabel('Edit notice',{exact:true});
const property=(p:Page,n:string)=>p.getByRole('spinbutton',{name:`Property ${n}`,exact:true});
async function choose(p:Page,id:string){await p.getByRole('searchbox',{name:'Hierarchy search'}).fill(id);await p.getByRole('button',{name:`Select ${id}`,exact:true}).click();}
async function number(p:Page,n:string,value:number){const f=property(p,n);await f.fill(String(value));await f.press('Enter');await expect(f).toHaveValue(String(value));}
async function ready(p:Page){await openEditor(p);await openMap(p,'map.forest');await p.getByLabel('Pick mode',{exact:true}).selectOption('Objects');}
async function layer(p:Page,kind:string){await p.getByLabel('New layer kind',{exact:true}).selectOption(kind);await p.getByRole('button',{name:'Add layer',exact:true}).click();}
async function upload(p:Page,name:string){
  const raw=readFileSync(join(repoRoot,'conformance/visuals',name)),type=name.endsWith('.svg')?'image/svg+xml':name.endsWith('.webp')?'image/webp':'image/png';
  const id='asset.'+createHash('sha256').update(inspectImage(raw,type).bytes).digest('hex');
  await p.getByLabel('Import visual asset',{exact:true}).setInputFiles(join(repoRoot,'conformance/visuals',name));
  await expect(notice(p)).toContainText('Approved project-owned asset imported');await expect(p.getByLabel('Sprite asset',{exact:true})).toHaveValue(id);return id;
}
async function pixel(p:Page,x:number,y:number){return host(p).evaluate((el,[x,y])=>{const d=(el as HTMLElement).dataset,c=el.querySelector('canvas')!,z=Number(d.zoom),px=(x-Number(d.cameraX))*z*c.width/Number(d.width),py=(y-Number(d.cameraY))*z*c.height/Number(d.height);return [...c.getContext('2d')!.getImageData(Math.floor(px),Math.floor(py),1,1).data];},[x,y] as const);}
// R1 fixture files predate library normalization; compare physical content in its specified domain order.
const normalized=(v:any)=>JSON.parse(libraryForm(v));
const waitFrames=(p:Page)=>p.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
test.beforeEach(()=>resetLibrary());

test('layer/group/foreground authoring and valid parent transforms save, undo and refuse cycles without physical edits',async({page})=>{
  const before=normalized(JSON.parse(libraryFile('maps/forest.map.json').toString()));await ready(page);
  await layer(page,'group');await number(page,'opacity',0.5);await layer(page,'sprite');await page.getByLabel('Layer parent',{exact:true}).selectOption('layer.group');
  await page.getByRole('button',{name:'Add visual',exact:true}).click();await number(page,'transform.position.0',128);await number(page,'transform.position.1',128);await number(page,'transform.rotation',90);await number(page,'transform.scale.0',2);await number(page,'transform.scale.1',2);
  await page.getByRole('button',{name:'Add visual',exact:true}).click();await number(page,'transform.position.0',16);await number(page,'transform.position.1',8);await page.getByLabel('Visual parent',{exact:true}).selectOption('visual.scenery');
  await choose(page,'visual.scenery');await page.getByLabel('Visual parent',{exact:true}).selectOption('visual.scenery-2');await expect(notice(page)).toContainText('Edit refused');await expect(page.getByLabel('Visual parent',{exact:true})).toHaveValue('');
  await choose(page,'layer.sprite');await expect(page.getByRole('group',{name:'Layer inspector'})).toContainText('after an actors plane');await page.getByLabel('Authored visible',{exact:true}).uncheck();await command(page,'Undo').click();await expect(page.getByLabel('Authored visible',{exact:true})).toBeChecked();
  await command(page,'Save').click();await expect(page.getByRole('status')).toContainText('Saved');const after=JSON.parse(libraryFile('maps/forest.map.json').toString());for(const key of ['terrain','bodies','footholds','traversals','entities','navigation'])expect(after[key]).toEqual(before[key]);expect(after.layers.find((l:any)=>l.id==='layer.group')).not.toHaveProperty('transform');expect(after.visuals.find((v:any)=>v.id==='visual.scenery-2').parentId).toBe('visual.scenery');
  await page.reload();await openMap(page,'map.forest');await choose(page,'visual.scenery-2');await expect(property(page,'transform.position.0')).toHaveValue('16');await expect(command(page,'Undo')).toBeDisabled();
});

test('owned PNG/WebP/SVG decode to real pixels, preserve pivots and source bytes through save/reopen; final-byte proof',async({page},info)=>{
  await ready(page);await layer(page,'sprite');const original=normalized(JSON.parse(libraryFile('maps/forest.map.json').toString()));const ids:string[]=[];
  for(const [i,name] of ['owned.png','owned.webp','owned.svg'].entries()){
    const aid=await upload(page,name);ids.push(aid);await choose(page,aid);await number(page,'wuPerAssetUnit',name.endsWith('svg')?4:8);
    await page.getByRole('button',{name:'Add visual',exact:true}).click();await number(page,'transform.position.0',128+128*i);await number(page,'transform.position.1',128);
  }
  await expect.poll(()=>pixel(page,144,160)).toEqual([240,80,40,255]);await expect.poll(()=>pixel(page,272,160)).toEqual([42,185,108,255]);const svg=await pixel(page,416,160);expect(svg[3]).toBe(255);expect(svg[0]).toBeGreaterThan(30);expect(svg[2]).toBeGreaterThan(30);
  const decoded=Number(await page.getByLabel('Art canvas',{exact:true}).getAttribute('data-decoded-bytes'));expect(decoded).toBeGreaterThan(0);expect(decoded).toBeLessThanOrEqual(256*1024*1024);
  // Save a fully valid local parent/pivot fixture as part of the independent final-byte proof.
  await choose(page,'visual.scenery');await number(page,'source.pivot.0',2);await number(page,'source.pivot.1',4);
  await page.getByLabel('Visual source',{exact:true}).selectOption('rect');await page.getByLabel('Shape fill',{exact:true}).fill('#00000000');await page.getByRole('button',{name:'Add visual',exact:true}).click();await number(page,'transform.position.0',640);await number(page,'transform.position.1',128);await number(page,'transform.rotation',90);await number(page,'transform.scale.0',2);await number(page,'transform.scale.1',2);
  await choose(page,'visual.scenery');await page.getByLabel('Visual parent',{exact:true}).selectOption('visual.scenery-4');await number(page,'transform.position.0',16);await number(page,'transform.position.1',8);
  await command(page,'Save').click();await expect(page.getByRole('status')).toContainText('Saved');const raw=libraryFile('maps/forest.map.json'),saved=JSON.parse(raw.toString());for(const k of ['terrain','bodies','footholds','traversals','navigation'])expect(saved[k]).toEqual(original[k]);
  const svgAsset=saved.assets.find((a:any)=>a.id===ids[2]);expect(libraryFile(svgAsset.path).toString()).toContain('<linearGradient');expect(libraryFile(svgAsset.path).toString()).not.toMatch(/<script|<image|onload=/);expect(await page.locator('svg path, svg rect, svg script').count()).toBe(0);
  await page.reload();await openMap(page,'map.forest');await expect.poll(()=>pixel(page,272,160)).toEqual([42,185,108,255]);await expect(command(page,'Undo')).toBeDisabled();
  const out=process.env.MAPLAB_VISUAL_PROOF;if(out){const dir=join(out,info.project.name);const expectedHead=process.env.MAPLAB_PROOF_HEAD;if(expectedHead){expect(execFileSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8'}).trim()).toBe(expectedHead);expect(execFileSync('git',['status','--porcelain'],{cwd:repoRoot,encoding:'utf8'}).trim()).toBe('');}mkdirSync(join(dir,'maps'),{recursive:true});writeFileSync(join(dir,'maps/forest.map.json'),raw);for(const a of saved.assets)if(ids.includes(a.id)){mkdirSync(join(dir,'assets',a.path.split('/')[1]),{recursive:true});cpSync(join(scratch(),a.path),join(dir,a.path));}if(expectedHead)writeFileSync(join(dir,'head.txt'),expectedHead+'\n');writeFileSync(join(dir,'expectations.json'),JSON.stringify({assetIds:ids,parent:'visual.scenery-4',child:'visual.scenery',childFirstPoint:[688,128],mapId:'map.forest'},null,2)+'\n');}
});

test('malicious, cyclic, oversized and malformed images refuse before source mutation, SVG DOM or remote request',async({page})=>{
  const requests:string[]=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:5191/')&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))requests.push(r.url());});await ready(page);await expect(command(page,'Undo')).toBeDisabled();const before=libraryFile('maps/forest.map.json');
  for(const name of ['malicious.svg','complex.svg','massive.png']){await page.getByLabel('Import visual asset',{exact:true}).setInputFiles(join(repoRoot,'conformance/visuals',name));await expect(notice(page)).toContainText('refused');await expect(command(page,'Undo')).toBeDisabled();}
  const corrupt=readFileSync(join(repoRoot,'conformance/visuals/owned.webp')).subarray(0,22);await page.getByLabel('Import visual asset',{exact:true}).setInputFiles({name:'bad.webp',mimeType:'image/webp',buffer:corrupt});await expect(notice(page)).toContainText('refused');await expect(command(page,'Undo')).toBeDisabled();expect(libraryFile('maps/forest.map.json')).toEqual(before);expect(requests).toEqual([]);await expect(page.locator('svg,script[src^="http"]')).toHaveCount(0);
});

test('negative repeated backgrounds, camera space, phase and scroll tick scrub affect art only and remain culled',async({page})=>{
  const source=JSON.parse(libraryFile('maps/forest.map.json').toString());source.visuals=source.visuals.filter((v:any)=>!['layer.sky','layer.far','layer.near'].includes(v.layerId));source.layers.find((l:any)=>l.id==='layer.sky').visible=false;
  const bg=source.layers.find((l:any)=>l.id==='layer.far');Object.assign(bg,{parallax:[0.5,0.25],origin:[100,-20],repeat:'xy',repeatSize:[64,64],phase:[-3,-4],scrollWUPerTick:[1,0.5],space:'world'});source.visuals.push({id:'visual.repeat',name:'Repeat',layerId:bg.id,parentId:null,order:0,bodyId:null,transform:{position:[0,0],rotation:0,scale:[1,1],mirrorX:false,mirrorY:false},source:{kind:'shape',shape:{kind:'rect',rect:[0,0,16,16]},fill:'#f08028'}});saveElsewhere('maps/forest.map.json',JSON.stringify(source,null,2)+'\n');await ready(page);
  const hash=()=>page.getByLabel('Art canvas',{exact:true}).evaluate(e=>{const c=e as HTMLCanvasElement,d=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let h=0;for(const b of d)h=(Math.imul(h,31)+b)|0;return h;});await waitFrames(page);const first=await hash();await page.getByLabel('Art preview tick',{exact:true}).fill('17');await waitFrames(page);expect(await hash()).not.toBe(first);await expect(command(page,'Undo')).toBeDisabled();
  await choose(page,'layer.far');await page.getByLabel('Background space',{exact:true}).selectOption('camera');await expect(notice(page)).toHaveText('Set visual property');await command(page,'Save').click();await expect(page.getByRole('status')).toContainText('Saved');const saved=JSON.parse(libraryFile('maps/forest.map.json').toString());expect(saved.layers.find((l:any)=>l.id==='layer.far').phase).toEqual([-3,-4]);expect(saved.layers.find((l:any)=>l.id==='layer.far').scrollWUPerTick).toEqual([1,0.5]);expect(saved.bodies).toEqual(normalized(source).bodies);
});

test('ordered frame assets scrub exact boundaries without history; offscreen assets decode only when brought into view',async({page})=>{
  await ready(page);await layer(page,'sprite');const a=await upload(page,'owned.png'),b=await upload(page,'owned.webp');
  for(const id of [a,b]){await choose(page,id);await number(page,'wuPerAssetUnit',8);}
  await page.getByLabel('Visual source',{exact:true}).selectOption('frames');
  for(const id of [a,b]){await page.getByLabel('New frame asset',{exact:true}).selectOption(id);await page.getByRole('button',{name:'Append frame',exact:true}).click();}
  await page.getByRole('button',{name:'Add visual',exact:true}).click();await number(page,'transform.position.0',128);await number(page,'transform.position.1',128);
  await expect.poll(()=>pixel(page,144,160)).toEqual([240,80,40,255]);await command(page,'Save').click();await expect(page.getByRole('status')).toContainText('Saved');const saved=libraryFile('maps/forest.map.json');
  await page.reload();await openMap(page,'map.forest');
  await page.getByLabel('Art preview tick',{exact:true}).fill('6');await expect.poll(()=>pixel(page,144,160)).toEqual([42,185,108,255]);await expect(command(page,'Undo')).toBeDisabled(); // The freshly reopened map stays clean while scrubbing.
  expect(libraryFile('maps/forest.map.json')).toEqual(saved);
  await page.getByLabel('Art preview tick',{exact:true}).fill('0');await choose(page,'visual.scenery');await number(page,'transform.position.0',100000);await command(page,'Save').click();await expect(page.getByRole('status')).toContainText('Saved');
  const reads:string[]=[];page.on('request',r=>{if(r.url().endsWith('/__maplab/asset-read'))reads.push(r.postDataJSON().path);});
  await page.reload();await openMap(page,'map.forest');await waitFrames(page);expect(reads).toEqual([]);await expect(command(page,'Undo')).toBeDisabled();await choose(page,'visual.scenery');await page.getByRole('button',{name:'Zoom to selection',exact:true}).click();await expect.poll(()=>reads.length).toBeGreaterThan(0);
});

test('closing a document aborts a pending bounded image read and discards its decode queue',async({page})=>{
  await ready(page);await layer(page,'sprite');await upload(page,'owned.png');let release=():void=>{};const gate=new Promise<void>(r=>{release=r;});
  await page.route('**/__maplab/asset-read',async route=>{await gate;try{await route.continue();}catch{/* Disposal aborts this exact request. */}});
  const request=page.waitForRequest(r=>r.url().endsWith('/__maplab/asset-read'));
  await page.getByRole('button',{name:'Add visual',exact:true}).click();const pending=await request;const failed=page.waitForEvent('requestfailed',r=>r===pending);
  await command(page,'Close').click();await expect(host(page)).toHaveCount(0);await failed;expect(pending.failure()).not.toBeNull();release();await page.unroute('**/__maplab/asset-read');
});

test('asset-backed tile pixels decode while explicit tile, terrain intent and physics retain their contracts',async({page})=>{
  await ready(page);const assetId=await upload(page,'owned.png');await command(page,'Save').click();await expect(page.getByRole('status')).toContainText('Saved');
  const source=JSON.parse(libraryFile('maps/forest.map.json').toString()),tileset=JSON.parse(libraryFile('tilesets/forest.tileset.json').toString());
  const asset={...source.assets.find((a:any)=>a.id===assetId),wuPerAssetUnit:4};tileset.assets.push(asset);tileset.tiles[0].visual={kind:'asset',assetId,pivot:[0,0]};
  const cells=Array.from({length:1024},()=>null) as any[];cells[3*32+3]={tileId:tileset.tiles[0].id,quarterTurns:0,mirrorX:false,mirrorY:false};source.terrain[0].chunks=[{column:0,row:0,cells}];source.terrain[0].terrainIntent=[];
  saveElsewhere('maps/forest.map.json',libraryForm(source));saveElsewhere('tilesets/forest.tileset.json',libraryForm(tileset));
  await page.reload();await openMap(page,'map.forest');await expect.poll(()=>pixel(page,100,112)).toEqual([240,80,40,255]);await expect(command(page,'Undo')).toBeDisabled();
  const after=JSON.parse(libraryFile('maps/forest.map.json').toString());expect(after.terrain).toEqual(source.terrain);expect(after.bodies).toEqual(source.bodies);expect(after.footholds).toEqual(source.footholds);
});
