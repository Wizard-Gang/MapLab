import {own} from '../flight/controller';
import {replayBytes} from '../physics-reference';
import {GrappleWorld,type GrappleState,type GrappleFrame,type GrappleInput} from './controller';
export function replayGrapple(world:GrappleWorld,initial:GrappleState,frames:readonly GrappleFrame[]):readonly GrappleFrame[]|null {
 if(!world.valid(initial)||frames.length>3600)return null;
 let state=initial;const out:GrappleFrame[]=[];
 for(const f of frames){const actual=world.step(state,f.input);if(actual.status!=='ok'||replayBytes(actual)!==replayBytes(f))return null;out.push(actual);state=actual.state;}
 return own(out);
}
/** Test and navigation share the motor; the recording stores controls, not source edits. */
export class GrappleTestSession {
 readonly initial:GrappleState;private current:GrappleState;private frames:GrappleFrame[]=[];
 constructor(readonly world:GrappleWorld,initial:GrappleState){if(!world.valid(initial))throw Error('Invalid grapple Test initial');this.initial=own(initial);this.current=this.initial;}
 get state(){return this.current;}
 recording(){return own({solver:{key:'maplab.reference-grapple',version:1},initial:this.initial,frames:this.frames});}
 tick(input:GrappleInput):GrappleFrame {const f=this.world.step(this.current,input);if(f.status==='ok'){this.current=f.state;this.frames.push(f);}return f;}
 replay(frames:readonly GrappleFrame[]):boolean {const out=replayGrapple(this.world,this.initial,frames);if(!out)return false;this.frames=[...out];this.current=out.at(-1)?.state??this.initial;return true;}
}
