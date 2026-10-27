// Independent equations for the owned rectangular wall fixture corpus only.
export function equations(map,p,initial,input,ticks){
 const a=p.abilities.find(a=>a.kind==='wall'),half=p.collider.width*128,height=p.collider.height*256;
 const bodies=map.bodies.filter(b=>b.enabled&&p.mask.includes(b.category)&&b.mask.includes(p.category)).sort((a,b)=>a.id.localeCompare(b.id));
 const rects=bodies.flatMap(b=>b.shapes.map(sh=>{if(sh.kind!=='rect')throw Error('restricted wall corpus');return {b,sh,x:(sh.rect[0]+b.position[0])*256,y:(sh.rect[1]+b.position[1])*256,w:sh.rect[2]*256,h:sh.rect[3]*256};}));
 const contact=s=>{if(s.mode!=='air')return null;for(const r of rects){if(s.y<=r.y||s.y-height>=r.y+r.h||map.materials.find(m=>m.id===r.b.materialId)?.tags.some(t=>p.forbiddenMaterialTags.includes(t)))continue;const side=s.x+half===r.x?1:s.x-half===r.x+r.w?-1:0;if(side)return {bodyId:r.b.id,shapeId:r.sh.id,edgeIndex:side===1?3:1,side};}return null;};
 const approach=(v,t,amount)=>v<t?Math.min(v+amount,t):Math.max(v-amount,t),frames=[];let s=structuredClone(initial);
 for(let n=0;n<ticks;n++){
  const old=structuredClone(s),c=input.filter(c=>c.fromTick<=old.tick).at(-1),wall=contact(old);let action=null,stamina=old.mode==='ground'?a.staminaTicks:old.wall.staminaTicks;
  if(wall&&stamina>0){if(c.jump&&!old.jumpHeldPrev&&a.permissions.includes('jump'))action='wallJump';else if(c.moveX===wall.side&&c.moveY!==0&&a.permissions.includes('climb'))action='wallClimb';else if(c.moveX===wall.side&&old.vy>=0&&a.permissions.includes('slide'))action='wallSlide';}
  if(action){stamina--;s.vx=action==='wallJump'?-wall.side*a.jumpImpulse[0]:0;s.vy=action==='wallJump'?a.jumpImpulse[1]:action==='wallClimb'?c.moveY*a.climbSpeed:Math.min(old.vy,a.slideMaxSpeed);}
  else s.vx=approach(old.vx,c.moveX*p.air.maxSpeed,p.air.acceleration);
  const direction=action==='wallJump'?-wall.side:action?0:c.moveX;if(direction)s.facing=direction;
  const dx=s.vx;let x=s.x+dx;
  for(const r of rects)if(old.y>r.y&&old.y-height<r.y+r.h){if(dx>0&&old.x+half<=r.x&&x+half>=r.x)x=Math.min(x,r.x-half);if(dx<0&&old.x-half>=r.x+r.w&&x-half<=r.x+r.w)x=Math.max(x,r.x+r.w+half);}
  if(x!==s.x+dx)s.vx=0;s.x=x;const vy=s.vy;let y=s.y+vy,land=null,ceiling=false;
  if(vy>=0){for(const f of map.footholds)if(f.enabled&&s.x-half>=f.a[0]*256&&s.x+half<=f.b[0]*256&&old.y<=f.a[1]*256&&y>=f.a[1]*256&&(!land||f.a[1]<land.a[1]))land=f;if(land){y=land.a[1]*256;s.vy=0;s.mode='ground';s.supportId=land.id;}}
  else for(const r of rects)if(s.x+half>r.x&&s.x-half<r.x+r.w&&old.y-height>=r.y+r.h&&y-height<=r.y+r.h){y=Math.max(y,r.y+r.h+height);ceiling=true;s.vy=0;}
  s.y=y;
  if(s.mode==='air'){const rising=s.vy<0;s.vy=Math.min(p.air.maxFall,s.vy+(action&&action!=='wallJump'?0:p.air.gravity));if(rising&&action==='wallClimb')s.jumpReleased=true;else if(rising&&!action&&old.jumpHeldPrev&&!c.jump)s.jumpReleased=true;}
  if(action==='wallJump'){s.jumpReleased=false;s.ticksSinceJump=0;}
  s.tick++;s.jumpHeldPrev=c.jump;s.ticksSinceJump=s.mode==='air'?s.ticksSinceJump+1:0;
  s.wall={staminaTicks:s.mode==='ground'?a.staminaTicks:stamina,launched:s.mode!=='ground'&&(old.wall.launched||action==='wallJump'),contact:contact(s),action};
  frames.push({status:'ok',state:structuredClone(s)});
 }
 return frames;
}
