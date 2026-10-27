import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem, platform, release } from 'node:os';
import { execFileSync } from 'node:child_process';
const read=(file:string)=>JSON.parse(readFileSync(file,'utf8'));
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
  } finally {await context.close();}
});
