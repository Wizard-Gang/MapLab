// Canvas 2D terrain drawing (adopted H3, R1 H5). Committed cells paint on the art canvas inside their tile layer's
// paint order; a gesture's affected cells paint on the overlay. Only chunks and cells inside the visible world
// rectangle are drawn, read straight from the packed store: never one DOM node per cell, never a model copy.
import type { DecodedImages } from './assets';
import { scaleOf } from './transform';
import type { Cell, Vec2 } from '../contracts';
import type { Rect } from '../contracts/common-types';
import type { CellStore } from '../domain/paint';
import { CHUNK_SIZE, unpack } from '../domain/paint';
import { cssLengthInWorld, visibleWorld, type ViewTransform } from './transform';
import type { TerrainArt, TileArt } from './scene';
import type { Grid } from '../editor/terrain';

const MISSING = '#ff4fd8';

/** Editor preview convention: mirror inside the cell, then turn clockwise on screen about its centre. */
export function cellPoints(points: readonly Vec2[], cell: Pick<Cell, 'quarterTurns' | 'mirrorX' | 'mirrorY'>): Vec2[] {
  return points.map(([u0, v0]) => {
    let u = cell.mirrorX ? 1 - u0 : u0, v = cell.mirrorY ? 1 - v0 : v0;
    for (let i = 0; i < cell.quarterTurns; i++) [u, v] = [1 - v, u];
    return [u, v];
  });
}

function drawCell(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cell: Cell | null, art: TileArt | undefined, images?: DecodedImages, scale=1): void {
  if (!art) { ctx.strokeStyle = MISSING; ctx.strokeRect(x, y, w, h); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.stroke(); return; }
  if(art.image&&images&&cell){const {asset,pivot,cellSize}=art.image,decoded=images.get(asset,scale);if(decoded){
    ctx.save();ctx.translate(x+w/2,y+h/2);ctx.scale(w,h);ctx.rotate(cell.quarterTurns*Math.PI/2);ctx.scale(cell.mirrorX?-1:1,cell.mirrorY?-1:1);ctx.translate(-0.5,-0.5);
    ctx.drawImage(decoded.source,-pivot[0]*asset.wuPerAssetUnit/cellSize[0],-pivot[1]*asset.wuPerAssetUnit/cellSize[1],asset.size[0]*asset.wuPerAssetUnit/cellSize[0],asset.size[1]*asset.wuPerAssetUnit/cellSize[1]);ctx.restore();return;
  }}
  ctx.fillStyle = art.color;
  if (!art.points || !cell) { ctx.fillRect(x, y, w, h); return; }
  const ps = cellPoints(art.points, cell);
  ctx.beginPath(); ctx.moveTo(x + ps[0]![0] * w, y + ps[0]![1] * h);
  for (const p of ps.slice(1)) ctx.lineTo(x + p[0] * w, y + p[1] * h);
  ctx.closePath(); ctx.fill();
}

const visibleRange = (g: Grid, r: Rect): [number, number, number, number] => [
  Math.floor((r[0] - g.origin[0]) / g.cellSize[0]), Math.floor((r[1] - g.origin[1]) / g.cellSize[1]),
  Math.ceil((r[0] + r[2] - g.origin[0]) / g.cellSize[0]), Math.ceil((r[1] + r[3] - g.origin[1]) / g.cellSize[1]),
];

/** Committed cells of one terrain layer, culled to the visible chunks and cells. Returns the cells drawn. */
export function drawTerrain(ctx: CanvasRenderingContext2D, t: TerrainArt, view: ViewTransform, size: Vec2, images?: DecodedImages): number {
  // Tile visuals may overhang their cell (pivot/asset scale). Expand the query by the largest possible
  // quarter-turn/mirror footprint so an offscreen cell's visible art is never omitted.
  let reach = 1;
  for (const art of t.tiles.values()) {
    if(art.image){const {asset,pivot,cellSize}=art.image;reach=Math.max(reach,...([0,1] as const).flatMap(i=>[Math.abs(pivot[i]*asset.wuPerAssetUnit/cellSize[i]),Math.abs((asset.size[i]-pivot[i])*asset.wuPerAssetUnit/cellSize[i])]));}
    for(const p of art.points??[])reach=Math.max(reach,Math.abs(p[0]),Math.abs(p[1]));
  }
  const rect=visibleWorld(view,size),pad=(Math.ceil(reach)+1)*Math.max(...t.grid.cellSize);
  const [c0,r0,c1,r1]=visibleRange(t.grid,[rect[0]-pad,rect[1]-pad,rect[2]+2*pad,rect[3]+2*pad]),[w,h]=t.grid.cellSize;
  let drawn = 0;
  ctx.lineWidth = cssLengthInWorld(view, 1);
  for (const [key, cells] of t.cells.chunks) {
    const [cc, cr] = key.split(',').map(Number) as [number, number];
    if (cc * CHUNK_SIZE > c1 || (cc + 1) * CHUNK_SIZE <= c0 || cr * CHUNK_SIZE > r1 || (cr + 1) * CHUNK_SIZE <= r0) continue;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i]!;
      if (v === 0) continue;
      const c = cc * CHUNK_SIZE + (i % CHUNK_SIZE), r = cr * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
      if (c < c0 || c > c1 || r < r0 || r > r1) continue;
      const cell = unpack(t.cells.tiles.ids, v)!;
      drawCell(ctx, t.grid.origin[0] + c * w, t.grid.origin[1] + r * h, w, h, cell, t.tiles.get(cell.tileId),images,scaleOf(view));
      drawn++;
    }
  }
  return drawn;
}

/** A gesture's affected cells over everything: translucent tile art, or a red cross to erase. Returns the cells drawn. */
export function drawPreview(ctx: CanvasRenderingContext2D, p: { readonly grid: Grid; readonly value: Cell | null; readonly xs: readonly number[]; readonly ys: readonly number[]; readonly count: number; readonly outline?: boolean },
  art: TileArt | undefined, view: ViewTransform, size: Vec2): number {
  const [c0, r0, c1, r1] = visibleRange(p.grid, visibleWorld(view, size)), [w, h] = p.grid.cellSize;
  let drawn = 0;
  ctx.save(); ctx.globalAlpha = 0.6; ctx.lineWidth = cssLengthInWorld(view, 1);
  for (let i = 0; i < p.count; i++) {
    const c = p.xs[i]!, r = p.ys[i]!;
    if (c < c0 || c > c1 || r < r0 || r > r1) continue;
    const x = p.grid.origin[0] + c * w, y = p.grid.origin[1] + r * h;
    if (p.outline) { /* A transform previews its region only: the turned art appears on commit. */ }
    else if (p.value) drawCell(ctx, x, y, w, h, p.value, art);
    else { ctx.strokeStyle = '#ff8c88'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); ctx.stroke(); }
    ctx.strokeStyle = '#ffffff'; ctx.strokeRect(x, y, w, h);
    drawn++;
  }
  ctx.restore();
  return drawn;
}
