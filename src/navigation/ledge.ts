// Finite schedules, exact actor roots and full-body replay. No completeness claim.
import {step,hasLedge,ledgeGrips,initialLedge,initialResources,initialDash,initialWall,type LedgeState,type DashInput} from '../ledge/runtime';
import {groundMotionAllowed,wallMotionAllowed,ledgeMotionAllowed} from '../ledge/intent';
import {resolveStance,overlaps,replayBytes,digest,type World,type ClimbState,type Step,type RunInput} from '../physics-reference';
import type {MapDocument,MovementDocument} from '../contracts';
import type {AirResult,AirOptions,Witness} from './airborne';
import type {Identity,Interval} from './surface';
import {primitiveLimits} from './air-jumps';
export async function buildLedgeActions(map:MapDocument,p:MovementDocument,w:World,revision:number,settings:AirOptions,identity:Identity,intervals:readonly Interval[],cancelled:()=>boolean,yieldTask:()=>Promise<void>,launchRegionSu?:readonly[number,number,number,number],sourceInitial?:ClimbState):Promise<AirResult>{
 const limits=primitiveLimits(settings),edges:Witness[]=[],rejected:Record<string,number>={};let samples=0,replayTicks=0;
 const result=(status:AirResult['status'],diagnostics:string[],completeEdges:Witness[]=[]):AirResult=>({format:'maplab.airborne-actions',version:1,revision,status,canCertify:false,complete:false,identity,settings:{...settings,...limits},assumptions:['core.ledge.climb@1: authored static vertical face with horizontal registered landing and rectangular approach.','Finite approach/jump/hold schedules; no general ledge reachability or completeness claim.','Exact incoming resources and action metadata; a wall pool, when present, pays one stamina per grab/lift/transfer tick.'],diagnostics,samples,replayTicks,rejected,intervals:status==='candidate'||status==='no route found within declared search/sampling budget'?intervals:[],edges:completeEdges});
 const locate=(s:ClimbState)=>intervals.find(i=>i.supportId===s.supportId&&s.x>=i.minX&&s.x<=i.maxX);
 const permitted=(s:ClimbState,d:number)=>s.mode!=='ground'||!!locate(s)&&[d,s.vx].every(v=>v===0||locate(s)!.direction==='both'||(v>0?locate(s)!.direction==='aToB':locate(s)!.direction==='bToA'));
 const safe=(s:ClimbState)=>s.x-w.half>=map.bounds[0]*256&&s.x+w.half<=(map.bounds[0]+map.bounds[2])*256&&s.y-w.height>=map.bounds[1]*256&&s.y<=(map.bounds[1]+map.bounds[3])*256&&!overlaps(w,s.x,s.y);
 function* roots():Generator<ClimbState>{
  if(sourceInitial){yield structuredClone(sourceInitial);return;}
  for(const i of intervals)for(const x of [...new Set([i.minX,i.maxX,Math.floor((i.minX+i.maxX)/2)])]){
   if(launchRegionSu&&(x<launchRegionSu[0]||x>launchRegionSu[2]))continue;
   const pose=resolveStance(w,x,i.supportId).find(s=>s.face.supportId===i.supportId);if(!pose)continue;
   yield {x,y:pose.y,vx:0,vy:0,mode:'ground',supportId:i.supportId,planeId:pose.face.planeId??w.defaultPlane,facing:1,tick:0,jumpHeldPrev:false,jumpReleased:false,ticksSinceJump:0,dropSuppression:null,resources:initialResources(p),...initialDash(p),...initialWall(p),...initialLedge(p),traversalId:null,climbReady:true};
  }
 }
 try{
  if(cancelled())return result('cancelled',['cancelled']);
  if(!hasLedge(p))return result('unsupported',['ledge capability required']);
  const geometry=ledgeGrips(w);if(geometry.unsupported.length)return result('unsupported',geometry.unsupported);
  for(const initial of roots())for(const moveX of [-1,1] as const)for(const jump of [false,true]){
   if(cancelled())throw Error('cancelled');if(++samples>Math.min(settings.maxCandidates,limits.maxAirStates))throw Error('state-budget');
   if(jump&&limits.maxAirActions<1||!safe(initial))continue;
   let s=initial,grabbed=false;const frames:Step[]=[],input:RunInput[]=[],walls=new Set<import('../wall/runtime').WallAction>();
   for(let n=0;n<settings.maxTicks;n++){
    if(cancelled())throw Error('cancelled');if(replayTicks>=settings.maxReplayTicks)throw Error('replay-budget');if(replayTicks%256===0)await yieldTask();replayTicks++;
    const c:DashInput={moveX,moveY:n===0&&jump?0:-1,run:false,jump:n===0&&jump,drop:false};
    if(!permitted(s,c.moveX))break;
    const f=step(w,s,c),next=f.state as ClimbState;if(f.status==='contactBudget')throw Error('contact-budget');
    if(f.status!=='ok'){rejected[f.reason??f.status]=(rejected[f.reason??f.status]??0)+1;break;}
    if(!safe(next)||!permitted(next,c.moveX)||!wallMotionAllowed(map,p,s,next,walls)||!ledgeMotionAllowed(map,p,s,next)||!groundMotionAllowed(map,p,'fall',s,next)||jump&&!groundMotionAllowed(map,p,'jump',s,next))break;
    frames.push(f);input.push({...c,fromTick:s.tick});grabbed ||= (next as LedgeState).ledge?.action==='ledgeGrab';s=next;
    if(grabbed&&s.mode==='ground'){
     const to=locate(s);if(!to)break;
     const all=[initial,...frames.map(f=>f.state)],sweptBoundsSu=[Math.min(...all.map(s=>s.x-w.half)),Math.min(...all.map(s=>s.y-w.height)),Math.max(...all.map(s=>s.x+w.half)),Math.max(...all.map(s=>s.y))] as const;
     const compressed=input.filter((c,i)=>i===0||replayBytes({...c,fromTick:0})!==replayBytes({...input[i-1]!,fromTick:0})),key=await digest({initial,input:compressed,to:to.key,kind:'ledgeClimb'});
     edges.push({key,kind:'ledgeClimb',status:'verified reachable with replay witness',fromInterval:locate(initial)?.key??'airborne-source',toInterval:to.key,initial,terminal:s,input:compressed,frames,costTicks:frames.length,dependencies:{identity,sweptBoundsSu,sha256:await digest({identity,sweptBoundsSu,initial,input:compressed,frames})}});break;
    }
   }
  }
  const unique=[...new Map(edges.map(e=>[e.key,e])).values()].sort((a,b)=>a.key.localeCompare(b.key));
  return result(unique.length?'candidate':'no route found within declared search/sampling budget',[],unique);
 }catch(e){if(e instanceof Error&&(e.message==='cancelled'||e.message.endsWith('-budget')))return result(e.message==='cancelled'?'cancelled':'budget',[e.message]);throw e;}
}
