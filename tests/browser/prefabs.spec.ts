import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs'; import { join } from 'node:path';
import { command, index, libraryFile, openEditor, openMap, resetLibrary, repoRoot, saveElsewhere, sha256, writeLibraryFile } from './support';
const fixture = (p: string): Buffer => readFileSync(join(repoRoot, 'conformance/prefabs', p));
const notice = (p: Page) => p.getByLabel('Prefab notice', { exact: true });
async function ready(page: Page): Promise<void> { await openEditor(page); await openMap(page, 'map.two-placements'); await page.getByText('Prefabs', { exact: true }).click(); await page.getByLabel('Prefab template', { exact: true }).selectOption('prefab.tree-marker'); }
async function bind(page: Page): Promise<void> { await page.getByLabel('Bind prefab slot scenery', { exact: true }).selectOption('layer.world'); await page.getByLabel('Bind prefab slot actors', { exact: true }).selectOption('layer.actors'); }
async function place(page: Page): Promise<void> { await page.getByRole('button', { name: 'Place prefab', exact: true }).click(); await expect(notice(page)).toContainText('Placed'); }
async function choose(page: Page, id: string): Promise<void> { await page.getByRole('searchbox', { name: 'Hierarchy search' }).fill(id); await page.getByRole('button', { name: `Select ${id}`, exact: true }).click(); }
const saved = (): any => JSON.parse(libraryFile('maps/two-placements.map.json').toString());
test.beforeEach(() => {
  resetLibrary(); const ix = index() as any;
  for (const [input, path, kind] of [['base.map.json', 'maps/two-placements.map.json', 'map'], ['prefabs/tree-marker.prefab.json', 'prefabs/tree-marker.prefab.json', 'prefab']]) { const bytes = fixture(input!); writeLibraryFile(path!, bytes); ix.documents.push({ id: JSON.parse(bytes.toString()).id, path, kind, sha256: sha256(bytes) }); }
  const p = JSON.parse(fixture('prefabs/tree-marker.prefab.json').toString()); const asset = p.content.assets[0].path; writeLibraryFile(asset, fixture(asset)); writeLibraryFile('maplab.project.json', JSON.stringify(ix));
});
test('explicit slots, two independent placements and atomic undo/redo survive save/reopen', async ({ page }) => {
  await ready(page); await page.getByRole('button', { name: 'Place prefab', exact: true }).click(); await expect(notice(page)).toContainText('Slots require');
  await bind(page); await page.getByLabel('Prefab X', { exact: true }).fill('64'); await page.getByLabel('Prefab Y', { exact: true }).fill('320'); await place(page);
  await page.getByLabel('Prefab X', { exact: true }).fill('256'); await page.getByLabel('Mirror prefab X', { exact: true }).check(); await place(page);
  await expect(page.getByLabel('Prefab placements', { exact: true }).locator('li')).toHaveCount(2);
  await command(page, 'Undo').click(); await command(page, 'Undo').click(); await expect(page.getByLabel('Prefab placements', { exact: true }).locator('li')).toHaveCount(0); await expect(command(page, 'Save')).toBeDisabled();
  await command(page, 'Redo').click(); await command(page, 'Redo').click(); await command(page, 'Save').click(); await expect(page.getByRole('status')).toContainText('Saved');
  let m = saved(); expect(m.prefabPlacements).toHaveLength(2); expect(m.assets).toHaveLength(2); expect(new Set(m.assets.map((a: any) => a.path)).size).toBe(1);
  expect(m.bodies.find((b: any) => b.id === 'pp.prefab:body').position).toEqual([64, 320]); expect(m.entities.find((e: any) => e.id === 'pp.prefab-2:guardian').anchor.u).toBe(0.75);
  await choose(page, 'pp.prefab:trunk'); const name = page.getByRole('textbox', { name: 'Object name', exact: true }); await name.fill('Only the first tree'); await name.press('Enter');
  await command(page, 'Save').click(); await expect(page.getByRole('status')).toContainText('Saved'); m = saved(); expect(m.visuals.find((v: any) => v.id === 'pp.prefab-2:trunk').name).toBe('Tree trunk');
  await page.reload(); await openMap(page, 'map.two-placements'); await choose(page, 'pp.prefab:trunk'); await expect(page.getByRole('textbox', { name: 'Object name', exact: true })).toHaveValue('Only the first tree'); await expect(command(page, 'Undo')).toBeDisabled();
});
test('create a reusable snapshot and edit template source without propagating to placed content', async ({ page }) => {
  await ready(page); await bind(page); await place(page); await choose(page, 'pp.prefab:trunk');
  await page.getByLabel('New prefab ID', { exact: true }).fill('prefab.user-marker'); await page.getByLabel('Prefab name', { exact: true }).fill('My marker');
  await page.getByRole('button', { name: 'Create prefab from selection', exact: true }).click(); await expect(notice(page)).toContainText('Created prefab.user-marker');
  const source = JSON.parse(libraryFile('prefabs/user-marker.prefab.json').toString()); expect(source.content.visuals).toHaveLength(2); expect(source.content.assets).toHaveLength(1); expect(source.dependencies.some((d: any) => d.kind === 'prefab')).toBe(false);
  await page.getByRole('button', { name: 'Edit prefab source', exact: true }).click(); const text = page.getByRole('textbox', { name: 'Prefab source JSON', exact: true });
  const changed = JSON.parse(await text.inputValue()); changed.name = 'Edited reusable tree'; changed.content.visuals[0].name = 'New template art'; changed.content.visuals.push({ ...changed.content.visuals[0], id: 'new.art', order: 10 });
  await text.fill(JSON.stringify(changed)); await page.getByRole('button', { name: 'Save prefab source', exact: true }).click(); await expect(notice(page)).toContainText('Saved template');
  await page.getByLabel('Bind prefab slot layer.world', { exact: true }).selectOption('layer.world'); await place(page); await command(page, 'Save').click(); await expect(page.getByRole('status')).toContainText('Saved');
  const m = saved(); expect(m.visuals.find((v: any) => v.id === 'pp.prefab:trunk').name).toBe('Tree trunk'); expect(m.visuals.some((v: any) => v.id === 'pp.prefab:new.art')).toBe(false); expect(m.visuals.some((v: any) => v.id === 'pp.prefab-2:new.art')).toBe(true);
});
test('invalid nested template source refuses without disk writes or authored history changes', async ({ page }) => {
  await ready(page); const before = libraryFile('prefabs/tree-marker.prefab.json'); await page.getByRole('button', { name: 'Edit prefab source', exact: true }).click();
  const text = page.getByRole('textbox', { name: 'Prefab source JSON', exact: true }), bad = JSON.parse(await text.inputValue()); bad.dependencies.push({ id: bad.id, kind: 'prefab', path: 'prefabs/tree-marker.prefab.json', required: false });
  await text.fill(JSON.stringify(bad)); await page.getByRole('button', { name: 'Save prefab source', exact: true }).click(); await expect(notice(page)).toContainText('Nested prefab'); expect(libraryFile('prefabs/tree-marker.prefab.json')).toEqual(before); await expect(command(page, 'Undo')).toBeDisabled();
});

test('stale prefab source draft cannot overwrite a newer saved template', async ({ page }) => {
  await ready(page); await page.getByRole('button', { name: 'Edit prefab source', exact: true }).click();
  const text = page.getByRole('textbox', { name: 'Prefab source JSON', exact: true }), edited = JSON.parse(await text.inputValue());
  edited.name = 'Stale draft'; await text.fill(JSON.stringify(edited));
  const newer = JSON.parse(libraryFile('prefabs/tree-marker.prefab.json').toString()); newer.name = 'Newer external template';
  saveElsewhere('prefabs/tree-marker.prefab.json', JSON.stringify(newer));
  await page.getByRole('button', { name: 'Save prefab source', exact: true }).click(); await expect(notice(page)).toContainText('changed on disk');
  expect(JSON.parse(libraryFile('prefabs/tree-marker.prefab.json').toString()).name).toBe('Newer external template'); await expect(command(page, 'Undo')).toBeDisabled();
});
