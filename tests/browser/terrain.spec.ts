import { expect, test, type Page } from '@playwright/test';
import { command, libraryFile, openEditor, openMap, placeholderUrl, resetLibrary } from './support';

const canvas = (p: Page) => p.getByRole('group', { name: 'World canvas', exact: true });
const notice = (p: Page) => p.getByLabel('Edit notice', { exact: true });
const occupancy = (p: Page) => p.getByLabel('Terrain occupancy', { exact: true });
const tool = (p: Page, name: string) => p.getByRole('toolbar', { name: 'Terrain tool' }).getByRole('button', { name, exact: true });
const saved = () => JSON.parse(libraryFile('maps/forest.map.json').toString());
/** Physical and visual members independent of library form, which orders keys, ID-keyed records and string sets but never changes values. */
const physical = (doc: Record<string, unknown>) => JSON.stringify(['bodies', 'footholds', 'traversals', 'navigation', 'layers', 'visuals'].map((k) => doc[k]), (_, v) => {
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) return [...v].sort();
  if (Array.isArray(v)) return v.every((x) => typeof x?.id === 'string') ? [...v].sort((a, b) => (a.id < b.id ? -1 : 1)) : v;
  return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v;
});
/** Cells of a saved terrain layer as `column,row=tileId` strings. */
const cells = (doc: { terrain: { chunks: { column: number; row: number; cells: ({ tileId: string } | null)[] }[] }[] }) =>
  doc.terrain[0]!.chunks.flatMap((k) => k.cells.flatMap((c, i) => (c ? [`${k.column * 32 + (i % 32)},${k.row * 32 + Math.floor(i / 32)}=${c.tileId}`] : [])));

async function ready(p: Page, tile: string | null = 'tile.grass', url = '/'): Promise<void> {
  await openEditor(p, url); await openMap(p, 'map.forest');
  await p.getByLabel('Pick mode', { exact: true }).selectOption('Terrain');
  if (tile) await p.getByRole('button', { name: `Tile ${tile}`, exact: true }).click();
}
/** Page coordinates of a world point, from the viewport's published camera. */
async function at(p: Page, x: number, y: number) {
  await canvas(p).scrollIntoViewIfNeeded();
  const d = await canvas(p).evaluate((el) => ({ ...(el as HTMLElement).dataset }));
  const b = (await canvas(p).boundingBox())!;
  return { x: b.x + (x - Number(d.cameraX)) * Number(d.zoom), y: b.y + (y - Number(d.cameraY)) * Number(d.zoom) };
}
/** Presses at the first world point and moves through the rest; the caller releases. */
async function press(p: Page, ...points: [number, number][]): Promise<void> {
  const [first, ...rest] = points;
  const a = await at(p, ...first!); await p.mouse.move(a.x, a.y); await p.mouse.down();
  for (const q of rest) { const b = await at(p, ...q); await p.mouse.move(b.x, b.y, { steps: 5 }); }
}

test.beforeEach(async ({ page }) => {
  resetLibrary();
  await page.addInitScript(() => document.addEventListener('pointerdown', (e) => { const el = (e.target as Element).closest('[aria-label="World canvas"]'); if (el) (el as HTMLElement).dataset.testPointer = String(e.pointerId); }, true));
});

