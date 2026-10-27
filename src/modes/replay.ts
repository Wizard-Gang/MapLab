import {replayBytes} from '../physics-reference';
import {own} from '../flight/controller';
import {ModeWorld,type ModeState,type ModeFrame,type ModeControl} from './controller';
/** Test playback and consumers must replay controls and complete transition actions,
 * rather than trusting a cached position stream. No authored state is changed. */
export function replayModes(world:ModeWorld,initial:ModeState,frames:readonly ModeFrame[]):readonly ModeFrame[]|null {
 if(!world.valid(initial)||frames.length>3600)return null;let state=initial;const actual:ModeFrame[]=[];
 for(let n=0;n<frames.length;){const f=frames[n]!;
  if(f.action!==null){const t=world.transitions.find(t=>t.id===f.action);if(!t)return null;const motion=world.transition(state,t,600);if(!motion||replayBytes(motion)!==replayBytes(frames.slice(n,n+motion.length)))return null;actual.push(...motion);state=motion.at(-1)!.state;n+=motion.length;}
  else{const next=world.step(state,f.input);if(!next)return null;const frame={state:next,input:f.input,action:null};if(replayBytes(frame)!==replayBytes(f))return null;actual.push(frame);state=next;n++;}
 }return own(actual);
}
export class ModeTestSession {
 private current:ModeState;private frames:ModeFrame[]=[];
 constructor(readonly world:ModeWorld,readonly initial:ModeState){if(!world.valid(initial))throw Error('Invalid mode Test initial');this.initial=own(initial);this.current=this.initial;}
 get state(){return this.current;}
 recording(){return own({initial:this.initial,frames:this.frames});}
 tick(input:ModeControl):boolean {const state=this.world.step(this.current,input);if(!state)return false;this.frames.push(own({state,input,action:null}));this.current=state;return true;}
 action(id:string):boolean {const t=this.world.transitions.find(t=>t.id===id),frames=t?this.world.transition(this.current,t,600):null;if(!frames)return false;this.frames.push(...frames);this.current=frames.at(-1)!.state;return true;}
 replay(frames:readonly ModeFrame[]):boolean {const actual=replayModes(this.world,this.initial,frames);if(!actual)return false;this.frames=[...actual];this.current=actual.at(-1)?.state??this.initial;return true;}
}
