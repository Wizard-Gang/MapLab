import {compileSchema,evaluate,type JsonValue} from '../contracts';
import schema from '../../schemas/maplab.map.v1.schema.json' with {type:'json'};
import {fieldOp,transaction} from '../domain/commands';import type {MapModel} from '../domain/model';
export type PresentationField='camera'|'environment';
/** Whole-field preimage and candidate source-graph validation preserve IDs/history atomically. */
export function presentationEdit(model:MapModel,field:PresentationField,value:JsonValue){
 const validator=compileSchema({$schema:schema.$schema,$defs:schema.$defs,$ref:'#/$defs/'+field} as unknown as JsonValue,field),errors=evaluate(validator,value);
 if(errors.length)throw Error(errors.map(e=>e.jsonPath+': '+e.message).join('; '));return transaction('Edit '+field+' intent',[fieldOp(model,field,value)]);
}
