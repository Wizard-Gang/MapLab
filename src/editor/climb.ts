import type { JsonValue } from '../contracts';
import type { ClimbPath } from '../physics-reference/climb';
import { insertOp, setOp, transaction } from '../domain/commands';
import type { JsonObject, MapModel } from '../domain/model';
import { candidate, editProblems } from './editing';
/** Structural/anchor validation is atomic; profile-specific diagnostics are a separate runtime query. */
export function authorClimb(model:MapModel,path:ClimbPath) {
  const exists=model.collections.get('traversals')?.byId.has(path.id);
  if(!exists&&(model.owners.has(path.id)||model.groups.has(path.id)))throw new Error('Climb ID collides with an existing object');
  const tx=transaction(exists?'Edit climb path':'Add climb path',exists?Object.entries(path).filter(([k])=>k!=='id').map(([k,v])=>setOp(model,'traversals',path.id,k,v as JsonValue)):[insertOp(model,'traversals',[path as unknown as JsonObject])]);
  const problems=editProblems(candidate(model,tx));if(problems.length)throw new Error('Climb edit refused: '+problems.join('; '));
  return tx;
}
