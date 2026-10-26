// Independent owned rectangular corpus oracle: no MapLab runtime or planner imports.
// This is deliberately restricted to the published flat-floor/thin-wall fixture family.
export function equations(map,p,initial,input,ticks){
 const frames=[],events=[];let s=structuredClone(initial);
 const defs=p.abilities.filter(a=>a.kind==='dash'),jump=p.abilities.find(a=>a.kind==='jump'),half=p.collider.width*128;
 const floorAt=x=>map.footholds.filter(f=>f.enabled&&f.a[1]===f.b[1]&&f.a[0]*256<=x-half&&f.b[0]*256>=x+half).sort((a,b)=>a.a[1]-b.a[1]||(a.id<b.id?-1:1));
 const approach=(v,target,a)=>v<target?Math.min(v+a,target):Math.max(v-a,target);
 for(let n=0;n<ticks;n++){
  const old=structuredClone(s),c=input.filter(i=>i.fromTick<=s.tick).at(-1),remaining={...s.dash.remaining},cd={...s.resources.cooldowns};
  for(const a of defs){const k='dash.'+a.mode;cd[k]=Math.max(0,cd[k]-1);if(a.reset==='timer'&&cd[k]===0)remaining[a.mode]=a.charges;}
  let active=s.dash.active,a=defs.find(a=>a.mode===s.mode);
  if(!active&&a&&c.dash&&!s.dash.held&&(c.moveY??0)===0&&remaining[a.mode]>0&&cd['dash.'+a.mode]===0){remaining[a.mode]--;cd['dash.'+a.mode]=a.cooldownTicks;active={mode:a.mode,direction:c.moveX||s.facing,ticksLeft:a.durationTicks};events.push({tick:s.tick+1,kind:'dashStart',mode:a.mode});}
  if(!active&&c.jump&&!s.jumpHeldPrev&&jump&&(s.mode==='ground'||s.resources.airJumps>0)){
   if(s.mode==='air')s.resources.airJumps--;s.vy=-(s.mode==='ground'?jump.impulse:jump.airborneImpulse);s.mode='air';s.supportId=null;s.ticksSinceJump=0;s.jumpReleased=false;
  }
  a=active?defs.find(a=>a.mode===active.mode):null;
  s.vx=active?active.direction*a.speed:approach(s.vx,c.moveX*(s.mode==='ground'?(c.run?p.ground.runSpeed:p.ground.walkSpeed):p.air.maxSpeed),s.mode==='ground'?(c.moveX?p.ground.acceleration:p.ground.braking):p.air.acceleration);
  const dx=s.vx;let x=s.x+dx,blocked=false;
  for(const b of map.bodies)for(const sh of b.shapes){const [left,top,w,h]=sh.rect.map((v,i)=>(v+(i===0?b.position[0]:i===1?b.position[1]:0))*256);if(s.y<=top||s.y-p.collider.height*256>=top+h)continue;
   if(dx>0&&s.x+half<=left&&x+half>=left){x=Math.min(x,left-half);blocked=true;}if(dx<0&&s.x-half>=left+w&&x-half<=left+w){x=Math.max(x,left+w+half);blocked=true;}}
  s.x=x;if(blocked)s.vx=0;
  const floors=floorAt(s.x);
  if(s.mode==='ground'&&!floors.some(f=>f.id===s.supportId)){s.mode='air';s.supportId=null;s.vy=0;}
  if(s.mode==='air'){
   const landing=s.vy>=0?floors.find(f=>old.y<=f.a[1]*256&&s.y<=f.a[1]*256&&s.y+s.vy>=f.a[1]*256):null;
   if(landing){s.y=landing.a[1]*256;s.vy=0;s.mode='ground';s.supportId=landing.id;s.resources.airJumps=jump?.airJumps??0;}
   else{const rising=s.vy<0;s.y+=s.vy;s.vy=Math.min(p.air.maxFall,s.vy+(active?Math.trunc(p.air.gravity*a.gravity.num/a.gravity.den):p.air.gravity));if(rising&&!s.jumpReleased&&old.jumpHeldPrev&&(active||!c.jump))s.jumpReleased=true;}
  }
  for(const def of defs)if(def.reset==='ground'&&s.mode==='ground')remaining[def.mode]=def.charges;
  if(active&&(blocked||active.ticksLeft===1)){events.push({tick:s.tick+1,kind:'dashStop',collision:blocked});active=null;}else if(active)active={...active,ticksLeft:active.ticksLeft-1};
  s.dash={held:c.dash??false,remaining,active};s.resources={...s.resources,dashCharges:remaining.ground+remaining.air,cooldowns:cd};
  s.tick++;s.jumpHeldPrev=c.jump;s.ticksSinceJump=s.mode==='air'?s.ticksSinceJump+1:0;if(active||a)s.facing=(old.dash.active?.direction??(c.moveX||old.facing));else if(c.moveX)s.facing=c.moveX;
  frames.push({status:'ok',state:structuredClone(s)});
 }
 return {frames,events};
}
