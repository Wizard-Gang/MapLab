import { expect, test, type Page } from '@playwright/test';
import { command, libraryFile, openEditor, openMap, resetLibrary } from './support';

const canvas = (p: Page) => p.getByRole('group', { name: 'World canvas', exact: true });
const notice = (p: Page) => p.getByLabel('Edit notice', { exact: true });
const terrainNotice = (p: Page) => p.getByLabel('Terrain notice', { exact: true });
const intent = (p: Page) => p.getByLabel('Terrain intent', { exact: true });
const tool = (p: Page, name: string) => p.getByRole('toolbar', { name: 'Terrain tool' }).getByRole('button', { name, exact: true });
type Saved = { terrain: { variationSeed: number; terrainIntent: { column: number; row: number }[]; chunks: { column: number; row: number; cells: ({ tileId: string; quarterTurns: number; mirrorX: boolean } | null)[] }[] }[] };
const saved = (): Saved => JSON.parse(libraryFile('maps/forest.map.json').toString());
/** Stored cells of the saved layer as `column,row=tileId` strings, row then column. */
const cells = (doc: Saved) => doc.terrain[0]!.chunks.flatMap((k) => k.cells.flatMap((c, i) => (c ? [{ c: k.column * 32 + (i % 32), r: k.row * 32 + Math.floor(i / 32), id: c.tileId }] : [])))
  .sort((a, b) => a.r - b.r || a.c - b.c).map((x) => `${x.c},${x.r}=${x.id}`);

async function ready(p: Page): Promise<void> {
  await openEditor(p); await openMap(p, 'map.forest');
  await p.getByLabel('Pick mode', { exact: true }).selectOption('Terrain');
}
async function terrainMode(p: Page): Promise<void> {
  await p.getByLabel('Paint mode', { exact: true }).selectOption('terrain');
  await p.getByRole('button', { name: 'Terrain terrain.forest', exact: true }).click();
}
/** One geometry snapshot for both endpoints: scrolling between projections can turn a click into a stroke. */
async function cellsDrag(p: Page, from: [number, number], to: [number, number], release = true): Promise<void> {
  const world = canvas(p);
  await world.scrollIntoViewIfNeeded();
  const { rect, cameraX, cameraY, zoom } = await world.evaluate((el) => {
    const r = el.getBoundingClientRect(), d = (el as HTMLElement).dataset;
    return { rect: { x: r.x, y: r.y }, cameraX: Number(d.cameraX), cameraY: Number(d.cameraY), zoom: Number(d.zoom) };
  });
  const at = ([c, r]: [number, number]) => ({ x: rect.x + (c * 32 + 16 - cameraX) * zoom, y: rect.y + (r * 32 + 16 - cameraY) * zoom });
  const a = at(from), b = at(to);
  await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(b.x, b.y, { steps: 5 });
  if (release) await p.mouse.up();
}
async function save(p: Page): Promise<Saved> {
  await command(p, 'Save').click(); await expect(p.getByRole('status')).toContainText('Saved');
  return saved();
}

test.beforeEach(() => resetLibrary());

test('terrain intent resolves a block to explicit tiles in one undo; Escape commits nothing', async ({ page }) => {
  await ready(page); await terrainMode(page);
  await tool(page, 'Rectangle (R)').click();
  const original = libraryFile('maps/forest.map.json');
  await cellsDrag(page, [2, 2], [11, 4], false);
  await expect(canvas(page)).toHaveAttribute('data-terrain-preview', '30');
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(command(page, 'Undo')).toBeDisabled(); expect(libraryFile('maps/forest.map.json')).toEqual(original);
  await cellsDrag(page, [2, 2], [11, 4]);
  await expect(notice(page)).toHaveText('Paint terrain rectangle');
  await expect(intent(page)).toHaveText('30 terrain intent cell(s) · rules version 1');
  const doc = await save(page);
  expect(doc.terrain[0]!.terrainIntent.map((e) => `${e.column},${e.row}`)).toEqual(Array.from({ length: 30 }, (_, i) => `${2 + (i % 10)},${2 + Math.floor(i / 10)}`));
  // rule.top (mask 124) for the inner top row, rule.fill (255) inside, the terrain's fallback elsewhere.
  expect(cells(doc).filter((x) => x.endsWith('tile.grass'))).toEqual(Array.from({ length: 8 }, (_, i) => `${3 + i},2=tile.grass`));
  expect(cells(doc).filter((x) => x.endsWith('tile.dirt'))).toHaveLength(22);
  await command(page, 'Undo').click();
  await expect(intent(page)).toHaveText('0 terrain intent cell(s) · rules version 1');
  await expect(page.getByLabel('Terrain occupancy', { exact: true })).toContainText('0 painted cell(s)');
});

test('painting one intent cell re-resolves its neighbors in the same undo step', async ({ page }) => {
  await ready(page); await terrainMode(page);
  await tool(page, 'Rectangle (R)').click(); await cellsDrag(page, [2, 2], [4, 4]);
  expect(cells(await save(page))).toContain('3,2=tile.grass');
  await tool(page, 'Brush (B)').click(); await cellsDrag(page, [3, 1], [3, 1]);
  await expect(notice(page)).toHaveText('Paint terrain');
  const after = cells(await save(page));
  expect(after).toContain('3,1=tile.dirt'); expect(after).toContain('3,2=tile.dirt');
  await command(page, 'Undo').click();
  expect(cells(await save(page))).toContain('3,2=tile.grass');
});

