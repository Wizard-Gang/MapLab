import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { Rect, Vec2 } from '../src/contracts/common-types';
import { validateSourceGraph, type JsonValue } from '../src/contracts';
import { encode, normalize } from '../src/domain/model';
import { isDirty, openDocument } from '../src/editor/history';
import { OVERLAYS, ViewportSession } from '../src/editor/viewport';
import { buildScene } from '../src/render/scene';
import { backingSize, canvasMatrix, cssToWorld, fitBounds, floorDiv, panBy, quantize, resizeView, snapWorld, worldToCss, zoomAt, type ViewTransform } from '../src/render/transform';
import coordinates from '../conformance/viewport/coordinates.json';
import snap from '../conformance/viewport/snap.json';
import gesture from '../conformance/viewport/gesture.json';
import fixtures from '../conformance/viewport/cases.json';
import hierarchies from '../conformance/viewport/hierarchies.json';

const pair = (a: readonly number[], b: readonly number[]): void => a.forEach((n, i) => expect(n).toBeCloseTo(b[i]!, 8));
const root = new URL('../', import.meta.url);
const model = () => { const r = normalize(JSON.parse(readFileSync(new URL(fixtures.base.path, root), 'utf8')) as JsonValue); if (!r.ok) throw new Error('fixture failed'); return r.model; };

describe('owned viewport fixture conformance', () => {
  test('all source and fixture digests match', () => {
    const digest = (path: string) => createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex');
    expect(digest(fixtures.base.path)).toBe(fixtures.base.sha256);
    for (const [file, sha] of Object.entries(fixtures.files)) expect(digest(`conformance/viewport/${file}`)).toBe(sha);
  });
  test('DPR affects only the buffer, signed CSS and canvas matrix share one transform', () => {
    const view = coordinates.view as unknown as ViewTransform, world = coordinates.world as unknown as Vec2, size = coordinates.size as unknown as Vec2;
    pair(worldToCss(view, world), coordinates.css); pair(cssToWorld(view, coordinates.css as unknown as Vec2), world);
    coordinates.dprs.forEach((dpr, i) => {
      const buffer = backingSize(size, dpr); expect(buffer).toEqual(coordinates.backings[i]);
      const [a, b, c, d, e, f] = canvasMatrix(view, [buffer[0] / size[0], buffer[1] / size[1]]);
      pair([(a * world[0] + c * world[1] + e) / (buffer[0] / size[0]), (b * world[0] + d * world[1] + f) / (buffer[1] / size[1])], coordinates.css);
    });
    const cell = coordinates.negativeCell.map((n, i) => floorDiv(n, coordinates.cellSize[i]!));
    expect(cell).toEqual(coordinates.cell); expect(cell.map((n) => floorDiv(n, 32))).toEqual(coordinates.chunk);
  });
  test('fractional signed snapping, free placement, quantum ties and invalid grid refusal', () => {
    const grid = snap.grid as unknown as Parameters<typeof snapWorld>[1];
    for (const c of snap.cases) expect(snapWorld(c.point as unknown as Vec2, grid)).toEqual(c.expect);
    expect(snapWorld(snap.free.point as unknown as Vec2, { ...grid, free: true })).toEqual(snap.free.expect);
    expect(Object.is(quantize(-0.001), -0)).toBe(false);
    for (const step of [0, -1, 0.1, Infinity, NaN]) expect(() => snapWorld([1, 2], { free: false, origin: [0, 0], spacing: [step, 1] })).toThrow();
    expect(() => floorDiv(1, 0)).toThrow();
  });
  test('pan, cancel, resize and all independent toggles never change document/history', () => {
    const source = model(), before = encode(source), doc = openDocument(source, { savedDigest: 'same' });
    const s = new ViewportSession(), bounds = gesture.bounds as unknown as Rect, size = gesture.size as unknown as Vec2;
    s.resize(size, bounds); const initial = s.getSnapshot().view;
    expect(initial.zoom).toBe(2);
    s.begin(7, gesture.pointer as unknown as Vec2); s.move(8, gesture.move as unknown as Vec2); expect(s.getSnapshot().view).toBe(initial);
    s.move(7, gesture.move as unknown as Vec2); pair(s.getSnapshot().view.camera, initial.camera.map((n, i) => n + gesture.deltaWorld[i]!));
    s.cancel(8); expect(s.getSnapshot().view).not.toBe(initial); s.cancel(7); expect(s.getSnapshot().view).toBe(initial);
    s.begin(8, [0, 0]); s.move(8, [20, 10]); s.end(8); const committed = s.getSnapshot().view; s.cancel(); expect(s.getSnapshot().view).toBe(committed);
    s.resize(gesture.resize as unknown as Vec2, bounds); pair(cssToWorld(s.getSnapshot().view, [376, 198]), cssToWorld(committed, [276, 148]));
    for (const overlay of OVERLAYS) { const prior = s.getSnapshot().overlays; s.toggle(overlay); for (const key of OVERLAYS) expect(s.getSnapshot().overlays[key]).toBe(key === overlay ? !prior[key] : prior[key]); }
    expect(encode(source)).toBe(before); expect(doc.revision).toBe(0); expect(doc.past).toHaveLength(0); expect(isDirty(doc)).toBe(false);
  });
});

