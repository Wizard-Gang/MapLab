import {compileSchema,evaluate,type JsonValue} from '../contracts';
import schema from '../../schemas/maplab.map.v1.schema.json' with {type:'json'};
import {fieldOp,transaction} from '../domain/commands';import type {MapModel} from '../domain/model';
export type PresentationField='camera'|'environment';
/** Whole-field preimage and candidate source-graph validation preserve IDs/history atomically. */
export function presentationEdit(model:MapModel,field:PresentationField,value:JsonValue){
 const validator=compileSchema({$schema:schema.$schema,$defs:schema.$defs,$ref:'#/$defs/'+field} as unknown as JsonValue,field),errors=evaluate(validator,value);
 if(errors.length)throw Error(errors.map(e=>e.jsonPath+': '+e.message).join('; '));return transaction('Edit '+field+' intent',[fieldOp(model,field,value)]);
}

/** Session-local high-water marks survive deletion, undo branches, history pruning and panel remounts.
 * They reserve IDs immediately, even for discarded drafts; authored JSON and undo state stay unchanged. */
export class PresentationIds {
 private readonly counters:Record<PresentationField,number>={camera:0,environment:0};
 observe(ids:Iterable<string>):void {
  for(const id of ids){const match=/^new\.(camera|environment)\.zone\.([1-9][0-9]*)$/.exec(id);if(!match)continue;
   const field=match[1] as PresentationField,n=Number(match[2]);if(Number.isSafeInteger(n))this.counters[field]=Math.max(this.counters[field],n);
  }
 }
 observeModel(model:MapModel):void {this.observe(model.owners.keys());this.observe(model.groups.keys());}
 reserve(model:MapModel,field:PresentationField,drafts:Iterable<string>=[]):string {
  this.observeModel(model);this.observe(drafts);const next=this.counters[field]+1;
  if(!Number.isSafeInteger(next))throw Error('Presentation ID space exhausted');
  this.counters[field]=next;return 'new.'+field+'.zone.'+next;
 }
}
