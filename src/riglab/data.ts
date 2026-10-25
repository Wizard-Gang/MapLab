import { parseJson, defaultJsonLimits } from '../contracts/json';
// These accessors validate every unknown before the narrow consumer model is returned.
export type Data = Record<string, any>;
export class RigError extends Error {readonly code='riglab.refused';}
export function fail(s:string):never {throw new RigError(`RigLab: ${s}`);}
export function obj(v:unknown,required:readonly string[]=[],optional:readonly string[]=[]):Data {
 if(v===null||typeof v!=='object'||Array.isArray(v))return fail('expected object');
 const o=v as Data;if(required.some(k=>!Object.hasOwn(o,k))||Object.keys(o).some(k=>![...required,...optional].includes(k)))fail('unknown or missing field');return o;
}
export function record(v:unknown):Data {if(v===null||typeof v!=='object'||Array.isArray(v))return fail('expected named records');return v as Data;}
export function list(v:unknown,max=256,min=0):any[] {if(!Array.isArray(v)||v.length<min||v.length>max)return fail('array resource limit');return v;}
export function name(v:unknown):string {if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v))return fail('invalid name');return v;}
export function number(v:unknown,max=1_000_000):number {if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>max)return fail('nonfinite or excessive transform');return v;}
export function integer(v:unknown,max:number,min=0):number {const n=number(v,max);if(!Number.isSafeInteger(n)||n<min)return fail('integer resource limit');return n;}
export function point(v:unknown,n=2):number[] {const a=list(v,n,n);a.forEach(x=>number(x));return a;}
export function unique(v:readonly string[]):void {if(new Set(v).size!==v.length)fail('duplicate name or reference');}
export function header(v:Data,format:string,version:number):void {if(v.format!==format||v.version!==version)fail(`unsupported ${format} version`);}
export function parse(bytes:Uint8Array):Data {const p=parseJson(bytes,{...defaultJsonLimits,maxBytes:8*1024*1024,maxArrayItems:7201,maxObjectKeys:512,maxValues:1_500_000});if(!p.ok)return fail(p.diagnostic.message);return record(p.value);}
export function freeze<T>(v:T):T {if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