test('brush stroke previews on the overlay, commits one undo, saves cells and never changes physical source', async ({ page }) => {
  await ready(page);
  const original = libraryFile('maps/forest.map.json'), art = page.getByLabel('Art canvas', { exact: true });
  await expect(page.getByLabel('Terrain status', { exact: true })).toHaveText('Art only: tile edits never change collision, footholds or navigation.');
  const before = await art.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  await press(page, [80, 48], [400, 48]);
  await expect(canvas(page)).toHaveAttribute('data-terrain-preview', '11');
  expect(libraryFile('maps/forest.map.json')).toEqual(original);
  await page.mouse.up();
  await expect(notice(page)).toHaveText('Paint terrain'); await expect(canvas(page)).toHaveAttribute('data-terrain-preview', '0');
  await expect(occupancy(page)).toHaveText('11 painted cell(s) in 1 chunk(s) · tileset tileset.forest');
  await expect.poll(() => art.evaluate((el) => (el as HTMLCanvasElement).toDataURL())).not.toBe(before);
  // Physical overlays toggle without touching the art canvas, which now carries the tiles.
  const painted = await art.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  await page.getByText('Overlays and snap', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Collision', exact: true }).uncheck(); await page.getByRole('checkbox', { name: 'Footholds', exact: true }).uncheck();
  expect(await art.evaluate((el) => (el as HTMLCanvasElement).toDataURL())).toBe(painted);
  await command(page, 'Undo').click(); await expect(occupancy(page)).toHaveText('0 painted cell(s) in 0 chunk(s) · tileset tileset.forest');
  await expect(command(page, 'Undo')).toBeDisabled();
  await command(page, 'Redo').click(); await command(page, 'Save').click(); await expect(page.getByRole('status')).toContainText('Saved');
  const doc = saved();
  expect(cells(doc)).toEqual(Array.from({ length: 11 }, (_, i) => `${2 + i},1=tile.grass`));
  expect(physical(doc)).toBe(physical(JSON.parse(original.toString())));
});

test('Escape, pointercancel, lost capture, focus loss, resize and a secondary pointer never commit a preview', async ({ page }) => {
  await ready(page);
  await tool(page, 'Rectangle (R)').click();
  const original = libraryFile('maps/forest.map.json');
  for (const kind of ['Escape', 'pointercancel', 'lostpointercapture', 'focus', 'resize']) {
    await press(page, [48, 48], [176, 112]);
    await expect(canvas(page)).toHaveAttribute('data-terrain-preview', '15');
    if (kind === 'Escape') {
      await canvas(page).evaluate((el) => el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9999, clientX: 0, clientY: 0, bubbles: true })));
      await expect(canvas(page)).toHaveAttribute('data-terrain-preview', '15');
      await page.keyboard.press('Escape');
    } else if (kind === 'focus') await page.getByRole('searchbox', { name: 'Hierarchy search' }).focus();
    else if (kind === 'resize') await page.setViewportSize({ width: 1100, height: 800 });
    else await canvas(page).evaluate((el, type) => el.dispatchEvent(new PointerEvent(type, { pointerId: Number((el as HTMLElement).dataset.testPointer), bubbles: true })), kind);
    await expect(canvas(page)).toHaveAttribute('data-terrain-preview', '0');
    await page.mouse.up();
    await expect(command(page, 'Undo')).toBeDisabled();
    await expect(occupancy(page)).toHaveText('0 painted cell(s) in 0 chunk(s) · tileset tileset.forest');
  }
  expect(libraryFile('maps/forest.map.json')).toEqual(original);
});

test('line bounds a snapshot fill inside the map; Escape cancels a fill; each gesture is one undo', async ({ page }) => {
  await ready(page, 'tile.dirt');
  await tool(page, 'Line (L)').click();
  await press(page, [16, 336], [1264, 336]); await page.mouse.up();
  await expect(notice(page)).toHaveText('Paint terrain line'); await expect(occupancy(page)).toContainText('40 painted cell(s)');
  await page.getByRole('button', { name: 'Tile tile.grass', exact: true }).click();
  await tool(page, 'Fill (F)').click();
  await press(page, [100, 100]);
  await expect(canvas(page)).toHaveAttribute('data-terrain-preview', '400');
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(canvas(page)).toHaveAttribute('data-terrain-preview', '0'); await expect(occupancy(page)).toContainText('40 painted cell(s)');
  await press(page, [100, 100]); await page.mouse.up();
  await expect(notice(page)).toHaveText('Fill terrain'); await expect(occupancy(page)).toContainText('440 painted cell(s)');
  await press(page, [100, 500]); await page.mouse.up();
  await expect(occupancy(page)).toContainText('1000 painted cell(s)');
  await command(page, 'Undo').click(); await expect(occupancy(page)).toContainText('440 painted cell(s)');
  await command(page, 'Undo').click(); await expect(occupancy(page)).toContainText('40 painted cell(s)');
  // Erase with a stroke along the line clears exactly those cells.
  await tool(page, 'Erase (E)').click();
  await press(page, [16, 336], [1264, 336]); await page.mouse.up();
  await expect(notice(page)).toHaveText('Erase terrain'); await expect(occupancy(page)).toContainText('0 painted cell(s)');
});

