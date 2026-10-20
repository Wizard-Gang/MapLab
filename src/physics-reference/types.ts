import type { MapGeometry } from '../contracts/geometry';
import type { MovementDocument } from '../contracts/movement-types';
import type { Point } from './integer';
export type ContactMap = MapGeometry;
export interface State {
  readonly x:number; readonly y:number; readonly vx:number; readonly vy:number;
  readonly mode:'ground'|'air'; readonly supportId:string|null; readonly planeId:string|null;
  readonly facing:1|-1; readonly tick:number;
}
export interface Input { readonly moveX:-1|0|1; readonly run:boolean }
export interface Face {
  readonly bodyId:string; readonly shapeId:string; readonly edgeIndex:number;
  readonly a:Point; readonly b:Point; readonly normal:Point; readonly twoSided:boolean;
  readonly supportId:string|null; readonly registered:boolean; readonly materialId:string; readonly planeId:string|null;
  readonly links:readonly string[]; readonly support:boolean;
}
export interface World {
  readonly profile:MovementDocument; readonly source:ContactMap; readonly faces:readonly Face[];
  readonly solids:readonly (readonly Point[])[]; readonly half:number; readonly height:number; readonly defaultPlane:string|null;
}
export interface Contact {
  readonly axis:'x'|'y'; readonly bodyId:string; readonly shapeId:string; readonly edgeIndex:number;
  readonly supportId:string|null; readonly normal:Point; readonly point:Point;
  readonly kind:'blocking'|'support'|'unregisteredSupport';
}
export type Status = 'ok'|'invalidState'|'unsupported'|'contactBudget'|'unsafeInteger';
export interface Step { readonly status:Status; readonly state:State; readonly contacts:readonly Contact[]; readonly reason?:string }
export interface RunInput extends Input { readonly fromTick:number }
export interface Trace {
  readonly format:'maplab.contact-replay'; readonly version:1; readonly scope:'contact'; readonly canCertify:false;
  readonly controller:{readonly key:'maplab.reference-controller';readonly version:1};
  readonly collision:{readonly key:'maplab.collision';readonly version:1};
  readonly sourceSha256:string; readonly profileSha256:string; readonly traceSha256:string;
  readonly initial:State; readonly input:readonly RunInput[]; readonly frames:readonly Step[];
}
