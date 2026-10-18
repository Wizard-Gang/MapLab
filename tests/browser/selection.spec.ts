// ML-011: actual Chromium/WebKit pointer, cancellation, focus and atomic history/clipboard behavior.
import { expect, test, type Page } from '@playwright/test';
import { command, libraryFile, openEditor, openMap, resetLibrary } from './support';
const canvas = (p: Page) => p.getByRole('group', { name: 'World canvas', exact: true });
const notice = (p: Page) => p.getByLabel('Edit notice', { exact: true });
const selected = (p: Page) => p.getByLabel('Selection count', { exact: true });
const property = (p: Page, name: string) => p.getByRole('spinbutton', { name: `Property ${name}`, exact: true });
const selectionCommand = (p: Page, name: string) => p.getByRole('toolbar', { name: 'Selection commands' }).getByRole('button', { name, exact: true });
const choose = async (p: Page, id: string, shift = false) => {
  const search = p.getByRole('searchbox', { name: 'Hierarchy search' }); await search.fill(id);
  await p.getByRole('button', { name: `Select ${id}`, exact: true }).click({ modifiers: shift ? ['Shift'] : [] });
};
const ready = async (p: Page) => { await openEditor(p); await openMap(p, 'map.forest'); await expect(canvas(p)).toBeVisible(); };
async function at(p: Page, x: number, y: number) {
  await canvas(p).scrollIntoViewIfNeeded();
  const view = await canvas(p).evaluate((el) => { const d = (el as HTMLElement).dataset; return { x: Number(d.cameraX), y: Number(d.cameraY), z: Number(d.zoom) }; });
  const b = (await canvas(p).boundingBox())!;
  return { x: b.x + (x - view.x) * view.z, y: b.y + (y - view.y) * view.z, z: view.z };
}
async function drag(p: Page, point: { x: number; y: number; z: number }, dx = 64, dy = -32) {
  await p.mouse.move(point.x, point.y); await p.mouse.down(); await p.mouse.move(point.x + dx * point.z, point.y + dy * point.z, { steps: 8 });
}
test.beforeEach(async ({ page }) => {
  resetLibrary();
  await page.addInitScript(() => document.addEventListener('pointerdown', (e) => { const el = (e.target as Element).closest('[aria-label="World canvas"]'); if (el) (el as HTMLElement).dataset.testPointer = String(e.pointerId); }, true));
});

test('picking filters, Shift toggle, overlap cycle and marquee leave history clean', async ({ page }) => {
  await ready(page); await page.getByLabel('Pick mode', { exact: true }).selectOption('Objects');
  let pt = await at(page, 64, 680); await page.mouse.click(pt.x, pt.y); await expect(selected(page)).toContainText('visual.west');
  pt = await at(page, 64, 680); await page.keyboard.down('Shift'); await page.mouse.click(pt.x, pt.y); await page.keyboard.up('Shift'); await expect(selected(page)).toHaveText('0 selected');
  await page.getByLabel('Pick mode', { exact: true }).selectOption('All');
  pt = await at(page, 64, 640); await page.mouse.click(pt.x, pt.y); const first = await selected(page).textContent();
  await page.keyboard.down('Alt'); await page.mouse.click(pt.x, pt.y); await page.keyboard.up('Alt'); expect(await selected(page).textContent()).not.toBe(first);
  await page.getByLabel('Pick mode', { exact: true }).selectOption('Objects');
  const start = await at(page, 16, 464), end = await at(page, 410, 532);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y); await page.mouse.up();
  await expect(selected(page)).toContainText('visual.platforms'); await expect(command(page, 'Undo')).toBeDisabled();
});

test('one mixed drag creates one undo; Escape restores preview and exact saved content', async ({ page }) => {
  await ready(page); const original = libraryFile('maps/forest.map.json');
  await choose(page, 'visual.west'); await choose(page, 'visual.front', true);
  await page.getByLabel('Pick mode', { exact: true }).selectOption('Objects');
  let pt = await at(page, 64, 680); await drag(page, pt);
  await expect(canvas(page)).toHaveAttribute('data-preview-x', '64');
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(canvas(page)).toHaveAttribute('data-preview-x', '0'); await expect(command(page, 'Undo')).toBeDisabled();
  await expect(selected(page)).toContainText('2 selected');
  pt = await at(page, 64, 680); await drag(page, pt); await page.mouse.up();
  await expect(notice(page)).toHaveText('Move objects'); await expect(command(page, 'Undo')).toBeEnabled();
  await choose(page, 'visual.west'); await expect(property(page, 'transform.position.0')).toHaveValue('64'); await expect(property(page, 'transform.position.1')).toHaveValue('608');
  await choose(page, 'visual.front'); await expect(property(page, 'transform.position.0')).toHaveValue('160');
  await command(page, 'Undo').click(); await expect(command(page, 'Undo')).toBeDisabled(); await expect(property(page, 'transform.position.0')).toHaveValue('96');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible(); expect(libraryFile('maps/forest.map.json')).toEqual(original);
  await command(page, 'Redo').click(); await expect(property(page, 'transform.position.0')).toHaveValue('160');
});

