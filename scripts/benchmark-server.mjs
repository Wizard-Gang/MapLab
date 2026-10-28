// Read-only fixture server and local measurement sink. No editor/library write endpoint.
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {platform,release,cpus,totalmem} from 'node:os';
import {editorFixture} from '../src/benchmarks/fixture.ts';
const port=Number(process.env.MAPLAB_BENCHMARK_PORT??4188),host=`127.0.0.1:${port}`;
const output=resolve(process.env.MAPLAB_BENCHMARK_OUTPUT??'/private/tmp/maplab-editor-measurements');mkdirSync(output,{recursive:true});
const read=file=>JSON.parse(readFileSync(file,'utf8')),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const map=editorFixture(read('conformance/surface/flat.map.json'),read('conformance/performance/cases.json').standard,read('conformance/surface/enemy.movement.json'));
const sources=[map,read('conformance/surface/enemy.movement.json'),read('placeholder-library/tilesets/forest.tileset.json')];
const files=sources.map(value=>({id:value.id,path:`${value.format==='maplab.map'?'maps':value.format==='maplab.movement'?'movement':'tilesets'}/${value.id}.json`,text:JSON.stringify(value)})).map(file=>({...file,digest:hash(file.text)}));
const identity={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),
  cpu:cpus()[0]?.model,ramBytes:totalmem(),os:`${platform()} ${release()}`,node:process.version,
  hardware:execFileSync('system_profiler',['SPHardwareDataType','-detailLevel','mini'],{encoding:'utf8'}).split('\n').filter(line=>/^\s*(Model Name|Model Identifier|Chip|Total Number of Cores|Memory):/.test(line)).join('\n'),
  build:hash(readFileSync('dist/.vite/manifest.json')),mode:'Vite production build',baselineDecision:'Owner accepted Apple M4/24 GB on 2026-10-27'};
const library={ok:true,label:'Owned performance fixture',readOnly:false,placeholder:false,projectId:'project.performance',name:'Performance',
  defaults:{tileSize:[32,32],snap:[32,32],movementId:sources[1].id},unindexed:[],diagnostics:[],
  documents:files.map((f,i)=>({id:f.id,path:f.path,kind:['map','movement','tileset'][i],indexed:f.digest,digest:f.digest,state:'ok',errors:0,warnings:0,restorable:false}))};
function processes(browser){
  return execFileSync('/bin/ps',['-axo','pid=,ppid=,rss=,command='],{encoding:'utf8'}).split('\n').flatMap(line=>{
    const m=line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);if(!m)return [];
    const command=m[4],chrome=command.includes('/Applications/Google Chrome.app/');
    const safari=command.includes('/Safari.app/Contents/MacOS/Safari')||command.includes('/com.apple.WebKit.');
    if(browser==='chromium'?!chrome:!safari)return [];
    return [{pid:Number(m[1]),ppid:Number(m[2]),rssBytes:Number(m[3])*1024,role:command.match(/--type=([^ ]+)/)?.[1]??(command.includes('WebKit.GPU')?'gpu':command.includes('WebContent')?'renderer':'browser/service')}];
  });
}
function footprint(browser,label){
  const list=processes(browser),path=resolve(output,`${browser}-${label}-footprint.json`);
  execFileSync('/usr/bin/footprint',[...list.flatMap(p=>['-p',String(p.pid)]),'-f','bytes','--noCategories','-j',path],{stdio:'ignore'});
  const data=read(path);if(data.errors?.length)throw Error(JSON.stringify(data.errors));
  return {at:new Date().toISOString(),processes:list,physical:data.processes.map(p=>({pid:p.pid,bytes:p.auxiliary.phys_footprint,peakBytes:p.auxiliary.phys_footprint_peak})),raw:path};
}
const baseline={chromium:footprint('chromium','baseline'),safari:footprint('safari','baseline')};
let samples=[],sampling=null,activeBrowser=null;
const respond=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
const server=createServer(async(req,res)=>{
  try {
    if(req.headers.host!==host)return respond(res,{error:'Wrong Host'},403);
    if(req.method==='POST'&&req.headers.origin!==`http://${host}`)return respond(res,{error:'Wrong Origin'},403);
    const url=new URL(req.url,`http://${host}`);
    if(req.method==='GET'&&url.pathname==='/measurement/identity')return respond(res,{...identity,baseline});
    if(req.method==='POST'){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>8*1024*1024)return respond(res,{error:'Oversize measurement'},413);}
      const input=JSON.parse(body||'{}');
      if(url.pathname==='/__maplab/library')return respond(res,library);
      if(url.pathname==='/__maplab/read')return respond(res,{ok:true,documents:files.filter(f=>input.ids.includes(f.id))});
      if(url.pathname==='/measurement/start'){
        if(sampling||!['chromium','safari'].includes(input.browser))return respond(res,{error:'Measurement already active or invalid browser'},409);
        activeBrowser=input.browser;samples=[];sampling=setInterval(()=>{samples.push({at:Date.now(),processes:processes(activeBrowser)});},250);
        return respond(res,{ok:true,start:footprint(activeBrowser,'loaded')});
      }
      if(url.pathname==='/measurement/report'){
        if(!sampling)return respond(res,{error:'No active measurement'},409);
        clearInterval(sampling);sampling=null;
        const memory={baseline:baseline[activeBrowser],loaded:footprint(activeBrowser,'retained'),rssSamples:samples};
        const report={identity,...input,memory};writeFileSync(resolve(output,`${activeBrowser}-editor.json`),JSON.stringify(report,null,2)+'\n');
        return respond(res,{ok:true});
      }
      if(url.pathname==='/measurement/abort'){
        if(sampling)clearInterval(sampling);sampling=null;
        writeFileSync(resolve(output,'aborted.json'),JSON.stringify(input,null,2));return respond(res,{ok:true});
      }
      if(url.pathname==='/measurement/snapshot'&&sampling){
        const snapshot=footprint(activeBrowser,String(input.label).replace(/[^a-z-]/g,''));
        writeFileSync(resolve(output,`${activeBrowser}-${input.label.replace(/[^a-z-]/g,'')}.json`),JSON.stringify({identity,...input,snapshot},null,2));return respond(res,snapshot);
      }
      return respond(res,{ok:false,code:'measurement.readonly',message:'Measurement fixture server has no write operation'},403);
    }
    const path=resolve('dist','.'+decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':''));
    if(!path.startsWith(resolve('dist')+'/')||!statSync(path).isFile())return respond(res,{error:'Missing production asset'},404);
    res.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[extname(path)]??'application/octet-stream','cache-control':'no-store'});res.end(readFileSync(path));
  }catch(error){respond(res,{error:String(error)},500);}
});
server.listen(port,'127.0.0.1',()=>console.log(`Production measurements: http://${host}/benchmarks/editor.html; raw output ${output}`));
process.on('SIGINT',()=>{if(sampling)clearInterval(sampling);server.close();});
