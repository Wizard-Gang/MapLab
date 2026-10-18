// ML-010: actual WebKit/Chromium wheel, pointer capture/cancel, focus, DPR, resize and canvas pixels.
import { expect, test, type Page } from '@playwright/test';
import { command, libraryFile, nameField, openEditor, openMap, resetLibrary, saveElsewhere } from './support';

const canvas = (page: Page) => page.getByRole('group', { name: 'World canvas', exact: true });
const state = (page: Page) => canvas(page).evaluate((e) => ({ x: Number((e as HTMLElement).dataset.cameraX), y: Number((e as HTMLElement).dataset.cameraY), z: Number((e as HTMLElement).dataset.zoom), w: Number((e as HTMLElement).dataset.width), h: Number((e as HTMLElement).dataset.height) }));
const pixels = (page: Page, label: 'Art canvas' | 'Overlay canvas') => page.getByLabel(label, { exact: true }).evaluate((el) => {
  const c = el as HTMLCanvasElement, data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let hash = 0, filled = 0;
  for (let i = 0; i < data.length; i++) { hash = (Math.imul(hash, 31) + data[i]!) | 0; if (i % 4 === 3 && data[i]) filled++; }
  return { hash, filled, frames: Number(c.dataset.frames), width: c.width, height: c.height };
});
const ready = async (page: Page) => { await openEditor(page); await openMap(page, 'map.forest'); await expect.poll(async () => (await pixels(page, 'Art canvas')).filled).toBeGreaterThan(0); };
const at = async (page: Page, x = 200, y = 160) => { await canvas(page).scrollIntoViewIfNeeded(); const b = (await canvas(page).boundingBox())!; const px = Math.round(b.x + x), py = Math.round(b.y + y); return { x: px, y: py, localX: px - b.x, localY: py - b.y }; };
const tick = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

test.beforeEach(() => resetLibrary());

test('wheel pans, modifier wheel keeps the negative world point under the cursor; source stays clean', async ({ page }) => {
  // Valid signed bounds and signed shape coordinates, with an index matching the source (no torn-file shortcut).
  const source = JSON.parse(libraryFile('maps/forest.map.json').toString('utf8'));
  source.bounds = [-128, -64, 1536, 864]; source.visuals[3].transform.position = [-64, -32];
  const bytes = `${JSON.stringify(source, null, 2)}\n`; saveElsewhere('maps/forest.map.json', bytes);
  await ready(page);
  const before = await state(page), pointer = await at(page, 35, 40);
  await page.mouse.move(pointer.x, pointer.y); await page.mouse.wheel(-80, -48);
  await expect.poll(async () => (await state(page)).x).toBeCloseTo(before.x - 80 / before.z, 7);
  const pan = await state(page), world = [pan.x + pointer.localX / pan.z, pan.y + pointer.localY / pan.z];
  expect(world[0]).toBeLessThan(0); expect(world[1]).toBeLessThan(0);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -250); await page.keyboard.up('Control');
  await expect.poll(async () => (await state(page)).z).toBeGreaterThan(pan.z);
  const zoom = await state(page);
  expect(zoom.x + pointer.localX / zoom.z).toBeCloseTo(world[0]!, 6); expect(zoom.y + pointer.localY / zoom.z).toBeCloseTo(world[1]!, 6);
  await page.mouse.move(pointer.x + 1, pointer.y + 1);
  await expect(page.getByLabel('World cursor')).toContainText('Grid → 1/16 WU');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible(); await expect(command(page, 'Undo')).toBeDisabled();
  expect(libraryFile('maps/forest.map.json').toString('utf8')).toBe(bytes);
  await canvas(page).screenshot({ path: test.info().outputPath('viewport.png') });
});

