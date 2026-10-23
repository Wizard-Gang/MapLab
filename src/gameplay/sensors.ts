// Continuous full rectangular-body sensors. Time is a float64 fraction of one resolved
// foot segment; authored/controller coordinates remain exact integer subunits.
import type {RegionShape} from '../contracts/common-types';
export interface Pose {readonly x:number;readonly y:number}
export interface Span {readonly lo:number;readonly hi:number}
type Point=readonly [number,number];
const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function triangles(points:readonly Point[]):Point[][]{
 const p=[...points],out:Point[][]=[];if(p.length>256)throw Error('sensor vertex budget');
 for(let i=p.length-1;i>=0&&p.length>3;i--)if(cross(p[(i+p.length-1)%p.length]!,p[i]!,p[(i+1)%p.length]!)===0)p.splice(i,1);
 const area=p.reduce((n,a,i)=>{const b=p[(i+1)%p.length]!;return n+a[0]*b[1]-a[1]*b[0];},0);if(area<0)p.reverse();
 while(p.length>3){let found=false;for(let i=0;i<p.length;i++){
  const a=p[(i+p.length-1)%p.length]!,b=p[i]!,c=p[(i+1)%p.length]!;if(cross(a,b,c)<=0)continue;
  if(p.some(v=>v!==a&&v!==b&&v!==c&&cross(a,b,v)>=0&&cross(b,c,v)>=0&&cross(c,a,v)>=0))continue;
  out.push([a,b,c]);p.splice(i,1);found=true;break;
 }if(!found)throw Error('unsupported sensor polygon');}out.push(p);return out;
}
function convex(p:readonly Point[],from:Pose,to:Pose,half:number,height:number):Span|null{
 const axes:Point[]=[[1,0],[0,1],...p.map((a,i)=>{const b=p[(i+1)%p.length]!;return [b[1]-a[1],a[0]-b[0]] as Point;})];let lo=-Infinity,hi=Infinity;
 for(const [nx,ny] of axes){if(nx===0&&ny===0)continue;
  // BigInt avoids overflow in projections at the source coordinate limits.
  const dot=(x:number,y:number)=>BigInt(x)*BigInt(nx)+BigInt(y)*BigInt(ny),values=p.map(v=>dot(...v));
  const min=values.reduce((a,b)=>a<b?a:b),max=values.reduce((a,b)=>a>b?a:b);
  const offsetMin=dot(nx<0?half:-half,ny<0?0:-height),offsetMax=dot(nx<0?-half:half,ny<0?-height:0);
  const start=dot(from.x,from.y),speed=dot(to.x-from.x,to.y-from.y),a=min-offsetMax-start,b=max-offsetMin-start;
  if(speed===0n){if(a>=0n||b<=0n)return null;continue;}
  const t1=Number(a)/Number(speed),t2=Number(b)/Number(speed);lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));if(lo>=hi)return null;
 }return hi>0&&lo<1?{lo,hi}:null;
}
const rect=(x:number,y:number,w:number,h:number):Point[]=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
export function sensorSpans(shape:RegionShape,from:Pose,to:Pose,width:number,height:number):Span[]{
 if(![from.x,from.y,to.x,to.y,width,height].every(Number.isSafeInteger)||width<=0||height<=0||width%2)throw Error('invalid full-body sensor pose');
 const half=width/2,spans:Span[]=[];
 const add=(s:Span|null)=>{if(s)spans.push(s);};
 if(shape.kind==='rect'){const [x,y,w,h]=shape.rect.map(n=>n*256) as [number,number,number,number];add(convex(rect(x,y,w,h),from,to,half,height));}
 else if(shape.kind==='polygon'){for(const p of triangles(shape.points.map(v=>[v[0]*256,v[1]*256]))){add(convex(p,from,to,half,height));}}
 else{
  const [cx,cy]=shape.center.map(n=>n*256) as [number,number],r=shape.radius*256;
  // Circle ⊕ reflected actor rectangle: two strips and four round corners.
  const pointRect=(x:number,y:number,w:number,h:number)=>add(convex(rect(x,y,w,h),from,to,0,0));
  pointRect(cx-half-r,cy,2*(half+r),height);pointRect(cx-half,cy-r,2*half,height+2*r);
  const dx=to.x-from.x,dy=to.y-from.y,a=dx*dx+dy*dy;
  for(const x of [cx-half,cx+half])for(const y of [cy,cy+height]){const fx=from.x-x,fy=from.y-y,c=fx*fx+fy*fy-r*r;
   if(a===0){if(c<0)add({lo:-Infinity,hi:Infinity});continue;}
   const exactA=BigInt(dx)**2n+BigInt(dy)**2n,exactB=2n*(BigInt(fx)*BigInt(dx)+BigInt(fy)*BigInt(dy)),exactC=BigInt(fx)**2n+BigInt(fy)**2n-BigInt(r)**2n,disc=exactB**2n-4n*exactA*exactC;if(disc<=0n)continue;const b=Number(exactB),root=Math.sqrt(Number(disc)),lo=(-b-root)/(2*a),hi=(-b+root)/(2*a);if(hi>0&&lo<1)add({lo,hi});
  }
 }
 spans.sort((a,b)=>a.lo-b.lo||a.hi-b.hi);const merged:Span[]=[];
 for(const s of spans){const last=merged.at(-1);if(last&&s.lo<=last.hi)merged[merged.length-1]={lo:last.lo,hi:Math.max(last.hi,s.hi)};else merged.push(s);}return merged;
}
