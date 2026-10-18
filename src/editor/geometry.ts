// ML-012: physical authority edits. Build once on release, validate and commit atomically.
import { shapeEdges, type BodyShape, type CollisionBody, type EdgeRef, type Foothold, type JsonValue, type Vec2 } from '../contracts';
import { deleteOp, fieldOp, insertOp, setOp, transaction } from '../domain/commands';
import { isObject, same, type JsonObject, type MapModel } from '../domain/model';
import { allocateId, rewriteRefs } from '../domain/remap';
import type { Operation, Transaction } from '../domain/transaction';
import { candidate, editProblems, moveSelection, type ObjectKey } from './editing';
import { records, shapePoints } from '../render/scene';
import { quantize, roundAway } from '../render/transform';

export type Endpoint = 'a' | 'b';
const json = (v: unknown): JsonValue => v as JsonValue;
const point = (p: Vec2): Vec2 => [quantize(p[0]), quantize(p[1])];
const eq = (a: Vec2, b: Vec2): boolean => a[0] === b[0] && a[1] === b[1];
const cross = (a: Vec2, b: Vec2, c: Vec2): number => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
export const foothold = (m: MapModel, id: string): Foothold => {
  const f = m.collections.get('footholds')?.byId.get(id); if (!f) throw new Error(`Missing foothold ${id}`); return f as unknown as Foothold;
};
const body = (m: MapModel, id: string): CollisionBody => {
  const b = m.collections.get('bodies')?.byId.get(id); if (!b) throw new Error(`Missing body ${id}`); return b as unknown as CollisionBody;
};
const checked = (m: MapModel, label: string, ops: readonly (Operation | null)[]): Transaction => {
  const tx = transaction(label, ops), problems = editProblems(candidate(m, tx));
  if (problems.length) throw new Error(`Geometry edit refused: ${problems.join('; ')}`); return tx;
};
/** Rewrites records and document-level anchors/edge refs; stores only changed members in history. */
function rewrite(m: MapModel, change: (v: JsonObject) => JsonObject, overrides = new Map<string, JsonObject>(), removed = new Set<string>()): Operation[] {
  const walk = (v: JsonValue): JsonValue => {
    if (Array.isArray(v)) { const a = v.map(walk); return a.some((x,i)=>x!==v[i]) ? a : v; }
    if (!isObject(v) || typeof v.mapId === 'string' && v.mapId !== m.id) return v;
    const next = change(v); let out = next;
    for (const [k,x] of Object.entries(next)) { const y = walk(x); if (y!==x) out = { ...out, [k]:y }; }
    return out;
  };
  const ops: Operation[] = [];
  for (const [collection,c] of m.collections) {
    if (collection === 'dependencies') continue;
    for (const id of c.order) {
      if (removed.has(id)) continue;
      const before = c.byId.get(id)!, after = walk(overrides.get(id) ?? before) as JsonObject;
      for (const k of new Set([...Object.keys(before),...Object.keys(after)])) { const op = setOp(m,collection,id,k,after[k]); if (op) ops.push(op); }
    }
  }
  for (const [k,v] of m.fields) { const after=walk(v); if (after!==v) { const op=fieldOp(m,k,after); if(op) ops.push(op); } }
  for (const id of m.terrain?.order ?? []) {
    const before=m.terrain!.byLayer.get(id)!.settings, after=walk(before) as JsonObject;
    for(const [member,value] of Object.entries(after)) if(!same(before[member],value)) ops.push({op:'set',collection:'terrain',id,member,before:before[member],after:value});
  }
  return ops;
}
function compatible(a: Foothold,b: Foothold, identical=false): void {
  const keys = identical ? ['ownerBodyId','mode','materialId','direction','category','mask','enabled','planeId','normal','dropAllowed','dropGroupId'] as const : ['ownerBodyId','mode','category','mask','enabled','planeId','dropAllowed','dropGroupId'] as const;
  if (keys.some(k=>!same(json(a[k]),json(b[k])))) throw new Error('Incompatible footholds: owner, solid/one-way, plane or physical properties differ');
}
const links = (f: Foothold, endpoint: Endpoint, id: string, end: Endpoint): Foothold['connections'] => ({...f.connections,[endpoint]:[...f.connections[endpoint].filter(l=>l.footholdId!==id||l.endpoint!==end),{footholdId:id,endpoint:end}]});
export function connectFootholds(m: MapModel, id: string, end: Endpoint, target: string, other: Endpoint): Transaction {
  if(id===target) throw new Error('Connect distinct footholds');
  const a=foothold(m,id),b=foothold(m,target); compatible(a,b);
  // Snap is explicit and belongs to this same history entry. Linked seams move together.
  const moved = candidate(m, moveEndpoint(m,id,end,b[other]));
  const f=foothold(moved,id),g=foothold(moved,target);
  const overrides=new Map<string,JsonObject>([[id,json({...f,connections:links(f,end,target,other)}) as JsonObject],[target,json({...g,connections:links(g,other,id,end)}) as JsonObject]]);
  // Compose pre-images against the original model, avoiding two writes to the same member.
  for(const [c,collection] of moved.collections) for(const k of collection.order) if(!overrides.has(k)&&collection.byId.get(k)!==m.collections.get(c)?.byId.get(k)) overrides.set(k,collection.byId.get(k)!);
  return checked(m,'Snap and connect footholds',rewrite(m,v=>v,overrides));
}
export function disconnectFootholds(m:MapModel,id:string,end:Endpoint):Transaction {
  const f=foothold(m,id), overrides=new Map<string,JsonObject>();
  for(const l of f.connections[end]) { const g=foothold(m,l.footholdId); const prior=(overrides.get(g.id) as unknown as Foothold)??g; overrides.set(g.id,json({...prior,connections:{...prior.connections,[l.endpoint]:prior.connections[l.endpoint].filter(x=>x.footholdId!==id||x.endpoint!==end)}}) as JsonObject); }
  overrides.set(id,json({...f,connections:{...f.connections,[end]:[]}}) as JsonObject);
  return checked(m,'Disconnect foothold endpoint',rewrite(m,v=>v,overrides));
}
/** Synchronize every support sharing an edited collider, preserving shape IDs and edge numbers. */
function shapeOverrides(m:MapModel, changes:ReadonlyMap<string,CollisionBody>): Map<string,JsonObject> {
  const overrides=new Map<string,JsonObject>();
  for(const [id,b] of changes) overrides.set(id,json(b) as JsonObject);
  for(const f of records<Foothold>(m,'footholds')) if(f.solidEdge && changes.has(f.solidEdge.bodyId)) {
    const b=changes.get(f.solidEdge.bodyId)!,s=b.shapes.find(x=>x.id===f.solidEdge!.shapeId),edge=s&&shapeEdges(s)[f.solidEdge.edgeIndex];
    if(!edge) throw new Error(`Repair missing solid edge ${f.id}`);
    const [a,z]=edge[0][0]<edge[1][0]?edge:[edge[1],edge[0]];
    overrides.set(f.id,json({...f,a,b:z}) as JsonObject);
  }
  return overrides;
}
export function moveEndpoint(m:MapModel,id:string,end:Endpoint,position:Vec2):Transaction {
  const p=point(position), seen=new Set<string>(), pending:[string,Endpoint][]=[[id,end]], overrides=new Map<string,JsonObject>(), changes=new Map<string,CollisionBody>();
  while(pending.length) {
    const [fid,e]=pending.pop()!,tag=`${fid}/${e}`; if(seen.has(tag)) continue; seen.add(tag);
    const original=foothold(m,fid), f=(overrides.get(fid) as unknown as Foothold)??original;
    overrides.set(fid,json({...f,[e]:p}) as JsonObject);
    for(const link of original.connections[e]) pending.push([link.footholdId,link.endpoint]);
    if(f.solidEdge) {
      const b=changes.get(f.solidEdge.bodyId)??body(m,f.solidEdge.bodyId),shape=b.shapes.find(s=>s.id===f.solidEdge!.shapeId)!;
      const old=original[e];
      const replace=(v:Vec2):Vec2=>eq(v,old)?p:v;
      const next:BodyShape=shape.kind==='segment'?{...shape,a:replace(shape.a),b:replace(shape.b)}:{id:shape.id,kind:'polygon',points:shapePoints(shape).map(replace)};
      changes.set(b.id,{...b,shapes:b.shapes.map(s=>s.id===shape.id?next:s)});
    }
  }
  for(const [id,r] of shapeOverrides(m,changes)) overrides.set(id,r);
  return checked(m,'Move physical handle',rewrite(m,v=>v,overrides));
}
export function editShape(m:MapModel,bodyId:string,shape:BodyShape):Transaction {
  const b=body(m,bodyId); if(!b.shapes.some(s=>s.id===shape.id)) throw new Error('Missing stable collider shape');
  return checked(m,'Edit collider shape',rewrite(m,v=>v,shapeOverrides(m,new Map([[bodyId,{...b,shapes:b.shapes.map(s=>s.id===shape.id?shape:s)}]]))));
}
export function assignSolidEdge(m:MapModel,id:string,edge:EdgeRef|null):Transaction {
  const f=foothold(m,id); let next:Foothold;
  if(edge) {
    const b=body(m,edge.bodyId),shape=b.shapes.find(s=>s.id===edge.shapeId),ps=shape&&shapeEdges(shape)[edge.edgeIndex];
    if(!ps) throw new Error('Solid edge does not resolve');
    const [a,z]=ps[0][0]<ps[1][0]?ps:[ps[1],ps[0]];
    next={...f,mode:'solid',ownerBodyId:b.id,a,b:z,solidEdge:edge,dropAllowed:false,dropGroupId:null,category:b.category,mask:b.mask,enabled:b.enabled};
  } else next={...f,mode:'oneWay',solidEdge:null};
  return checked(m,'Assign solid-edge ownership',rewrite(m,v=>v,new Map([[id,json(next) as JsonObject]])));
}
const uAt=(x:number,a:Vec2,b:Vec2):number=>roundAway((x-a[0])/(b[0]-a[0])*65536)/65536;
export function splitFoothold(m:MapModel,id:string,x:number):Transaction {
  const f=foothold(m,id), sx=quantize(x), p:Vec2=[sx,quantize(f.a[1]+(sx-f.a[0])/(f.b[0]-f.a[0])*(f.b[1]-f.a[1]))];
  if(!(sx>f.a[0]&&sx<f.b[0])||cross(f.a,f.b,p)!==0) throw new Error('Split needs an exact on-quantum interior point');
  const newId=allocateId(id,k=>m.owners.has(k)||m.groups.has(k));
  let left:Foothold={...f,b:p,connections:{a:f.connections.a,b:[{footholdId:newId,endpoint:'a'}]}},right:Foothold={...f,id:newId,a:p,connections:{a:[{footholdId:id,endpoint:'b'}],b:f.connections.b}};
  const overrides=new Map<string,JsonObject>(); let edgeChange:((v:JsonObject)=>JsonObject)|null=null;
  if(f.solidEdge) {
    const e=f.solidEdge,b=body(m,e.bodyId),s=b.shapes.find(s=>s.id===e.shapeId)!;
    if(s.kind==='segment') {
      const sid=allocateId(s.id,k=>m.owners.has(k)||m.groups.has(k)||k===newId);
      overrides.set(b.id,json({...b,shapes:b.shapes.flatMap(t=>t.id===s.id?[{...s,a:f.a,b:p},{...s,id:sid,a:p,b:f.b}]:[t])}) as JsonObject);
      left={...left,solidEdge:{...e,edgeIndex:0}};right={...right,solidEdge:{...e,shapeId:sid,edgeIndex:0}};
      edgeChange=v=>{if(v.bodyId===e.bodyId&&v.shapeId===e.shapeId&&typeof v.edgeIndex==='number')throw new Error('Repair edge-dependent traversal before splitting its edge');return v;};
    } else {
      const ps=[...shapePoints(s)]; ps.splice(e.edgeIndex+1,0,p);
      overrides.set(b.id,json({...b,shapes:b.shapes.map(t=>t.id===s.id?{id:s.id,kind:'polygon',points:ps}:t)}) as JsonObject);
      left={...left,solidEdge:{...e,edgeIndex:e.edgeIndex}};right={...right,solidEdge:{...e,edgeIndex:e.edgeIndex+1}};
      edgeChange=v=>{
        if(v.bodyId===e.bodyId&&v.shapeId===e.shapeId&&typeof v.edgeIndex==='number') {
          if(v.edgeIndex===e.edgeIndex) throw new Error('Repair edge-dependent traversal before splitting its edge');
          if(v.edgeIndex>e.edgeIndex) return {...v,edgeIndex:v.edgeIndex+1};
        } return v;
      };
    }
  }
  // Existing original edge refs on the split foothold are supplied after the generic rewrite.
  const transform=(v:JsonObject):JsonObject=>{
    if(v.kind==='surface'&&v.footholdId===id&&typeof v.u==='number') {const px=f.a[0]+v.u*(f.b[0]-f.a[0]), target=px<=sx?left:right;return {...v,footholdId:target.id,u:uAt(px,target.a,target.b)};}
    if(v.footholdId===id&&v.endpoint==='b') return {...v,footholdId:newId,endpoint:'b'};
    return edgeChange?edgeChange(v):v;
  };
  // Remove original solidEdge from generic traversal to distinguish it from external edge consumers.
  const original=json({...f,solidEdge:null}) as JsonObject;overrides.set(id,original);
  const ops=rewrite(m,transform,overrides).filter(op=>!(op.op==='set'&&op.collection==='footholds'&&op.id===id));
  for(const [member,v] of Object.entries(left)) {const op=setOp(m,'footholds',id,member,v as JsonValue);if(op)ops.push(op);}
  ops.push(insertOp(m,'footholds',[json(right) as JsonObject])!);
  return checked(m,'Split foothold',ops);
}
export function joinFootholds(m:MapModel,keep:string,remove:string):Transaction {
  const retained=foothold(m,keep),discarded=foothold(m,remove);if(keep===remove)throw new Error('Join distinct footholds');compatible(retained,discarded,true);
  const [l,r]=retained.a[0]<discarded.a[0]?[retained,discarded]:[discarded,retained];
  if(!eq(l.b,r.a)||cross(l.a,l.b,r.b)!==0)throw new Error('Join needs adjacent collinear footholds');
  if(l.connections.b.some(x=>x.footholdId!==r.id||x.endpoint!=='a')||r.connections.a.some(x=>x.footholdId!==l.id||x.endpoint!=='b'))throw new Error('Repair branched seam before joining');
  let merged:Foothold={...retained,a:l.a,b:r.b,connections:{a:l.connections.a,b:r.connections.b}};
  const idRemaps=new Map([[remove,keep]]);
  const overrides=new Map<string,JsonObject>();let remapEdge=(v:JsonObject):JsonObject=>v;
  if(l.solidEdge&&r.solidEdge) {
    const a=l.solidEdge,b=r.solidEdge;
    if(a.bodyId!==b.bodyId)throw new Error('Solid join requires the same body');
    const owner=body(m,a.bodyId),shape=owner.shapes.find(s=>s.id===a.shapeId)!,second=owner.shapes.find(s=>s.id===b.shapeId)!;
    if(shape.kind==='segment'&&second.kind==='segment'&&shape.id!==second.id) {
      const chosen=retained.solidEdge!.shapeId,deleted=discarded.solidEdge!.shapeId;
      idRemaps.set(deleted,chosen);
      overrides.set(owner.id,json({...owner,shapes:owner.shapes.filter(s=>s.id!==deleted).map(s=>s.id===chosen?{id:chosen,kind:'segment',a:l.a,b:r.b}:s)}) as JsonObject);
      merged={...merged,solidEdge:{...a,shapeId:chosen,edgeIndex:0}};
      remapEdge=v=>v.bodyId===a.bodyId&&v.shapeId===deleted?{...v,shapeId:chosen}:v;
    } else {
      if(a.shapeId!==b.shapeId||b.edgeIndex!==a.edgeIndex+1||shape.kind!=='polygon')throw new Error('Solid join requires consecutive edges of the same shape');
      const ps=[...shape.points];ps.splice(b.edgeIndex,1);
      overrides.set(owner.id,json({...owner,shapes:owner.shapes.map(s=>s.id===shape.id?{...shape,points:ps}:s)}) as JsonObject);
      merged={...merged,solidEdge:a};
      remapEdge=v=>v.bodyId===a.bodyId&&v.shapeId===a.shapeId&&typeof v.edgeIndex==='number'?{...v,edgeIndex:v.edgeIndex===b.edgeIndex?a.edgeIndex:v.edgeIndex>b.edgeIndex?v.edgeIndex-1:v.edgeIndex}:v;
    }
  }
  const transform=(v:JsonObject):JsonObject=>{
    if(v.kind==='surface'&&(v.footholdId===l.id||v.footholdId===r.id)&&typeof v.u==='number'){const f=v.footholdId===l.id?l:r;return {...v,footholdId:keep,u:uAt(f.a[0]+v.u*(f.b[0]-f.a[0]),l.a,r.b)};}
    if((v.footholdId===l.id&&v.endpoint==='a')||(v.footholdId===r.id&&v.endpoint==='b'))return {...v,footholdId:keep};
    return remapEdge(v);
  };
  overrides.set(keep,json({...merged,solidEdge:null}) as JsonObject);
  const ops=rewrite(m,transform,overrides,new Set([remove])).filter(op=>!(op.op==='set'&&op.collection==='footholds'&&op.id===keep));
  const renamed=rewriteRefs(json(merged),m.id,id=>id===remove?keep:undefined) as JsonObject;
  for(const [member,v] of Object.entries(renamed)){const op=setOp(m,'footholds',keep,member,v);if(op)ops.push(op);}
  // Typed references without a position retain the chosen identity as well.
  const intermediate=candidate(m,transaction('Join preview',[...ops,deleteOp(m,'footholds',[remove])!]));
  const refs=rewrite(intermediate,v=>rewriteRefs(v,m.id,id=>idRemaps.get(id)) as JsonObject);
  return checked(m,'Join footholds',[...ops,deleteOp(m,'footholds',[remove]),...refs]);
}
export interface PhysicalHandle { readonly key:ObjectKey; readonly kind:'endpoint'|'body'|'vertex'; readonly point:Vec2; readonly end?:Endpoint; readonly shapeId?:string; readonly vertex?:number; readonly label:string }
export function physicalHandles(m:MapModel,keys:readonly ObjectKey[]):PhysicalHandle[] {
  const out:PhysicalHandle[]=[];
  for(const key of keys) {
    if(key.collection==='footholds') {const f=foothold(m,key.id),offset=f.ownerBodyId?body(m,f.ownerBodyId).position:[0,0];for(const end of ['a','b'] as const)out.push({key,kind:'endpoint',end,point:[f[end][0]+offset[0]!,f[end][1]+offset[1]!],label:`${f.id} endpoint ${end}`});}
    if(key.collection==='bodies'){const b=body(m,key.id);out.push({key,kind:'body',point:b.position,label:`${b.id} body position`});for(const s of b.shapes)shapePoints(s).forEach((p,vertex)=>out.push({key,kind:'vertex',shapeId:s.id,vertex,point:[p[0]+b.position[0],p[1]+b.position[1]],label:`${s.id} vertex ${vertex}`}));}
  }return out;
}
export function moveHandle(m:MapModel,h:PhysicalHandle,p:Vec2):Transaction {
  if(h.kind==='body')return moveSelection(m,[h.key],[quantize(p[0]-h.point[0]),quantize(p[1]-h.point[1])]);
  const f=h.kind==='endpoint'?foothold(m,h.key.id):null,b=f?.ownerBodyId?body(m,f.ownerBodyId):h.kind==='vertex'?body(m,h.key.id):null;
  const local=point([p[0]-(b?.position[0]??0),p[1]-(b?.position[1]??0)]);
  if(f)return moveEndpoint(m,f.id,h.end!,local);
  const s=b!.shapes.find(s=>s.id===h.shapeId)!;
  const ps=shapePoints(s).map((v,i)=>i===h.vertex?local:v);
  const shape:BodyShape=s.kind==='segment'?{...s,a:ps[0]!,b:ps[1]!}:{id:s.id,kind:'polygon',points:ps};
  return editShape(m,b!.id,shape);
}
