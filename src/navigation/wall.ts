// Bounded pulse/coast/climb wall sequences. Every edge replays the selected runtime.
import {step,wallContact,hasWall,hasDash,dashStarts,initialDash,initialResources,initialWall,wallDefinition,type WallState,type WallAction,type DashInput,type DashState,type DashRunInput} from '../wall/runtime';
import {resolveStance,overlaps,replayBytes,digest,type World,type ClimbState,type Step} from '../physics-reference';
import type {MapDocument,MovementDocument} from '../contracts';
import type {AirResult,AirOptions,Witness} from './airborne';
import type {Identity,Interval} from './surface';
import {primitiveLimits} from './air-jumps';
import {groundMotionAllowed,wallMotionAllowed} from '../wall/intent';
interface Trail {prior:Trail|null;frame:Step;input:DashRunInput;length:number}
interface Node {state:ClimbState;trail:Trail|null;used:number;air:boolean;walls:Set<WallAction>;jumped:boolean;dashed:boolean}
export async function buildWallActions(map:MapDocument,p:MovementDocument,w:World,revision:number,settings:AirOptions,identity:Identity,intervals:readonly Interval[],cancelled:()=>boolean,yieldTask:()=>Promise<void>,launchRegionSu?:readonly[number,number,number,number],sourceInitial?:ClimbState):Promise<AirResult>{
 const limits=primitiveLimits(settings),edges:Witness[]=[],rejected:Record<string,number>={};let samples=0,replayTicks=0;
 const reject=(why:string)=>{rejected[why]=(rejected[why]??0)+1;};
 const result=(status:AirResult['status'],diagnostics:string[],completeEdges:Witness[]=[]):AirResult=>({format:'maplab.airborne-actions',version:1,revision,status,canCertify:false,complete:false,identity,settings:{...settings,...limits},assumptions:['Static vertical collision faces only; no ledge/grapple/swing or timed-platform solver.','Bounded exact-state pulse/coast/climb search; no continuous reachability or completeness claim.','Stamina, side, input edges, launch velocity and dash/jump pools are exact preconditions.'],diagnostics,samples,replayTicks,rejected,intervals:status==='candidate'||status==='no route found within declared search/sampling budget'?intervals:[],edges:completeEdges});
 const locate=(s:ClimbState)=>intervals.find(i=>i.supportId===s.supportId&&s.x>=i.minX&&s.x<=i.maxX);
 const allowed=(s:ClimbState,d:number)=>s.mode!=='ground'||!!locate(s)&&[d,s.vx].every(v=>v===0||locate(s)!.direction==='both'||(v>0?locate(s)!.direction==='aToB':locate(s)!.direction==='bToA'));
 const safe=(s:ClimbState)=>s.x-w.half>=map.bounds[0]*256&&s.x+w.half<=(map.bounds[0]+map.bounds[2])*256&&s.y-w.height>=map.bounds[1]*256&&s.y<=(map.bounds[1]+map.bounds[3])*256&&!overlaps(w,s.x,s.y);
 function* roots():Generator<ClimbState>{
  if(sourceInitial){yield structuredClone(sourceInitial);return;}
  for(const i of intervals){
   const seeds=new Set([i.minX,i.maxX,Math.floor((i.minX+i.maxX)/2),...w.faces.filter(f=>f.a[0]===f.b[0]).flatMap(f=>[f.a[0]-w.half,f.a[0]+w.half]).filter(x=>x>=i.minX&&x<=i.maxX)]);
   function* positions(){yield* [...seeds].sort((a,b)=>a-b);for(let x=Math.ceil(i.minX/settings.spacingSu)*settings.spacingSu;x<=i.maxX;x+=settings.spacingSu)if(!seeds.has(x))yield x;}
   for(const x of positions()){
    if(cancelled())throw Error('cancelled');if(samples>=Math.min(settings.maxCandidates,limits.maxAirStates))throw Error('state-budget');
    if(launchRegionSu&&(x<launchRegionSu[0]||x>launchRegionSu[2]))continue;
    const pose=resolveStance(w,x,i.supportId).find(s=>s.face.supportId===i.supportId);if(!pose)continue;
    for(const vx of [...new Set([0,-p.ground.runSpeed,p.ground.runSpeed])])yield {x,y:pose.y,vx,vy:0,mode:'ground',supportId:i.supportId,planeId:pose.face.planeId??w.defaultPlane,facing:vx<0?-1:1,tick:0,jumpHeldPrev:false,jumpReleased:false,ticksSinceJump:0,dropSuppression:null,resources:initialResources(p),...initialDash(p),...initialWall(p),traversalId:null,climbReady:true};
   }
  }
 }
 const publish=async(initial:ClimbState,node:Node)=>{
  const to=locate(node.state);if(!to||!node.trail)return;
  const frames:Step[]=[],input:DashRunInput[]=[];let t:Trail|null=node.trail;while(t){frames.push(t.frame);input.push(t.input);t=t.prior;}frames.reverse();input.reverse();
  const compressed=input.filter((c,i)=>i===0||replayBytes({...c,fromTick:0})!==replayBytes({...input[i-1]!,fromTick:0}));
  const kind:Witness['kind']=node.walls.has('wallJump')?'wallJump':node.walls.has('wallClimb')?'wallClimb':node.walls.has('wallSlide')?'wallSlide':node.dashed?'dash':node.jumped?'jump':'fall';
  const all=[initial,...frames.map(f=>f.state)],sweptBoundsSu=[Math.min(...all.map(s=>s.x-w.half)),Math.min(...all.map(s=>s.y-w.height)),Math.max(...all.map(s=>s.x+w.half)),Math.max(...all.map(s=>s.y))] as const;
  const key=await digest({initial,input:compressed,to:to.key,kind}),dependencies={identity,sweptBoundsSu,sha256:await digest({identity,sweptBoundsSu,initial,input:compressed,frames})};
  edges.push({key,kind,status:'verified reachable with replay witness',fromInterval:locate(initial)?.key??'airborne-source',toInterval:to.key,initial,terminal:node.state,input:compressed,frames,costTicks:frames.length,dependencies});
 };
 try{
  if(!hasWall(p))return result('unsupported',['wall module requires wall capability']);
  for(const initial of roots()){
   if(!safe(initial))continue;
   const seen=new Map<string,number>(),stack:Node[]=[{state:initial,trail:null,used:0,air:initial.mode==='air',walls:new Set(),jumped:false,dashed:!!(initial as DashState).dash?.active}];
   while(stack.length){
    if(cancelled())throw Error('cancelled');if(samples>=Math.min(settings.maxCandidates,limits.maxAirStates))throw Error('state-budget');samples++;
    const node=stack.pop()!,old=node.state,side=wallContact(w,old)?.side;
    const choices:DashInput[]=[];
    for(const moveX of (side!==undefined||!node.trail?[-1,0,1]:[...new Set([node.trail.input.moveX,0])]) as (-1|0|1)[]){
     if(old.mode==='air'||(old.x===locate(old)?.minX&&moveX===-1)||(old.x===locate(old)?.maxX&&moveX===1))choices.push({moveX,moveY:0,run:true,jump:false,drop:false});
     if(!old.jumpHeldPrev&&(old.mode==='ground'&&p.abilities.some(a=>a.kind==='jump')||old.mode==='air'&&(old.resources.airJumps>0||side!==undefined&&(old as WallState).wall!.staminaTicks>0&&wallDefinition(p)!.permissions.includes('jump'))))choices.push({moveX,moveY:0,run:true,jump:true,drop:false});
     if(hasDash(p)&&!(old as DashState).dash?.active&&!(old as DashState).dash?.held&&old.resources.dashCharges>0)choices.push({moveX,moveY:0,run:true,jump:false,drop:false,dash:true});
    }
    if(side!==undefined&&(old as WallState).wall!.staminaTicks>0&&wallDefinition(p)!.permissions.includes('climb'))for(const moveY of [-1,1] as const)choices.push({moveX:side,moveY,run:true,jump:false,drop:false});
    const fh=map.footholds.find(f=>f.id===old.supportId);if(old.mode==='ground'&&p.drop.canDrop&&fh?.mode==='oneWay'&&fh.dropAllowed)choices.push({moveX:0,moveY:0,run:false,jump:false,drop:true});
    for(const c of choices.reverse()){
     const used=node.used+(c.jump||c.dash?1:0);if(used>limits.maxAirActions)continue;
     let state=old,trail=node.trail,air=node.air,jumped=node.jumped,dashed=node.dashed,ended=false;const walls=new Set(node.walls);
     for(let n=0;n<limits.airStepTicks;n++){
      if((trail?.length??0)>=settings.maxTicks){reject('action-tick-limit');ended=true;break;}
      if(replayTicks>=settings.maxReplayTicks)throw Error('replay-budget');if(replayTicks%256===0){await yieldTask();if(cancelled())throw Error('cancelled');}replayTicks++;
      const control={...c,jump:!!c.jump&&n===0,dash:!!c.dash&&n===0,drop:!!c.drop&&n===0};if(!allowed(state,control.moveX)){ended=true;break;}
      const frame=step(w,state,control),next=frame.state as ClimbState;if(frame.status==='contactBudget')throw Error('contact-budget');
      if(frame.status!=='ok'){reject(frame.status);ended=true;break;}
      jumped ||= !!control.jump;dashed ||= !!(state as DashState).dash?.active||dashStarts(p,state,control);
      if(!safe(next)||!wallMotionAllowed(map,p,state,next,walls)||!groundMotionAllowed(map,p,'fall',state,next)||jumped&&!groundMotionAllowed(map,p,'jump',state,next)||dashed&&!groundMotionAllowed(map,p,'dash',state,next)||control.drop&&!groundMotionAllowed(map,p,'drop',state,next)){reject('clearance-or-intent');ended=true;break;}
      trail={prior:trail,frame,input:{...control,fromTick:state.tick},length:(trail?.length??0)+1};if(next.mode==='air')air=true;
      if(next.mode==='ground'&&!(next as DashState).dash?.active){if(air)await publish(initial,{state:next,trail,used,air,walls,jumped,dashed});ended=true;break;}
      if(next.mode!=='air'){reject('unsupported-mode-transition');ended=true;break;}state=next;
     }
     if(ended||!trail)continue;
     const key=replayBytes({state:{...state,tick:0},used,air,walls:[...walls].sort(),jumped,dashed}),prior=seen.get(key);if(prior!==undefined&&prior<=trail.length)continue;
     seen.set(key,trail.length);stack.push({state,trail,used,air,walls,jumped,dashed});
    }
   }
  }
  const unique=[...new Map(edges.map(e=>[e.key,e])).values()].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  return result(unique.length?'candidate':'no route found within declared search/sampling budget',[],unique);
 }catch(e){if(e instanceof Error&&(e.message==='cancelled'||e.message.endsWith('-budget')))return result(e.message==='cancelled'?'cancelled':'budget',[e.message]);throw e;}
}
