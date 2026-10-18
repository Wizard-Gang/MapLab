// WebKit's trace snapshots of this 4,000-layer DOM take >7s each, exhausting assertion timeouts.
// Disable trace instrumentation only for this fixture; preserve every real-browser assertion.
import { expect, test, type Page } from '@playwright/test';
import hierarchies from '../../conformance/viewport/hierarchies.json' with { type: 'json' };
import { command, libraryFile, openEditor, openMap, resetLibrary, saveElsewhere } from './support';

test.use({ trace: 'off' });
test.beforeEach(() => resetLibrary());
const canvas = (page: Page) => page.getByRole('group', { name: 'World canvas', exact: true });
const state = (page: Page) => canvas(page).evaluate((el) => ({ x: Number((el as HTMLElement).dataset.cameraX), z: Number((el as HTMLElement).dataset.zoom) }));
const filled = (page: Page, name: string) => page.getByLabel(name, { exact: true }).evaluate((el) => {
  const c = el as HTMLCanvasElement;
  return c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0);
});

test('valid deep layer and entity hierarchies remain visible and responsive to viewport input', async ({ page }) => {
  const path = 'maps/forest.map.json', source = JSON.parse(libraryFile(path).toString('utf8')), f = hierarchies;
  const template = source.entities.find((e: any) => e.id === f.templateEntity);
  source.entities.push(...Array.from({ length: f.entityCount }, (_, i) => ({ ...structuredClone(template), id: `${f.entityPrefix}${i}`,
    anchor: i === f.entityCount - 1 ? { kind: 'world', point: f.terminalPoint } : { kind: 'entity', entityId: `${f.entityPrefix}${i + 1}`, point: f.entityOffset } })));
  for (const layer of source.layers) if (layer.parentId === null) layer.parentId = `${f.groupPrefix}${f.groupCount - 1}`;
  source.layers.unshift(...Array.from({ length: f.groupCount }, (_, i) => ({ id: `${f.groupPrefix}${i}`, name: `Group ${i}`, kind: 'group',
    parentId: i === 0 ? null : `${f.groupPrefix}${i - 1}`, order: 0, visible: true, opacity: 1 })));
  saveElsewhere(path, `${JSON.stringify(source, null, 2)}\n`);
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await openEditor(page); await openMap(page, 'map.forest');
  await expect.poll(() => filled(page, 'Art canvas')).toBe(true);
  const before = await state(page);
  await canvas(page).scrollIntoViewIfNeeded(); const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(Math.round(box.x + 200), Math.round(box.y + 160)); await page.mouse.wheel(40, 0);
  await expect.poll(async () => (await state(page)).x).toBeCloseTo(before.x + 40 / before.z, 6);
  await page.getByText('Overlays and snap', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Art layer Group 0', exact: true }).uncheck();
  await expect.poll(() => filled(page, 'Art canvas')).toBe(false);
  expect(await filled(page, 'Overlay canvas')).toBe(true);
  expect(errors).toEqual([]); await expect(command(page, 'Undo')).toBeDisabled();
});