test('space/middle drag captures outside the viewport; Escape, pointercancel and lost capture restore the view', async ({ page }) => {
  await ready(page); const original = await state(page), point = await at(page);
  await canvas(page).focus(); await page.keyboard.down('Space'); await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 80, point.y + 40);
  await expect.poll(async () => (await state(page)).x).toBeCloseTo(original.x - 80 / original.z, 7);
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.keyboard.up('Space');
  expect(await state(page)).toEqual(original);
  for (const event of ['pointercancel', 'lostpointercapture']) {
    await page.mouse.move(point.x, point.y); await page.mouse.down({ button: 'middle' }); await page.mouse.move(point.x + 50, point.y + 30);
    expect((await state(page)).x).not.toBe(original.x);
    await canvas(page).evaluate((el, type) => {
      // A real captured pointer ID (recorded on pointerdown), then the platform cancellation event.
      const id = (el as HTMLElement).dataset.testPointer;
      el.dispatchEvent(new PointerEvent(type, { pointerId: Number(id), bubbles: true }));
    }, event);
    await page.mouse.up({ button: 'middle' }); expect(await state(page)).toEqual(original);
  }
  // Keep the gesture alive beyond the element, then release it: pointer capture must deliver the final move/up.
  await page.mouse.move(point.x, point.y); await page.mouse.down({ button: 'middle' });
  await page.mouse.move(point.x - 250, point.y + 20); await page.mouse.up({ button: 'middle' });
  expect((await state(page)).x).toBeCloseTo(original.x + 250 / original.z, 6);
  await expect(command(page, 'Undo')).toBeDisabled();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => document.addEventListener('pointerdown', (e) => {
    const target = (e.target as Element).closest('[aria-label="World canvas"]');
    if (target) (target as HTMLElement).dataset.testPointer = String(e.pointerId);
  }, true));
});

test('focus stays with fields; viewport blur cancels pan and clears Space; wheel elsewhere leaves the camera alone', async ({ page }) => {
  await ready(page); const original = await state(page);
  await nameField(page).focus(); await page.keyboard.press('Space'); await page.keyboard.press('ArrowLeft');
  expect(await state(page)).toEqual(original);
  await nameField(page).fill('Forest acceptance world');
  const field = (await nameField(page).boundingBox())!; await page.mouse.move(field.x + 10, field.y + 10); await page.mouse.wheel(0, 100); await tick(page);
  expect(await state(page)).toEqual(original);
  const point = await at(page); await canvas(page).focus(); await page.keyboard.down('Space');
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 60, point.y + 20);
  await nameField(page).focus(); await page.keyboard.up('Space'); await page.mouse.up(); expect(await state(page)).toEqual(original);
  await canvas(page).focus(); await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 30, point.y); await page.mouse.up();
  expect(await state(page)).toEqual(original);
  await canvas(page).press('ArrowRight'); expect((await state(page)).x).toBeCloseTo(original.x + 40 / original.z, 6);
});

test('all overlay passes toggle independently in real pixels; art hiding and Physics focus preserve physical geometry', async ({ page }) => {
  await ready(page); await page.getByText('Overlays and snap', { exact: true }).click();
  const toggles = page.getByRole('group', { name: 'Overlays', exact: true }).getByRole('checkbox');
  for (const t of await toggles.all()) await t.uncheck();
  await expect.poll(async () => (await pixels(page, 'Overlay canvas')).filled).toBe(0);
  await expect.poll(async () => (await pixels(page, 'Art canvas')).filled).toBe(0);
  for (const name of ['Footholds', 'Collision', 'Traversal', 'Navigation', 'Spawns & routes', 'Regions & triggers', 'Camera', 'Audio/env zones', 'Grid', 'Bounds']) {
    const art = await pixels(page, 'Art canvas');
    await page.getByRole('checkbox', { name, exact: true }).check();
    await expect.poll(async () => (await pixels(page, 'Overlay canvas')).filled, name).toBeGreaterThan(0);
    expect(await pixels(page, 'Art canvas')).toEqual(art);
    await page.getByRole('checkbox', { name, exact: true }).uncheck();
    await expect.poll(async () => (await pixels(page, 'Overlay canvas')).filled).toBe(0);
  }
  await page.getByRole('checkbox', { name: 'Footholds', exact: true }).check(); await tick(page);
  const physical = await pixels(page, 'Overlay canvas');
  await page.getByRole('checkbox', { name: 'Art', exact: true }).check(); await tick(page);
  const art = await pixels(page, 'Art canvas'); expect(art.filled).toBeGreaterThan(0); expect(await pixels(page, 'Overlay canvas')).toEqual(physical);
  await page.getByRole('button', { name: 'Physics focus', exact: true }).click(); await tick(page);
  expect((await pixels(page, 'Art canvas')).hash).not.toBe(art.hash); expect(await pixels(page, 'Overlay canvas')).toEqual(physical);
  await page.getByRole('checkbox', { name: 'Art layer Terrain art', exact: true }).uncheck(); await tick(page);
  expect(await pixels(page, 'Overlay canvas')).toEqual(physical);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible(); await expect(command(page, 'Undo')).toBeDisabled();
});

