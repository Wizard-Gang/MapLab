import {own} from '../flight/controller';
import {replayBytes} from '../physics-reference';
import {ActionWorld,type ActionState,type ActionFrame,type ActionInput} from './controller';
export function replayActions(world:ActionWorld,initial:ActionState,frames:readonly ActionFrame[]):readonly ActionFrame[]|null {
 if(!world.valid(initial)||frames.length>600)return null;let state=initial;const out:ActionFrame[]=[];
 for(const f of frames){const actual=world.step(state,f.input);if(actual.status!=='ok'||replayBytes(actual)!==replayBytes(f))return null;out.push(actual);state=actual.state;}return own(out);
}
export class ActionTestSession {
 readonly initial:ActionState;private current:ActionState;private frames:ActionFrame[]=[];
 constructor(readonly world:ActionWorld,initial:ActionState){if(!world.valid(initial))throw Error('Invalid action Test initial');this.initial=own(initial);this.current=this.initial;}
 get state(){return this.current;}
 recording(){return own({solver:{key:'maplab.reference-actions',version:1},initial:this.initial,frames:this.frames});}
 tick(input:ActionInput):ActionFrame {const f=this.world.step(this.current,input);if(f.status==='ok'){this.current=f.state;this.frames.push(f);}return f;}
 replay(frames:readonly ActionFrame[]):boolean {const out=replayActions(this.world,this.initial,frames);if(!out)return false;this.frames=[...out];this.current=out.at(-1)?.state??this.initial;return true;}
}