test('negative cells save as negative chunks in row-then-column order', async ({ page }) => {
  await ready(page);
  await canvas(page).focus();
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp'); }
  await page.keyboard.press('r');
  await expect(tool(page, 'Rectangle (R)')).toHaveAttribute('aria-pressed', 'true');
  await press(page, [-48, -48], [16, 16]);
  await expect(canvas(page)).toHaveAttribute('data-terrain-preview', '9');
  await expect(page.getByLabel('World cursor', { exact: true })).toContainText('Cell 0, 0 (chunk 0, 0)');
  await page.mouse.up(); await expect(notice(page)).toHaveText('Paint terrain rectangle');
  await expect(occupancy(page)).toHaveText('9 painted cell(s) in 4 chunk(s) · tileset tileset.forest');
  await command(page, 'Save').click(); await expect(page.getByRole('status')).toContainText('Saved');
  const doc = saved();
  expect(doc.terrain[0].chunks.map((k: { column: number; row: number }) => [k.column, k.row])).toEqual([[-1, -1], [0, -1], [-1, 0], [0, 0]]);
  expect(cells(doc).sort()).toEqual(['-1,-1', '-1,-2', '-1,0', '-2,-1', '-2,-2', '-2,0', '0,-1', '0,-2', '0,0'].map((c) => `${c}=tile.grass`).sort());
});

test('palette offers only permitted transforms; tool keys stay with focused fields', async ({ page }) => {
  await ready(page);
  await expect(page.getByLabel('Quarter turns', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Mirror X', { exact: true })).toBeEnabled(); await expect(page.getByLabel('Mirror Y', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Tile tile.dirt', exact: true }).click();
  await expect(page.getByLabel('Quarter turns', { exact: true }).locator('option')).toHaveText(['0°', '90°', '180°', '270°']);
  await page.getByLabel('Quarter turns', { exact: true }).selectOption('1'); await page.getByLabel('Mirror Y', { exact: true }).check();
  const search = page.getByRole('searchbox', { name: 'Hierarchy search' });
  await search.focus(); await page.keyboard.press('l');
  await expect(search).toHaveValue('l'); await expect(tool(page, 'Brush (B)')).toHaveAttribute('aria-pressed', 'true');
  await press(page, [48, 48]); await page.mouse.up();
  await expect(notice(page)).toHaveText('Paint terrain');
  await command(page, 'Save').click(); await expect(page.getByRole('status')).toContainText('Saved');
  expect(saved().terrain[0].chunks[0].cells[33]).toEqual({ tileId: 'tile.dirt', quarterTurns: 1, mirrorX: false, mirrorY: true });
});

test('a read-only library refuses terrain gestures without a preview', async ({ page }) => {
  await ready(page, null, placeholderUrl);
  await expect(page.getByRole('button', { name: 'Tile tile.grass', exact: true })).toBeDisabled();
  await press(page, [80, 48], [400, 48]);
  await expect(canvas(page)).toHaveAttribute('data-terrain-preview', '0');
  await page.mouse.up();
  await expect(page.getByLabel('Terrain notice', { exact: true })).toHaveText('This document is locked for editing');
  await expect(command(page, 'Undo')).toBeDisabled();
});
