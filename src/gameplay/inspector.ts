// Closed-schema inspector vocabulary and pure atomic transaction builder.
import mapSchema from '../../schemas/maplab.map.v1.schema.json' with {type:'json'};
import {evaluate,compileSchema,type JsonValue} from '../contracts';
import {setOp,transaction,insertOp} from '../domain/commands';
import type {MapModel,JsonObject} from '../domain/model';
export const GAMEPLAY_COLLECTIONS=['entities','regions','waypoints','routes','triggers','encounters','flags'] as const;
export type GameplayCollection=typeof GAMEPLAY_COLLECTIONS[number];
export interface FormSchema {readonly $ref?:string;readonly type?:string;readonly const?:JsonValue;readonly enum?:readonly JsonValue[];readonly oneOf?:readonly FormSchema[];readonly properties?:Readonly<Record<string,FormSchema>>;readonly required?:readonly string[];readonly items?:FormSchema|boolean;readonly prefixItems?:readonly FormSchema[];readonly minItems?:number;readonly maxItems?:number;readonly minimum?:number;readonly maximum?:number;readonly multipleOf?:number;readonly maxLength?:number}
export const defs=mapSchema.$defs as unknown as Readonly<Record<string,FormSchema>>;
const names:Record<GameplayCollection,string>={entities:'entity',regions:'region',waypoints:'waypoint',routes:'route',triggers:'trigger',encounters:'encounter',flags:'flag'};
export const formSchema=(collection:GameplayCollection)=>defs[names[collection]]!;
export function resolve(s:FormSchema):FormSchema{return s.$ref?resolve(defs[s.$ref.slice(8)]!):s;}
export function choice(s:FormSchema,v:JsonValue):number{
 return Math.max(0,(s.oneOf??[]).findIndex(raw=>{const n=resolve(raw);if(n.type==='null')return v===null;if(v===null)return false;if(n.properties&&typeof v==='object'&&!Array.isArray(v)){const kind=n.properties.kind;if(kind){const k=(v as JsonObject).kind;return kind.const!==undefined?kind.const===k:(k!==undefined&&kind.enum?.includes(k))??false;}return true;}return n.type===typeof v;}));
}
export function seed(raw:FormSchema,depth=0):JsonValue{
 if(depth>12)throw Error('Inspector nesting budget');const s=resolve(raw);
 if(s.const!==undefined)return s.const;if(s.enum)return s.enum[0]!;if(s.oneOf)return seed(s.oneOf[0]!,depth+1);
 if(s.type==='null')return null;if(s.type==='boolean')return false;if(s.type==='integer'||s.type==='number')return Math.max(0,s.minimum??0);
 if(s.type==='array')return Array.from({length:s.minItems??s.prefixItems?.length??0},(_,i)=>seed(s.prefixItems?.[i]??(typeof s.items==='object'?s.items:{}),depth+1));
 if(s.type==='object')return Object.fromEntries(Object.entries(s.properties??{}).map(([k,v])=>[k,seed(v,depth+1)]));return '';
}
export function gameplayEdit(model:MapModel,collection:GameplayCollection,draft:JsonObject,creating=false){
 const compiled=compileSchema({$schema:mapSchema.$schema,$defs:mapSchema.$defs,$ref:'#/$defs/'+names[collection]} as unknown as JsonValue,names[collection]);
 const errors=evaluate(compiled,draft);if(errors.length)throw Error(errors.map(e=>e.jsonPath+': '+e.message).join('; '));
 if(creating)return transaction('Create gameplay '+String(draft.id),[insertOp(model,collection,[draft])]);
 const old=model.collections.get(collection)?.byId.get(String(draft.id));if(!old)throw Error('Gameplay identity changed or missing');
 return transaction('Edit gameplay '+String(draft.id),[...new Set([...Object.keys(old),...Object.keys(draft)])].filter(k=>k!=='id').map(k=>setOp(model,collection,String(draft.id),k,draft[k])));
}