test('the transform tool turns permitted cells and refuses an illegal 90-degree turn whole', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Tile tile.grass', exact: true }).click();
  await tool(page, 'Brush (B)').click(); await cellsDrag(page, [5, 5], [5, 5]);
  await page.getByRole('button', { name: 'Tile tile.dirt', exact: true }).click(); await cellsDrag(page, [6, 5], [6, 5]);
  await tool(page, 'Transform').click();
  await expect(page.getByLabel('Transform kind', { exact: true })).toHaveValue('rotate');
  await cellsDrag(page, [5, 5], [6, 5], false);
  await expect(canvas(page)).toHaveAttribute('data-terrain-preview', '2');
  await page.mouse.up();
  await expect(terrainNotice(page)).toHaveText('Cell 5,5: tile.grass does not allow 1 quarter turn(s); nothing was turned');
  await expect(notice(page)).toHaveText('Paint terrain');
  await cellsDrag(page, [6, 5], [6, 5]);
  await expect(notice(page)).toHaveText('Rotate terrain cells');
  await page.getByLabel('Transform kind', { exact: true }).selectOption('mirrorX');
  await cellsDrag(page, [6, 5], [6, 5]);
  await expect(notice(page)).toHaveText('Mirror terrain cells');
  const doc = await save(page);
  expect(doc.terrain[0]!.chunks[0]!.cells[5 * 32 + 6]).toEqual({ tileId: 'tile.dirt', quarterTurns: 3, mirrorX: true, mirrorY: false });
  expect(doc.terrain[0]!.chunks[0]!.cells[5 * 32 + 5]).toEqual({ tileId: 'tile.grass', quarterTurns: 0, mirrorX: false, mirrorY: false });
});

test('literal tiles over intent clear it, and the variation seed is one undoable edit', async ({ page }) => {
  await ready(page); await terrainMode(page);
  await tool(page, 'Rectangle (R)').click(); await cellsDrag(page, [2, 2], [4, 4]);
  await page.getByLabel('Paint mode', { exact: true }).selectOption('tiles');
  await page.getByRole('button', { name: 'Tile tile.grass', exact: true }).click();
  await tool(page, 'Brush (B)').click(); await cellsDrag(page, [3, 3], [3, 3]);
  await expect(intent(page)).toHaveText('8 terrain intent cell(s) · rules version 1');
  await page.getByLabel('Paint mode', { exact: true }).selectOption('terrain');
  const seed = page.getByLabel('Variation seed', { exact: true });
  await expect(seed).toHaveValue('7');
  await seed.fill('99'); await seed.press('Enter');
  await expect(notice(page)).toHaveText('Reseed terrain variation');
  expect((await save(page)).terrain[0]!.variationSeed).toBe(99);
  await command(page, 'Undo').click();
  await expect(page.getByLabel('Variation seed', { exact: true })).toHaveValue('7');
});

// Position changes do not resize the canvas. They must discard its pointer preview just like resize does.
test('a canvas layout shift or document scroll during a stationary brush discards the whole gesture', async ({ page }) => {
  await ready(page); await terrainMode(page); await tool(page, 'Brush (B)').click();
  const original = libraryFile('maps/forest.map.json');
  for (const kind of ['layout', 'scroll']) {
    await cellsDrag(page, [3, 3], [3, 3], false);
    await expect(canvas(page)).toHaveAttribute('data-terrain-preview', '1');
    if (kind === 'layout') await canvas(page).evaluate((el) => {
      const spacer = document.createElement('div'); spacer.id = 'test-layout-shift'; spacer.style.height = '20px';
      el.before(spacer);
    });
    else await page.evaluate(() => window.scrollBy(0, 20));
    await expect(canvas(page)).toHaveAttribute('data-terrain-preview', '0');
    await page.mouse.up();
    await expect(command(page, 'Undo')).toBeDisabled();
    await expect(intent(page)).toHaveText('0 terrain intent cell(s) · rules version 1');
    expect(libraryFile('maps/forest.map.json')).toEqual(original);
    await page.evaluate(() => document.getElementById('test-layout-shift')?.remove());
  }
});

test('asynchronous draft status keeps a stationary captured brush on one cell', async ({ page }) => {
  // Keep the real journal update pending long enough to begin the next gesture, then observe its completion.
  await page.addInitScript(() => {
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => schedule(handler, timeout === 250 ? 1500 : timeout, ...args)) as typeof window.setTimeout;
  });
  await ready(page); await terrainMode(page);
  await tool(page, 'Rectangle (R)').click(); await cellsDrag(page, [2, 2], [4, 4]);
  await page.getByLabel('Paint mode', { exact: true }).selectOption('tiles');
  await page.getByRole('button', { name: 'Tile tile.grass', exact: true }).click();
  await tool(page, 'Brush (B)').click();
  const draft = page.getByText('Draft kept in this browser', { exact: true });
  await expect(draft).toBeHidden();
  await cellsDrag(page, [3, 3], [3, 3], false);
  const before = await canvas(page).boundingBox();
  await expect(draft).toBeVisible();
  expect(await canvas(page).boundingBox()).toEqual(before);
  await expect(canvas(page)).toHaveAttribute('data-terrain-preview', '1');
  await page.mouse.up();
  await expect(intent(page)).toHaveText('8 terrain intent cell(s) · rules version 1');
  await command(page, 'Undo').click();
  await expect(intent(page)).toHaveText('9 terrain intent cell(s) · rules version 1');
});
