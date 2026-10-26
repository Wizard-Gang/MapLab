import type {Motion,JsonValue} from '../contracts';
import type {MapModel} from '../domain/model';
import {transaction,setOp} from '../domain/commands';
import {candidate,editProblems} from './editing';
import {motionOffset} from '../platforms/motion';
export function platformMotion(model:MapModel,id:string,motion:Motion|null,enabled:boolean){
 if(motion){motionOffset(motion,0);motionOffset(motion,1);}
 const tx=transaction(motion?'Apply translating platform motion':'Make body static',[
  setOp(model,'bodies',id,'mobility',motion?'kinematic':'static'),setOp(model,'bodies',id,'motion',motion as unknown as JsonValue),setOp(model,'bodies',id,'enabled',enabled)
 ]),problems=editProblems(candidate(model,tx));
 if(problems.length)throw Error('Platform motion refused: '+problems.join('; '));return tx;
}
