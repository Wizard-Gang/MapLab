/** RC1: reject an inexact intermediate rather than allowing a rounded predicate. */
export function integer(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError('unsafeInteger');
  return n === 0 ? 0 : n;
}
export function floorDiv(a: number, b: number): number {
  integer(a); integer(b);
  if (b <= 0) throw new RangeError('positive divisor required');
  const q = integer(Math.trunc(a / b));
  return integer(integer(q * b) > a ? q - 1 : q);
}
export const ceilDiv = (a: number, b: number): number => integer(-floorDiv(-a, b));
export const mul = (a: number, b: number): number => integer(a * b);
export type Point = readonly [number, number];
export const cross = (a: Point, b: Point, c: Point): number => integer(mul(b[0] - a[0], c[1] - a[1]) - mul(b[1] - a[1], c[0] - a[0]));
export const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Convex hull of an edge expanded by the finite upright actor rectangle. */
export function expanded(a: Point, b: Point, half: number, height: number): Point[] {
  const points = [a, b].flatMap(([x,y]): Point[] => [[integer(x-half),y],[integer(x+half),y],[integer(x-half),integer(y+height)],[integer(x+half),integer(y+height)]]);
  points.sort((p,q) => p[0]-q[0] || p[1]-q[1]);
  const halfHull = (ps: Point[]): Point[] => {
    const h: Point[] = [];
    for (const p of ps) { while (h.length > 1 && cross(h.at(-2)!,h.at(-1)!,p) <= 0) h.pop(); h.push(p); }
    h.pop(); return h;
  };
  return [...halfHull(points),...halfHull([...points].reverse())];
}
export const strictlyInside = (p: Point, hull: readonly Point[]): boolean => hull.every((a,i) => cross(a,hull[(i+1)%hull.length]!,p)>0);

export interface Fraction {readonly num:number;readonly den:number}
/** Exact rational order by Euclidean quotients; no cross-products can overflow. */
export function fractionOrder(a:Fraction,b:Fraction):number {
  let sign=1;
  while(true){
    const aq=floorDiv(a.num,a.den),bq=floorDiv(b.num,b.den);
    if(aq!==bq)return sign*(aq<bq?-1:1);
    const ar=integer(a.num-mul(aq,a.den)),br=integer(b.num-mul(bq,b.den));
    if(ar===0||br===0)return ar===br?0:sign*(ar===0?-1:1);
    a={num:a.den,den:ar};b={num:b.den,den:br};sign=-sign;
  }
}
/** Open orthogonal cross section, retaining exact contact order before conservative rounding. */
export function section(hull: readonly Point[], fixed: number, axis: 0 | 1): {low:number;high:number;lowAt:Fraction;highAt:Fraction} | null {
  const other = axis === 0 ? 1 : 0;
  const coords = hull.map(p=>p[other]);
  if (fixed <= Math.min(...coords) || fixed >= Math.max(...coords)) return null;
  const values:Fraction[]=[];
  hull.forEach((a,i) => {
    let b=hull[(i+1)%hull.length]!;
    if (a[other]===b[other]) return;
    if(a[other]>b[other]) [a,b]=[b,a];
    if(fixed<a[other] || fixed>b[other]) return;
    const den=b[other]-a[other], num=integer(mul(a[axis],den)+mul(fixed-a[other],b[axis]-a[axis]));
    values.push({num,den});
  });
  values.sort(fractionOrder);
  const lowAt=values[0]!,highAt=values.at(-1)!;
  return {low:floorDiv(lowAt.num,lowAt.den),high:ceilDiv(highAt.num,highAt.den),lowAt,highAt};
}
