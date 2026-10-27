// Exact straight-rope visibility, including the area swept between tick poses.
export type Point=readonly [number,number];
const eq=(a:Point,b:Point)=>a[0]===b[0]&&a[1]===b[1];
const cross=(a:Point,b:Point,c:Point)=>BigInt(b[0]-a[0])*BigInt(c[1]-a[1])-BigInt(b[1]-a[1])*BigInt(c[0]-a[0]);
export const onSegment=(p:Point,a:Point,b:Point)=>cross(a,b,p)===0n&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);
const opposite=(a:bigint,b:bigint)=>a===0n||b===0n||(a<0n)!==(b<0n);
/** A single contact at the physical pivot is permitted. Collinear overlap is not. */
function crosses(a:Point,b:Point,c:Point,d:Point,pivot:Point):boolean {
 const ac=cross(a,b,c),ad=cross(a,b,d),ca=cross(c,d,a),cb=cross(c,d,b);
 if(ac===0n&&ad===0n)return [a,b,c,d].some(p=>onSegment(p,a,b)&&onSegment(p,c,d)&&!eq(p,pivot));
 if(!opposite(ac,ad)||!opposite(ca,cb))return false;
 return !(onSegment(pivot,a,b)&&onSegment(pivot,c,d));
}
export interface RopeFace {readonly a:Point;readonly b:Point}
export function ropeClear(pivot:Point,from:Point,to:Point,faces:readonly RopeFace[]):boolean {
 const area=cross(pivot,from,to),inside=(p:Point)=>{const a=cross(pivot,from,p),b=cross(from,to,p),c=cross(to,pivot,p);return area>0n?a>0n&&b>0n&&c>0n:area<0n&&a<0n&&b<0n&&c<0n;};
 return !faces.some(f=>inside(f.a)||inside(f.b)||crosses(pivot,from,f.a,f.b,pivot)||crosses(from,to,f.a,f.b,pivot)||crosses(to,pivot,f.a,f.b,pivot));
}
export const squared=(x:number,y:number)=>BigInt(x)*BigInt(x)+BigInt(y)*BigInt(y);
/** Integer ceiling square root; no floating point approximation enters state. */
export function rootCeil(n:bigint):bigint {
 if(n<0n)throw Error('Negative squared length');if(n<2n)return n;
 let lo=0n,hi=1n;while(hi*hi<n)hi*=2n;
 while(lo+1n<hi){const m=(lo+hi)/2n;if(m*m<n)lo=m;else hi=m;}return hi;
}
