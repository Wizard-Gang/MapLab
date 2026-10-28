import type { Graph } from './surface';
/** Explicit retained serialized-byte charge, not a claim about whole-browser heap usage. */
export const NAVIGATION_CACHE_BYTES=64*1024*1024;
export class GraphCache {
  private entries=new Map<string,{graph:Graph;bytes:number;profile:string}>();
  private used=0;
  constructor(readonly budget=NAVIGATION_CACHE_BYTES,readonly perProfile=4){
    if(!Number.isSafeInteger(budget)||budget<0||!Number.isSafeInteger(perProfile)||perProfile<1)throw Error('Invalid graph cache budget');
  }
  get bytes(){return this.used;}
  get size(){return this.entries.size;}
  get(key:string):Graph|undefined {
    const entry=this.entries.get(key);if(!entry)return;
    this.entries.delete(key);this.entries.set(key,entry);return structuredClone(entry.graph);
  }
  put(graph:Graph):boolean {
    if(graph.status!=='candidate')return false;
    const key=graph.identity.cacheKey,profile=graph.identity.profileSha256;
    const bytes=new TextEncoder().encode(JSON.stringify(graph)).byteLength;
    this.remove(key);if(bytes>this.budget||this.budget===0)return false;
    const same=[...this.entries].filter(([,e])=>e.profile===profile);
    while(same.length>=this.perProfile)this.remove(same.shift()![0]);
    while(this.used+bytes>this.budget)this.remove(this.entries.keys().next().value!);
    this.entries.set(key,{graph:structuredClone(graph),bytes,profile});this.used+=bytes;return true;
  }
  private remove(key:string):void {const entry=this.entries.get(key);if(entry){this.used-=entry.bytes;this.entries.delete(key);}}
  clear():void {this.entries.clear();this.used=0;}
}
