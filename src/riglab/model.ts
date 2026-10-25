// Independent consumer types. No RigLab/Hexframe runtime, editor or solver is imported.
export type Triple = readonly [number, number, number];
export interface Bone { readonly name:string; readonly parent:string|null; readonly offset:readonly[number,number]; readonly tip:readonly[number,number]|null; readonly slot:string; readonly artHeight:number }
export interface DepthProfile { readonly underLowerBody:'far'|'near'|null; readonly behindTorso:'far'|'near'|null; readonly foreground:readonly('far'|'near')[]; readonly head:'above-arms'|'below-arms' }
export interface Depth { readonly profiles:Readonly<Record<string,DepthProfile>>; readonly sides:Readonly<Record<'facingRight'|'facingLeft',{readonly arms:{readonly far:string;readonly near:string};readonly legs:{readonly far:string;readonly near:string}}>>;readonly byClip:Readonly<Record<string,string>>;readonly default:string }
export interface Rig { readonly name:string;readonly root:string;readonly bones:readonly Bone[];readonly depthProfiles?:Depth }
export interface Clip { readonly name:string;readonly class:string;readonly length:number;readonly loop:boolean }
export interface Baked { readonly animation:string;readonly bones:readonly string[];readonly frames:readonly(readonly Triple[])[];readonly weapons?:readonly({readonly name:string;readonly bodies:Readonly<Record<string,Triple>>}|null)[] }
export interface Weapon { readonly name:string;readonly bodies:readonly{readonly name:string;readonly slot:string}[] }
export interface RigView { readonly digest:string;readonly rig:Rig;readonly clips:readonly Clip[];readonly baked:readonly Baked[];readonly weapons:readonly Weapon[] }
export interface RigBundle extends RigView { readonly files:ReadonlyMap<string,Uint8Array> }
