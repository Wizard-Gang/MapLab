/** Deterministic augmented search with a binary heap. */
export interface Move<S> { readonly key:string; readonly to:S; readonly cost:number }
export interface SearchResult<S,M extends Move<S>> { readonly status:'candidate'|'no route'|'budget'|'cancelled'; readonly path:readonly M[]; readonly cost:number; readonly expanded:number }
class Heap<T> {
 private items:T[]=[];
 constructor(private readonly before:(a:T,b:T)=>boolean){}
 get size(){return this.items.length;}
 push(v:T){let n=this.items.length;this.items.push(v);while(n){const p=(n-1)>>1;if(!this.before(v,this.items[p]!))break;this.items[n]=this.items[p]!;n=p;}this.items[n]=v;}
 pop():T{const first=this.items[0]!,last=this.items.pop()!;if(this.items.length){let n=0;while(n*2+1<this.items.length){let c=n*2+1;if(c+1<this.items.length&&this.before(this.items[c+1]!,this.items[c]!))c++;if(!this.before(this.items[c]!,last))break;this.items[n]=this.items[c]!;n=c;}this.items[n]=last;}return first;}
}
/** Only internal callers may supply a proven admissible lower bound. Reopening is supported.
 * State keys must include every resource/depth constraint; this kernel makes no physics claim. */
export async function augmentedSearch<S,M extends Move<S>>(start:S,key:(s:S)=>string,goal:(s:S)=>boolean,neighbors:(s:S)=>Promise<readonly M[]>,lowerBound:(s:S)=>number,maxExpanded:number,cancelled:()=>boolean=()=>false):Promise<SearchResult<S,M>>{
 if(!Number.isSafeInteger(maxExpanded)||maxExpanded<0||maxExpanded>100000)throw Error('invalid search budget');
 type Entry={state:S;key:string;g:number;f:number;path:readonly M[];serial:number};let serial=0,expanded=0;
 const heap=new Heap<Entry>((a,b)=>a.f!==b.f?a.f<b.f:a.g!==b.g?a.g<b.g:a.key!==b.key?a.key<b.key:a.serial<b.serial),best=new Map<string,number>();
 const h=(s:S)=>{const n=lowerBound(s);if(!Number.isFinite(n)||n<0)throw Error('invalid heuristic');return n;};
 const initial=key(start);best.set(initial,0);heap.push({state:start,key:initial,g:0,f:h(start),path:[],serial:serial++});
 while(heap.size){
  if(cancelled())return {status:'cancelled',path:[],cost:0,expanded};
  const current=heap.pop();if(best.get(current.key)!==current.g)continue;
  if(goal(current.state))return {status:'candidate',path:current.path,cost:current.g,expanded};
  if(expanded>=maxExpanded)return {status:'budget',path:[],cost:0,expanded};expanded++;
  const moves=[...await neighbors(current.state)].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  for(const move of moves){
   if(!Number.isSafeInteger(move.cost)||move.cost<0)throw Error('negative or invalid edge cost');
   const g=current.g+move.cost;if(!Number.isSafeInteger(g))throw Error('cost overflow');const k=key(move.to);
   if(g>=(best.get(k)??Infinity))continue;
   if(!best.has(k)&&best.size>=maxExpanded*4+1)return {status:'budget',path:[],cost:0,expanded};
   best.set(k,g);heap.push({state:move.to,key:k,g,f:g+h(move.to),path:[...current.path,move],serial:serial++});
  }
 }
 return {status:'no route',path:[],cost:0,expanded};
}
export interface CostGraph {readonly nodes:readonly {readonly id:string;readonly x:number}[];readonly edges:readonly {readonly id:string;readonly from:string;readonly to:string;readonly ticks:number;readonly penalty:number}[]}
/** Owned finite-graph cost baseline. Any zero-cost displacement forces h=0 (e.g. portals).
 * Exhaustion proves only disconnection in this supplied graph, never physical unreachability. */
export async function searchCostGraph(graph:CostGraph,from:string,to:string,algorithm:'astar'|'dijkstra',maxExpanded=10000){
 if(algorithm!=='astar'&&algorithm!=='dijkstra')throw Error('invalid search algorithm');
 const nodes=new Map(graph.nodes.map(n=>[n.id,n.x]));if(nodes.size!==graph.nodes.length||graph.nodes.some(n=>!Number.isSafeInteger(n.x))||new Set(graph.edges.map(e=>e.id)).size!==graph.edges.length||!nodes.has(from)||!nodes.has(to))throw Error('invalid graph nodes');
 let numerator=0n,denominator=1n,zero=false;const outgoing=new Map<string,{key:string;to:string;cost:number}[]>();
 const absolute=(v:bigint)=>v<0n?-v:v;
 for(const e of graph.edges){if(!nodes.has(e.from)||!nodes.has(e.to)||![e.ticks,e.penalty].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('invalid graph edge');const cost=e.ticks+e.penalty;if(!Number.isSafeInteger(cost))throw Error('invalid graph cost');const dx=absolute(BigInt(nodes.get(e.to)!)-BigInt(nodes.get(e.from)!));if(cost===0&&dx)zero=true;else if(cost&&dx*denominator>numerator*BigInt(cost)){numerator=dx;denominator=BigInt(cost);}const list=outgoing.get(e.from)??[];list.push({key:e.id,to:e.to,cost});outgoing.set(e.from,list);}
 return augmentedSearch(from,s=>s,s=>s===to,async s=>outgoing.get(s)??[],s=>{if(algorithm!=='astar'||zero||numerator===0n)return 0;const value=absolute(BigInt(nodes.get(to)!)-BigInt(nodes.get(s)!))*denominator/numerator;return Number(value>BigInt(Number.MAX_SAFE_INTEGER)?BigInt(Number.MAX_SAFE_INTEGER):value);},maxExpanded);
}
