import type {Motion} from '../contracts/geometry-types';
import {integer} from '../physics-reference/integer';
export type Pair=readonly[number,number];
/** Points are translation offsets from the authored body origin, in WU. Quantize once to integer su. */
export function motionOffset(m:Motion,tick:number):Pair{
 integer(tick);if(tick<0)throw RangeError('Negative platform tick');
 if(m.easing!=='linear'||m.carry!=='delta'||m.points.length<2||m.points.length>256||m.legTicks.length!==m.points.length-1||m.legTicks.some(t=>!Number.isSafeInteger(t)||t<1))throw Error('Unsupported platform schedule');
 const duration=m.legTicks.reduce((a,b)=>integer(a+b),0),period=m.mode==='pingPong'?integer(duration*2):duration;
 if(!['once','loop','pingPong'].includes(m.mode)||!Number.isSafeInteger(m.initialPhaseTicks)||m.initialPhaseTicks<0||(m.mode==='once'?m.initialPhaseTicks>period:m.initialPhaseTicks>=period))throw Error('Invalid platform phase');
 if(m.mode==='loop'&&m.points[0]!.some((n,i)=>n!==m.points.at(-1)![i]))throw Error('Open platform loop');
 let phase=BigInt(tick)+BigInt(m.initialPhaseTicks);
 phase=m.mode==='once'?(phase>BigInt(duration)?BigInt(duration):phase):phase%BigInt(period);
 if(m.mode==='pingPong'&&phase>BigInt(duration))phase=BigInt(period)-phase;
 let remaining=Number(phase),leg=0;
 while(leg<m.legTicks.length-1&&remaining>=m.legTicks[leg]!){remaining-=m.legTicks[leg]!;leg++;}
 const a=m.points[leg]!,b=m.points[leg+1]!,den=BigInt(m.legTicks[leg]!);
 return [0,1].map(axis=>{
  const start=integer(a[axis]!*256),end=integer(b[axis]!*256),n=BigInt(end-start)*BigInt(remaining);
  const q=n/den-(n<0n&&n%den!==0n?1n:0n);return integer(start+Number(q));
 }) as unknown as Pair;
}
