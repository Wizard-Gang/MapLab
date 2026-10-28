import {test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createNavigationWorker} from '../src/navigation/client';
import type {MapDocument} from '../src/contracts/document-types';
import type {MovementDocument} from '../src/contracts/movement-types';
const map=JSON.parse(readFileSync('conformance/surface/flat.map.json','utf8')) as MapDocument;
const profile=JSON.parse(readFileSync('conformance/surface/enemy.movement.json','utf8')) as MovementDocument;
class Port {
  messages:any[]=[];terminated=false;
  onmessage:((event:MessageEvent)=>void)|null=null;onerror:(()=>void)|null=null;
  postMessage(message:any){this.messages.push(message);}
  terminate(){this.terminated=true;}
  reply(data:unknown){this.onmessage?.({data} as MessageEvent);}
}
test('cancellation terminates identity preprocessing, settles the pending promise and refuses stale replies',async()=>{
  const ports:Port[]=[];const runtime=createNavigationWorker(()=>{const port=new Port();ports.push(port);return port as unknown as Worker;});
  const building=runtime.session.build(map,profile,1),old=ports[0]!;expect(old.messages[0].kind).toBe('identify');
  runtime.session.invalidate();expect(old.terminated).toBe(true);await building;expect(runtime.session.graph).toBeNull();
  old.reply({kind:'identified',job:1,identity:{cacheKey:'stale'}});expect(old.messages).toHaveLength(1);
  runtime.dispose();expect(runtime.session.cacheUsage.entries).toBe(0);
});
test('cancellation terminates graph preprocessing and the next build gets a new worker',async()=>{
  const ports:Port[]=[];const runtime=createNavigationWorker(()=>{const port=new Port();ports.push(port);return port as unknown as Worker;});
  const identity={cacheKey:'cache',profileSha256:'profile',worldSha256:'world',controllerSha256:'controller',settingsSha256:'settings'};
  const building=runtime.session.build(map,profile,1);ports[0]!.reply({kind:'identified',job:1,identity});await building;
  expect(ports[0]!.messages[1].kind).toBe('build');runtime.session.invalidate();expect(ports[0]!.terminated).toBe(true);
  const next=runtime.session.build(map,profile,2);expect(ports).toHaveLength(2);ports[1]!.reply({kind:'identified',job:2,identity});await next;
  ports[0]!.onerror?.();expect(ports[1]!.terminated).toBe(false);
  ports[0]!.reply({kind:'result',job:1,revision:1,graph:{canCertify:false,identity,revision:1}});expect(runtime.session.graph).toBeNull();
  runtime.dispose();expect(ports[1]!.terminated).toBe(true);
});