test('round trips and anchored zoom across coordinate/zoom extremes with independent arithmetic', () => {
  for (const zoom of [0.25, 0.5, 1, 4, 16]) for (const x of [-131072, -1024.0625, -0.0625, 0, 131072]) for (const y of [-131072, -0.0625, 131072]) {
    const view: ViewTransform = { camera: [-432.25, 789.5], origin: [17, -23], pixelsPerWU: 1.5, zoom };
    const css: Vec2 = [17 + (x + 432.25) * zoom * 1.5, -23 + (y - 789.5) * zoom * 1.5];
    pair(worldToCss(view, [x, y]), css); pair(cssToWorld(view, css), [x, y]);
    for (const z of [0.01, 0.25, 1, 16, 100]) { const at: Vec2 = [81, 43], next = zoomAt(view, at, z); pair(cssToWorld(next, at), cssToWorld(view, at)); expect(next.zoom).toBe(Math.min(16, Math.max(0.25, z))); }
    const panned = panBy(view, [-64, 100]); pair(worldToCss(panned, [x, y]), [css[0] - 64, css[1] + 100]);
  }
  const fit = fitBounds([-64, -32, 128, 64], [552, 296]); pair(worldToCss(fit, [-64, -32]), [20, 20]);
  const resized = resizeView(fit, [552, 296], [752, 396]); pair(cssToWorld(resized, [376, 198]), [0, 0]);
});

test('real source produces independent named passes, body-local geometry, normals and resolved routes', () => {
  const m = model(), before = encode(m), scene = buildScene(m);
  expect(scene.art.map((a) => a.layer.id)).toEqual(['layer.sky', 'layer.far', 'layer.near', 'layer.tiles', 'layer.world', 'layer.actors', 'layer.front']);
  for (const name of OVERLAYS.filter((n) => !['Art', 'Grid'].includes(n))) expect(scene.passes.get(name)?.length, name).toBeGreaterThan(0);
  expect(scene.passes.get('Spawns & routes')?.find((p) => p.label === 'start.player')?.points[1]).toEqual([60, 632]);
  expect(scene.passes.get('Footholds')?.[1]?.points).toEqual([[240, 640], [240, 624]]);
  expect(scene.passes.get('Navigation')?.every((p) => p.label.includes('(intent)'))).toBe(true);
  expect(encode(m)).toBe(before);
});


const sourceGraph = (): any[] => {
  const base = 'docs/specifications/2026-10-17-maplab-r1/examples/forest/';
  return ['maps/forest.map.json', 'maps/clearing.map.json', 'catalogs/core.catalog.json', 'movement/player.movement.json',
    'movement/ground.movement.json', 'movement/flyer.movement.json', 'tilesets/forest.tileset.json', 'prefabs/tree.prefab.json']
    .map((file) => JSON.parse(readFileSync(new URL(base + file, root), 'utf8')));
};
const sceneOf = (source: JsonValue) => { const normalized = normalize(source); if (!normalized.ok) throw new Error('fixture failed'); return buildScene(normalized.model); };

test('valid long entity-anchor chains preserve every marker and route endpoint; cycles terminate', () => {
  const docs = sourceGraph(), source = docs[0], f = hierarchies;
  const template = source.entities.find((e: any) => e.id === f.templateEntity);
  const chain = Array.from({ length: f.entityCount }, (_, i) => ({ ...structuredClone(template), id: `${f.entityPrefix}${i}`,
    anchor: i === f.entityCount - 1 ? { kind: 'world', point: f.terminalPoint } : { kind: 'entity', entityId: `${f.entityPrefix}${i + 1}`, point: f.entityOffset } }));
  source.entities.push(...chain);
  source.waypoints[0].anchor = { kind: 'entity', entityId: `${f.entityPrefix}0`, point: [0, 0] };
  expect(validateSourceGraph(docs).ok).toBe(true);
  const scene = sceneOf(source), markers = scene.passes.get('Spawns & routes')!;
  expect(markers.filter((p) => p.label.startsWith(f.entityPrefix))).toHaveLength(f.entityCount);
  expect(markers.find((p) => p.label === `${f.entityPrefix}0`)!.points[1]).toEqual([f.firstAnchor[0], f.firstAnchor[1]! - 8]);
  expect(markers.find((p) => p.label === 'route.ground')!.points[0]).toEqual(f.firstAnchor);
  chain.at(-1)!.anchor = { kind: 'entity', entityId: `${f.entityPrefix}0`, point: [0, 0] };
  expect(validateSourceGraph(docs).ok).toBe(false);
  expect(sceneOf(source).passes.get('Spawns & routes')!.some((p) => p.label.startsWith(f.entityPrefix))).toBe(false);
});

test('valid deep layer hierarchies retain paint order, inherited visibility/opacity without recursion', () => {
  const docs = sourceGraph(), source = docs[0], f = hierarchies;
  for (const layer of source.layers) if (layer.parentId === null) layer.parentId = `${f.groupPrefix}${f.groupCount - 1}`;
  source.layers.unshift(...Array.from({ length: f.groupCount }, (_, i) => ({ id: `${f.groupPrefix}${i}`, name: `Group ${i}`, kind: 'group',
    parentId: i === 0 ? null : `${f.groupPrefix}${i - 1}`, order: 0, visible: i !== 1, opacity: i === 2 ? 0.5 : 1 })));
  expect(validateSourceGraph(docs).ok).toBe(true);
  const scene = sceneOf(source);
  expect(scene.art).toHaveLength(f.sceneLayerCount);
  expect(scene.art.slice(0, f.groupCount).map((a) => a.layer.id)).toEqual(Array.from({ length: f.groupCount }, (_, i) => `${f.groupPrefix}${i}`));
  expect(scene.art.slice(f.groupCount).map((a) => a.layer.id)).toEqual(buildScene(model()).art.map((a) => a.layer.id));
  expect(scene.art.at(-1)!.visible).toBe(false); expect(scene.art.at(-1)!.opacity).toBe(0.5);
});
