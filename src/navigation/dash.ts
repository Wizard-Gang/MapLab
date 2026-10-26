// Bounded ground/air dash and jump/coast primitives over exact runtime state.
import {step,hasDash,dashStarts,initialDash,initialResources,type DashInput,type DashState,type DashRunInput} from '../dash/runtime';
import {resolveStance,overlaps,replayBytes,digest,type World,type ClimbState,type Step} from '../physics-reference';
import type {MapDocument} from '../contracts/document-types';
import type {MovementDocument} from '../contracts/movement-types';
import type {AirResult,AirOptions,Witness} from './airborne';
import type {Identity,Interval} from './surface';
import {primitiveLimits} from './air-jumps';
import {groundMotionAllowed} from '../dash/intent';
interface Trail {readonly prior:Trail|null;readonly frame:Step;readonly input:DashRunInput;readonly length:number}
interface Node {readonly state:ClimbState;readonly trail:Trail|null;readonly used:number;readonly air:boolean;readonly dashed:boolean;readonly jumped:boolean}
export async function buildDashActions(map:MapDocument,p:MovementDocument,w:World,revision:number,settings:AirOptions,identity:Identity,intervals:readonly Interval[],cancelled:()=>boolean,yieldTask:()=>Promise<void>,launchRegionSu?:readonly[number,number,number,number],sourceInitial?:ClimbState):Promise<AirResult> {
 const limits=primitiveLimits(settings),options={...settings,...limits},edges:Witness[]=[];
 let samples=0,replayTicks=0;const rejected:Record<string,number>={};
 const reject=(why:string)=>{rejected[why]=(rejected[why]??0)+1;};
 const assumptions=['Static source and selected horizontal dash module only.','Bounded dash/jump/coast state expansion; no continuous reachability or timed-platform claim.','Exact launch velocity, charges, cooldowns, duration and input edges are retained.'];
 const result=(status:AirResult['status'],diagnostics:string[],completeEdges:Witness[]=[]):AirResult=>({format:'maplab.airborne-actions',version:1,revision,status,canCertify:false,complete:false,identity,settings:options,assumptions,diagnostics,samples,replayTicks,rejected,intervals:status==='candidate'||status==='no route found within declared search/sampling budget'?intervals:[],edges:completeEdges});
 const locate=(s:ClimbState)=>intervals.find(i=>i.supportId===s.supportId&&s.x>=i.minX&&s.x<=i.maxX);
 const allowed=(s:ClimbState,d:number)=>s.mode!=='ground'||!!locate(s)&&[d,s.vx].every(v=>v===0||locate(s)!.direction==='both'||(v>0?locate(s)!.direction==='aToB':locate(s)!.direction==='bToA'));
 const safe=(s:ClimbState)=>s.x-w.half>=map.bounds[0]*256&&s.x+w.half<=(map.bounds[0]+map.bounds[2])*256&&s.y-w.height>=map.bounds[1]*256&&s.y<=(map.bounds[1]+map.bounds[3])*256&&!overlaps(w,s.x,s.y);
 function* roots():Generator<ClimbState> {
  if(sourceInitial){yield structuredClone(sourceInitial);return;}
  for(const i of intervals){
   const seeds=new Set([i.minX,i.maxX,Math.floor((i.minX+i.maxX)/2)]);
   function* positions(){yield* [...seeds].sort((a,b)=>a-b);for(let x=Math.ceil(i.minX/settings.spacingSu)*settings.spacingSu;x<=i.maxX;x+=settings.spacingSu)if(!seeds.has(x))yield x;}
   for(const x of positions()){
    if(cancelled())throw Error('cancelled');
    if(samples>=Math.min(settings.maxCandidates,limits.maxAirStates))throw Error('state-budget');
    if(launchRegionSu&&(x<launchRegionSu[0]||x>launchRegionSu[2]))continue;
    const pose=resolveStance(w,x,i.supportId).find(s=>s.face.supportId===i.supportId);if(!pose)continue;
    for(const vx of [...new Set([0,-p.ground.runSpeed,p.ground.runSpeed])])yield {x,y:pose.y,vx,vy:0,mode:'ground',supportId:i.supportId,planeId:pose.face.planeId??w.defaultPlane,facing:vx<0?-1:1,tick:0,jumpHeldPrev:false,jumpReleased:false,ticksSinceJump:0,dropSuppression:null,resources:initialResources(p),...initialDash(p),traversalId:null,climbReady:true};
   }
  }
 }
 const publish=async(initial:ClimbState,trail:Trail,terminal:ClimbState,dashed:boolean,kind:Witness['kind'])=>{
  const to=locate(terminal);if(!to||terminal.supportId===initial.supportId&&!dashed)return;
  const frames:Step[]=[],input:DashRunInput[]=[];let at:Trail|null=trail;while(at){frames.push(at.frame);input.push(at.input);at=at.prior;}frames.reverse();input.reverse();
  const compressed=input.filter((c,i)=>{if(i===0)return true;const {fromTick:_,...a}=c,{fromTick:__,...b}=input[i-1]!;return replayBytes(a)!==replayBytes(b);});
  const all=[initial,...frames.map(f=>f.state)],sweptBoundsSu=[Math.min(...all.map(s=>s.x-w.half)),Math.min(...all.map(s=>s.y-w.height)),Math.max(...all.map(s=>s.x+w.half)),Math.max(...all.map(s=>s.y))] as const;
  const selectedKind=dashed?'dash':kind,key=await digest({initial,input:compressed,to:to.key,kind:selectedKind}),dependencies={identity,sweptBoundsSu,sha256:await digest({identity,sweptBoundsSu,initial,input:compressed,frames})};
  edges.push({key,kind:selectedKind,status:'verified reachable with replay witness',fromInterval:locate(initial)?.key??'airborne-source',toInterval:to.key,initial,terminal,input:compressed,frames,costTicks:frames.length,dependencies});
 };
 try{
 for(const initial of roots()){
  if(!hasDash(p))return result('unsupported',['dash module requires dash capability']);
  if(cancelled())throw Error('cancelled');
  const foothold=map.footholds.find(f=>f.id===initial.supportId);
  const kinds:Witness['kind'][]=initial.mode==='air'?['fall']:['dash','jump','fall',...(p.drop.canDrop&&foothold?.mode==='oneWay'&&foothold.dropAllowed?['drop' as const]:[])];
  const jump=p.abilities.find(a=>a.kind==='jump'),holds=[...new Set([0,Math.floor((jump?.holdTicks??0)/2),jump?.holdTicks??0])];
  for(const direction of [-1,0,1] as const)for(const kind of kinds)for(const hold of kind==='jump'?holds:[0]){
   if(kind==='jump'&&!p.abilities.some(a=>a.kind==='jump'))continue;
   if(kind==='fall'&&initial.mode==='ground'&&!((initial.x===locate(initial)?.minX&&direction===-1)||(initial.x===locate(initial)?.maxX&&direction===1)))continue;
   if(!safe(initial)||!allowed(initial,direction))continue;
   const seen=new Map<string,number>(),stack:Node[]=[{state:initial,trail:null,used:0,air:initial.mode==='air',dashed:!!(initial as DashState).dash?.active,jumped:false}];
   while(stack.length){
    if(cancelled())throw Error('cancelled');
    if(samples>=Math.min(settings.maxCandidates,limits.maxAirStates))throw Error('state-budget');samples++;
    const node=stack.pop()!,old=node.state,d=(old as DashState).dash!;
    const variants:('coast'|'jump'|'dash')[]=node.trail===null&&old.mode==='ground'?[kind==='dash'?'dash':kind==='jump'?'jump':'coast']:['coast'];
    if(node.trail!==null||old.mode==='air'){
     if(!d.active&&node.used<limits.maxAirActions){
      if(!d.held&&p.abilities.some(a=>a.kind==='dash'&&a.mode===old.mode)&&old.resources.dashCharges>0)variants.push('dash');
      if(old.mode==='air'&&!old.jumpHeldPrev&&old.resources.airJumps>0)variants.push('jump');
     }
    }
    // LIFO explores coast first; longer schedules remain explicitly bounded.
    for(const variant of variants.reverse()){
     let state=old,trail=node.trail,air=node.air,dashed=node.dashed,jumped=node.jumped,ended=false;
     const used=node.used+(variant==='coast'?0:1);if(used>limits.maxAirActions)continue;
     for(let n=0;n<limits.airStepTicks;n++){
      if((trail?.length??0)>=settings.maxTicks){reject('action-tick-limit');ended=true;break;}
      if(replayTicks>=settings.maxReplayTicks)throw Error('replay-budget');
      if(replayTicks%256===0){await yieldTask();if(cancelled())throw Error('cancelled');}replayTicks++;
      const control:DashInput={moveX:direction,moveY:0,run:true,jump:variant==='jump'&&n===0||kind==='jump'&&(trail?.length??0)<=hold,dash:variant==='dash'&&n===0,drop:kind==='drop'&&trail===null&&n===0};
      if(!allowed(state,direction)){reject('support-direction');ended=true;break;}
      const started=dashStarts(p,state,control),frame=step(w,state,control),next=frame.state as ClimbState,nextDash=(next as DashState).dash;
      if(frame.status==='contactBudget')throw Error('contact-budget');
      if(frame.status!=='ok'){reject(frame.status);ended=true;break;}
      dashed ||= started||!!nextDash?.active;
      jumped ||= !!control.jump;
      if(!safe(next)||!groundMotionAllowed(map,p,kind,state,next)||dashed&&!groundMotionAllowed(map,p,'dash',state,next)||jumped&&!groundMotionAllowed(map,p,'jump',state,next)||frame.contacts.some(c=>c.kind==='blocking')){reject('finite-body-clearance-or-intent');ended=true;break;}
      trail={prior:trail,frame,input:{...control,fromTick:state.tick},length:(trail?.length??0)+1};
      if(next.mode==='air')air=true;
      if(next.mode==='ground'&&!nextDash?.active&&(air||dashed)){if(allowed(next,direction))await publish(initial,trail,next,dashed,kind);ended=true;break;}
      if(next.mode==='ground'&&!air&&!dashed&&kind!=='fall'){reject('no-departure-or-action-refused');ended=true;break;}
      if(next.mode!=='air'&&next.mode!=='ground'){reject('unsupported-mode-transition');ended=true;break;}state=next;
     }
     if(ended||!trail)continue;
     const key=replayBytes({...state,tick:0,used,dashed,jumped,air}),earlier=seen.get(key);
     if(earlier!==undefined&&earlier<=trail.length){reject('dominated-identical-state');continue;}
     seen.set(key,trail.length);stack.push({state,trail,used,air,dashed,jumped});
    }
   }
  }
 }
 const unique=[...new Map(edges.map(e=>[e.key,e])).values()].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 return result(unique.length?'candidate':'no route found within declared search/sampling budget',[],unique);
 }catch(e){if(e instanceof Error&&(e.message==='cancelled'||e.message.endsWith('-budget')))return result(e.message==='cancelled'?'cancelled':'budget',[e.message]);throw e;}
}
