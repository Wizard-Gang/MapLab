import type {MapDocument,MovementDocument} from '../contracts';
import {replayBytes,type ContactMap,type State,type Input} from '../physics-reference';
import {platformStep,type PlatformStep} from './runtime';
import {platformWorld} from './world';
import {phases,safe,supportBody,validateTimedWorld,type Phase} from './timing';
export type TimedKind='wait'|'board'|'ride'|'exit'|'move';
export interface TimedFrame {readonly kind:TimedKind;readonly input:Input;readonly phases:readonly Phase[];readonly frame:PlatformStep}
export function transitionKind(map:MapDocument,from:State,to:State):TimedKind {
 const a=supportBody(map,from),b=supportBody(map,to);
 return a&&a!==b?'exit':b&&a!==b?'board':b?'ride':from.x===to.x&&from.y===to.y&&to.mode==='ground'?'wait':'move';
}
export function timedStep(map:MapDocument,p:MovementDocument,s:State,input:Input):TimedFrame|null {
 if(!safe(platformWorld(map as unknown as ContactMap,p,s.tick),s))return null;
 const frame=platformStep(map as unknown as ContactMap,p,s,input);
 if(frame.status!=='ok'||frame.platforms.status!=='ok'||!safe(platformWorld(map as unknown as ContactMap,p,frame.state.tick),frame.state))return null;
 return {kind:transitionKind(map,s,frame.state),input,phases:phases(map,frame.state.tick),frame};
}
export function replayTimed(map:MapDocument,p:MovementDocument,initial:State,frames:readonly TimedFrame[]):readonly TimedFrame[]|null {
 try{if(frames.length>600)return null;validateTimedWorld(map,p,initial);let s=initial;const out:TimedFrame[]=[];
  for(const expected of frames){const actual=timedStep(map,p,s,expected.input);if(!actual||replayBytes(actual)!==replayBytes(expected))return null;out.push(actual);s=actual.frame.state;}
  return out;
 }catch{return null;}
}
export interface PhaseFeedback {readonly tick:number;readonly phases:readonly Phase[]}
/** The engine supplies measured phase, including phase at repeated offsets/turnarounds.
 * Any clock, body-set, phase or full actor-state difference invalidates this exact witness. */
export function followTimed(map:MapDocument,p:MovementDocument,initial:State,frames:readonly TimedFrame[],index:number,actor:State,feedback:PhaseFeedback):{status:'follow';input:Input}|{status:'replan';reason:string} {
 const replan=(reason:string)=>({status:'replan' as const,reason});
 if(!Number.isSafeInteger(index)||index<0||index>=frames.length||!replayTimed(map,p,initial,frames))return replan('Missing, stale or invalid timed witness');
 const expected=index?frames[index-1]!.frame.state:initial;
 if(replayBytes(actor)!==replayBytes(expected)||feedback.tick!==expected.tick)return replan('Actor/contact/clock drift');
 if(replayBytes(feedback.phases)!==replayBytes(phases(map,expected.tick)))return replan('Platform phase drift');
 return {status:'follow',input:frames[index]!.input};
}
