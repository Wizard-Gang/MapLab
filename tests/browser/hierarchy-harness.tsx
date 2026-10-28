import {createRoot} from 'react-dom/client';
import {Hierarchy} from '../../src/app/SelectionPanel';
import {objectIds} from '../../src/editor/document';
import {normalize} from '../../src/domain/model';
import {SelectionSession} from '../../src/editor/selection';
import type {JsonValue} from '../../src/contracts';
export function mountHierarchy(value:JsonValue){
  const normalized=normalize(value);if(!normalized.ok)throw Error(JSON.stringify(normalized.problems));
  const model=normalized.model,session=new SelectionSession(()=>model,()=>false,()=>true);
  const host=document.createElement('div');document.body.replaceChildren(host);
  createRoot(host).render(<Hierarchy ids={[...objectIds(model)]} model={model} session={session}/>);
}
