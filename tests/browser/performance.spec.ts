import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem, platform, release } from 'node:os';
import { execFileSync } from 'node:child_process';
const read=(file:string)=>JSON.parse(readFileSync(file,'utf8'));
test('large hierarchy keeps collapsed DOM empty and every paged/search ID accessible',async({page})=>{
  await page.goto('/benchmarks/');
  await page.evaluate(async input=>{
    const fixture='/src/benchmarks/fixture.ts',harness='/tests/browser/hierarchy-harness.tsx';
    const {materialize}=await import(fixture),{mountHierarchy}=await import(harness);mountHierarchy(materialize(input.base,input.recipe));
  },{base:read('conformance/surface/flat.map.json'),recipe:read('conformance/performance/cases.json').standard});
  const search=page.getByRole('searchbox',{name:'Hierarchy search'}),rows=page.locator('ul[data-collection="visuals"] button');
  await expect(search).toBeVisible();await expect(rows).toHaveCount(0);
  await page.getByText('visuals (5000)',{exact:true}).click();await expect(rows).toHaveCount(200);
  const seen:string[]=[];
  for(let pageNumber=0;pageNumber<25;pageNumber++){
    seen.push(...await rows.evaluateAll(buttons=>buttons.map(b=>b.getAttribute('aria-label')!.slice('Select '.length))));
    const next=page.getByRole('button',{name:'Next visuals page',exact:true});
    if(pageNumber<24)await next.click();else await expect(next).toBeDisabled();
  }
  expect(seen).toHaveLength(5000);expect(new Set(seen).size).toBe(5000);expect([...seen].sort()).toEqual(Array.from({length:5000},(_,i)=>`visual.${i}`).sort());
  await search.fill('visual.4999');await expect(rows).toHaveCount(1);
  const tail=page.getByRole('button',{name:'Select visual.4999',exact:true});await tail.click();await expect(tail).toHaveAttribute('aria-pressed','true');
  await search.fill('absent.object');await expect(rows).toHaveCount(0);
  await search.fill('');await expect(rows).toHaveCount(0);
});
test('owned large-world workloads publish five warm raw samples and explicit H5 scope splits',async({page,browser,baseURL},info)=>{
  test.setTimeout(300000);await page.setViewportSize({width:1440,height:900});
  // DPR must be set by the browser context, not approximated by canvas scaling.
  const context=await browser.newContext({baseURL:baseURL!,viewport:{width:1440,height:900},deviceScaleFactor:2});const surface=await context.newPage();
  try {
    await surface.goto('/benchmarks/');
    const report=await surface.evaluate(async input=>{
      const module='/src/benchmarks/run.ts';const {runBenchmarks}=await import(module);
      return runBenchmarks(input.base,input.profile,input.tileset,input.recipes);
    },{base:read('conformance/surface/flat.map.json'),profile:read('conformance/surface/enemy.movement.json'),tileset:read('placeholder-library/tilesets/forest.tileset.json'),recipes:read('conformance/performance/cases.json')});
    const identity={head:process.env.MAPLAB_EXPECTED_HEAD??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
      browser:browser.version(),project:info.project.name,os:`${platform()} ${release()}`,cpu:cpus()[0]?.model,logicalCPUs:cpus().length,ramBytes:totalmem(),node:process.version,
      build:'Vite development modules; source head pinned above',hardwareAcceleration:'unverified; CI headless',timestamp:new Date().toISOString()};
    const path=info.outputPath('performance.json');writeFileSync(path,JSON.stringify({identity,...report},null,2)+'\n');
    await info.attach('performance',{path,contentType:'application/json'});
    console.log('PERFORMANCE_REPORT '+JSON.stringify({identity,input:report.input,history:report.history,select:report.select,search:report.search,query:report.query,camera:{p50:report.camera.p50,p95:report.camera.p95},memory:report.memory,nav:report.nav,scopeSplits:report.scopeSplits}));
    expect(report.dpr).toBe(2);expect(report.viewport).toEqual([1440,900]);expect(report.history.raw).toHaveLength(5);
    expect(report.memory.historyBytes).toBeLessThanOrEqual(report.memory.historyBudget);
    expect(report.counts).toMatchObject({cells:100000,layers:20,objects:5000,bodies:5000,footholds:10000});
    expect(report.scopeSplits.length).toBeGreaterThan(0);
    for(const phase of ['identity','graph']){const result=report.nav[`cancel-${phase}`] as {raw:number[];statuses:string[]};expect(result.statuses).toEqual(Array(5).fill('cancelled; worker terminated'));expect(result.raw.every(ms=>ms<=100)).toBe(true);}
    for(const key of ['baseline','multilevel'])expect((report.nav[key] as {statuses:string[]}).statuses.every(s=>['candidate','budget'].includes(s))).toBe(true);
  } finally {await context.close();}
});