test('resize preserves the world center and source; tab switches keep separate camera and overlay sessions', async ({ page }) => {
  await ready(page); const bytes = libraryFile('maps/forest.map.json');
  const pointer = await at(page); await page.mouse.move(pointer.x, pointer.y); await page.mouse.wheel(40, 80);
  await tick(page); const forest = await state(page);
  await page.setViewportSize({ width: 1050, height: 800 }); await tick(page);
  await expect.poll(async () => (await state(page)).w).not.toBe(forest.w);
  const resized = await state(page);
  expect(resized.x + resized.w / (2 * resized.z)).toBeCloseTo(forest.x + forest.w / (2 * forest.z), 6);
  expect(resized.y + resized.h / (2 * resized.z)).toBeCloseTo(forest.y + forest.h / (2 * forest.z), 6);
  await page.getByText('Overlays and snap', { exact: true }).click(); await page.getByRole('checkbox', { name: 'Collision', exact: true }).uncheck();
  await openMap(page, 'map.clearing'); await page.getByText('Overlays and snap', { exact: true }).click(); await expect(page.getByRole('checkbox', { name: 'Collision', exact: true })).toBeChecked();
  await page.getByRole('navigation', { name: 'Open documents' }).getByRole('button', { name: 'map.forest', exact: true }).click();
  await tick(page); expect(await state(page)).toEqual(resized);
  await page.getByText('Overlays and snap', { exact: true }).click(); await expect(page.getByRole('checkbox', { name: 'Collision', exact: true })).not.toBeChecked();
  expect(libraryFile('maps/forest.map.json')).toEqual(bytes); await expect(command(page, 'Undo')).toBeDisabled();
});

test('DPR 1/2/3 changes backing buffers only, while CSS wheel and pointer distances agree', async ({ browser, browserName }) => {
  const cameras: unknown[] = [];
  for (const deviceScaleFactor of [1, 2, 3]) {
    const context = await browser.newContext({ deviceScaleFactor, viewport: { width: 1280, height: 900 }, baseURL: 'http://127.0.0.1:5191' });
    try {
      const page = await context.newPage(); await ready(page); const initial = await state(page);
      await expect.poll(async () => (await pixels(page, 'Art canvas')).width).toBe(Math.round(initial.w * deviceScaleFactor));
      const overlay = await pixels(page, 'Overlay canvas'); expect(overlay.height).toBe(Math.round(initial.h * deviceScaleFactor));
      const p = await at(page);
      await canvas(page).evaluate((el) => el.addEventListener('wheel', (event) => {
        const e = event as WheelEvent; (el as HTMLElement).dataset.testWheelX = String(e.deltaX);
      }, { once: true }));
      await page.mouse.move(p.x, p.y);
      // Chromium's raw input protocol expresses wheel deltas in device pixels for an emulated DPR.
      const rawScale = browserName === 'chromium' ? deviceScaleFactor : 1;
      await page.mouse.wheel(48 * rawScale, 64 * rawScale);
      await expect(canvas(page)).toHaveAttribute('data-test-wheel-x', '48');
      await expect.poll(async () => (await state(page)).x).toBeCloseTo(initial.x + 48 / initial.z, 6);
      cameras.push(await state(page));
    } finally { await context.close(); }
  }
  expect(cameras[0]).toEqual(cameras[1]); expect(cameras[1]).toEqual(cameras[2]);
});


test('invalid maps keep their recovery UI and dense background repetition stays bounded', async ({ page }) => {
  const path = 'maps/forest.map.json', source = JSON.parse(libraryFile(path).toString('utf8'));
  source.visuals[0].source.shape = null;
  saveElsewhere(path, `${JSON.stringify(source, null, 2)}\n`);
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await openEditor(page); await openMap(page, 'map.forest');
  await expect(page.getByText('Viewport unavailable while this map has validation errors; see Problems.')).toBeVisible();
  await expect(nameField(page)).toBeDisabled(); expect(errors).toEqual([]);
  // A schema-valid, extremely dense repeated background must not lock the UI in a huge draw loop.
  const valid = JSON.parse(libraryFile(path).toString('utf8'));
  valid.visuals[0].source.shape = { kind: 'rect', rect: [0, 0, 640, 360] };
  valid.layers[1].repeat = 'xy'; valid.layers[1].repeatSize = [0.0625, 0.0625];
  saveElsewhere(path, `${JSON.stringify(valid, null, 2)}\n`);
  await page.reload(); await openMap(page, 'map.forest');
  await expect(page.getByLabel('Viewport notice')).toContainText('Zoom in to show tightly repeated backgrounds');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(command(page, 'Undo')).toBeDisabled(); expect(errors).toEqual([]);
});