test('pointercancel, lost capture and focus loss never commit a preview', async ({ page }) => {
  await ready(page); await choose(page, 'visual.west'); await page.getByLabel('Pick mode', { exact: true }).selectOption('Objects');
  for (const type of ['pointercancel', 'lostpointercapture', 'blur']) {
    const pt = await at(page, 64, 680); await drag(page, pt);
    await expect(canvas(page)).toHaveAttribute('data-preview-x', '64');
    if (type === 'blur') await page.getByRole('searchbox', { name: 'Hierarchy search' }).focus();
    else await canvas(page).evaluate((el, event) => el.dispatchEvent(new PointerEvent(event, { pointerId: Number((el as HTMLElement).dataset.testPointer), bubbles: true })), type);
    await page.mouse.up(); await expect(canvas(page)).toHaveAttribute('data-preview-x', '0'); await expect(command(page, 'Undo')).toBeDisabled();
  }
  await choose(page, 'visual.west'); await expect(property(page, 'transform.position.0')).toHaveValue('0');
});

test('numeric inspector validates, Escape cancels field, shortcuts stay in fields, canvas press commits field first', async ({ page }) => {
  await ready(page); await choose(page, 'visual.west');
  const x = property(page, 'transform.position.0');
  await x.fill('17'); await x.press('Escape'); await expect(x).toHaveValue('0'); await expect(command(page, 'Undo')).toBeDisabled();
  await x.fill('0.01'); await x.press('Enter'); await expect(notice(page)).toContainText('Edit refused'); await expect(x).toHaveValue('0');
  await x.fill('32');
  const pt = await at(page, 64, 680); await page.mouse.click(pt.x, pt.y);
  await expect(command(page, 'Undo')).toBeEnabled();
  await choose(page, 'visual.west'); await expect(x).toHaveValue('32');
  await x.focus(); await page.keyboard.press('Control+d'); await expect(selected(page)).toContainText('1 selected');
  await x.fill('64'); await x.press('Enter'); await expect(x).toHaveValue('64');
  const search = page.getByRole('searchbox', { name: 'Hierarchy search' }); await search.fill('visual.west'); await search.press('Backspace');
  await expect(page.getByRole('group', { name: 'Delete reference report' })).toHaveCount(0);
});

test('hierarchy keyboard selection, duplicate and clipboard remapping survive undo and save', async ({ page }) => {
  await ready(page); await choose(page, 'body.west'); await choose(page, 'fh.west', true);
  await selectionCommand(page, 'Copy objects').click(); await selectionCommand(page, 'Paste objects').click();
  await expect(selected(page)).toContainText('body.west-2'); await expect(selected(page)).toContainText('fh.west-2');
  await command(page, 'Save').click(); await expect(page.getByRole('status')).toContainText('Saved');
  const saved = JSON.parse(libraryFile('maps/forest.map.json').toString('utf8'));
  expect(saved.footholds.find((f: any) => f.id === 'fh.west-2').solidEdge).toEqual({ bodyId: 'body.west-2', shapeId: 'shape.west-2', edgeIndex: 0 });
  await command(page, 'Undo').click(); await expect(command(page, 'Undo')).toBeDisabled();
  await choose(page, 'visual.west');
  await page.getByRole('button', { name: 'Select visual.west', exact: true }).focus(); await page.keyboard.press('Control+d'); await expect(selected(page)).toContainText('visual.west-2');
  await command(page, 'Undo').click();
  await page.getByRole('searchbox', { name: 'Hierarchy search' }).fill('visual.');
  const first = page.getByRole('button', { name: 'Select visual.east', exact: true }); await first.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(selected(page)).toContainText('visual.far');
});

test('delete lists dependents; cancel, explicit cascade and retarget are atomic', async ({ page }) => {
  await ready(page); await choose(page, 'region.boss-enter'); await selectionCommand(page, 'Delete objects…').click();
  const report = page.getByRole('group', { name: 'Delete reference report' }); await expect(report).toContainText('trigger.boss-enter');
  await report.getByRole('button', { name: 'Cancel deletion' }).click(); await expect(command(page, 'Undo')).toBeDisabled();
  await selectionCommand(page, 'Delete objects…').click(); await report.getByRole('button', { name: 'Preview cascade' }).click();
  await expect(report).toContainText('trigger.boss-enter'); await report.getByRole('button', { name: 'Confirm cascade deletion' }).click();
  await expect(notice(page)).toHaveText('Delete objects'); await command(page, 'Undo').click(); await expect(command(page, 'Undo')).toBeDisabled();
  await choose(page, 'region.boss-enter'); await selectionCommand(page, 'Delete objects…').click();
  await report.getByLabel('Retarget dependent references to').selectOption('region.boss'); await report.getByRole('button', { name: 'Retarget and delete' }).click();
  await expect(notice(page)).toHaveText('Delete objects'); await command(page, 'Undo').click();
  await expect(command(page, 'Undo')).toBeDisabled();
});

test('missing clipboard reference blocks paste until explicit JSON repair; tabs retain selections', async ({ page }) => {
  await ready(page); await choose(page, 'trigger.boss-enter'); await selectionCommand(page, 'Copy objects').click();
  await page.getByText('Clipboard document / explicit reference repair', { exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Clipboard document', exact: true });
  const text = await field.inputValue(); await field.fill(text.replace('region.boss-enter', 'region.missing'));
  await page.getByRole('button', { name: 'Apply clipboard document' }).click(); await expect(notice(page)).toContainText('Repair clipboard references'); await expect(command(page, 'Undo')).toBeDisabled();
  await field.fill(text.replace('region.boss-enter', 'region.boss')); await page.getByRole('button', { name: 'Apply clipboard document' }).click(); await expect(selected(page)).toContainText('trigger.boss-enter-2');
  await openMap(page, 'map.clearing'); await expect(selected(page)).toHaveText('0 selected');
  await page.getByRole('navigation', { name: 'Open documents' }).getByRole('button', { name: /^map\.forest/ }).click(); await expect(selected(page)).toContainText('trigger.boss-enter-2');
});
