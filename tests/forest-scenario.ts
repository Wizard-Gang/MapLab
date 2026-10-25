// Acceptance orchestration only: every caller supplies documents parsed from final export bytes.
import type {JsonValue,MapDocument,MovementDocument} from '../src/contracts';
import {PortalTestSession,type PortalRecording,parsePortalRecording} from '../src/test-runtime/portals';
import {TestSession,NEUTRAL,type Recording} from '../src/test-runtime/session';
import {Navigation,ROUTE_DEFAULTS} from '../src/navigation/routes';
import {replayBytes} from '../src/physics-reference';
import {planFlight} from '../src/flight/planner';
export function forestDocuments(documents:readonly JsonValue[]){
 const byId=new Map(documents.map(d=>[(d as unknown as {id:string}).id,d]));
 return {map:byId.get('map.forest') as unknown as MapDocument,player:byId.get('movement.player') as unknown as MovementDocument,ground:byId.get('movement.ground') as unknown as MovementDocument,flyer:byId.get('movement.flyer') as unknown as MovementDocument};
}
export function movementRun(documents:readonly JsonValue[],recordings:Record<string,Recording>){const {map,player}=forestDocuments(documents);return Object.fromEntries(Object.entries(recordings).map(([id,input])=>{const r=new TestSession(map as never,player);r.replay(input);return [id,{frames:r.getSnapshot().frames,recording:r.recording()}];}));}
export function journeyRun(documents:readonly JsonValue[],value:PortalRecording){
 const input=parsePortalRecording(value),{map,player}=forestDocuments(documents),r=new PortalTestSession(map,player,documents);let schedule=0,commands=0;const samples=[];
 if(replayBytes(r.initial)!==replayBytes(input.initial))throw Error('Acceptance journey must start at the authored default start');
 const boundary=(n:number)=>{while(input.commands?.[commands]?.afterTicks===n){const c=input.commands[commands++]!;if(c.kind==='inject')r.injectEvent(c.event,c.encounterId);else r.interact(c.portalId);}};
 boundary(0);
 for(let n=0;n<input.ticks;n++){while(input.input[schedule+1]&&input.input[schedule+1]!.fromTick<=r.getSnapshot().state.tick)schedule++;const {fromTick:_,...control}=input.input[schedule]!;if(r.advance(control).status!=='ok')throw Error('Journey controller failure at '+n);boundary(n+1);const v=r.getSnapshot();samples.push({mapId:v.mapId,state:v.state,camera:v.camera,flags:v.gameplay!.flags,bodies:v.gameplay!.bodies,encounters:v.gameplay!.encounters});}
 const v=r.getSnapshot();return {mapId:v.mapId,state:v.state,travels:v.travels,gameplay:v.gameplay,camera:v.camera,samples,recording:r.recording()};
}
export async function patrolRun(documents:readonly JsonValue[],progress:(stage:string)=>void=()=>{}){
 const {map,ground,flyer}=forestDocuments(documents);
 progress('build ground');
 const nav=await Navigation.build(map,ground,0,{...ROUTE_DEFAULTS,maxActionTicks:512,maxReplayTicks:50000,maxExpanded:64,air:{...ROUTE_DEFAULTS.air}},()=>false,async()=>{});
 progress('ground graph '+nav.status);
 const patrol=await nav.patrol('spawn.ground','astar',()=>false,async()=>{});
 progress('ground patrol '+patrol.status);
 const limited=await nav.withSearchLimits({maxExpanded:8,maxReplayTicks:5000});
 const forbiddenGap=await limited.route(nav.sourceState('spawn.ground'),{supportId:'fh.east',x:660*256,toleranceSu:128,vx:0},'astar',()=>false,async()=>{});
 progress('ground gap '+forbiddenGap.status);
 const flight=await planFlight(map,flyer,{kind:'patrol',entityId:'spawn.flyer',algorithm:'astar'},0,undefined,()=>false,async()=>{});
 return {ground:patrol,forbiddenGap,flight};
}
export {NEUTRAL};
