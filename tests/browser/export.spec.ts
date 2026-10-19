import { expect, test } from '@playwright/test';
import { readFileSync, mkdtempSync, realpathSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openEditor, openMap, rename, command, resetLibrary, placeholderUrl, repoRoot, libraryFile, writeLibraryFile } from './support';

test.beforeEach(() => resetLibrary());
test('saved export downloads identical final ZIPs and independent consumer accepts both maps', async ({ page }) => {
  await openEditor(page); await openMap(page, 'map.forest');
  const before = libraryFile('maps/forest.map.json');
  const button = page.getByRole('button', { name: 'Export saved map ZIP', exact: true });
  const download = async () => { const p = page.waitForEvent('download'); await button.click(); const d = await p; await expect(button).toBeEnabled(); return { bytes: readFileSync((await d.path())!), path: (await d.path())!, name: d.suggestedFilename() }; };
  const a = await download(), b = await download(); expect(a.bytes).toEqual(b.bytes); expect(a.name).toMatch(/^maplab-[a-f0-9]{12}\.zip$/);
  expect(libraryFile('maps/forest.map.json')).toEqual(before);
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'maplab-export-browser-'));
  try {
    cpSync(join(repoRoot, 'tests/consumer/reader'), join(dir, 'reader'), { recursive: true }); cpSync(join(repoRoot, 'schemas'), join(dir, 'schemas'), { recursive: true });
    cpSync(join(repoRoot, 'tests/consumer/verify-export.py'), join(dir, 'verify-export.py'));
    const r = spawnSync('python3', [join(dir, 'verify-export.py'), '--node', process.execPath, '--reader', join(dir, 'reader/read-bundle.mjs'), '--schemas', join(dir, 'schemas'), '--self-test', a.path], { cwd: dir, encoding: 'utf8' });
    expect(r.stderr).toBe(''); expect(r.status, r.stdout).toBe(0); expect(JSON.parse(r.stdout).consumer.maps).toHaveLength(2);
    const evidence = process.env.MAPLAB_EXPORT_EVIDENCE;
    if (evidence) { const { mkdirSync, writeFileSync } = await import('node:fs'); mkdirSync(evidence, { recursive: true }); writeFileSync(join(evidence, `${test.info().project.name}.zip`), a.bytes); writeFileSync(join(evidence, `${test.info().project.name}-consumer.json`), r.stdout); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  await rename(page, 'Unsaved export guard'); await expect(button).toBeDisabled(); await expect(page.getByText('Save changes before exporting.')).toBeVisible();
  await command(page, 'Undo').click(); await expect(button).toBeEnabled();
});
test('placeholder exports through read-only storage; stale entry fails closed', async ({ page }) => {
  await openEditor(page, placeholderUrl); await openMap(page, 'map.forest');
  const p = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export saved map ZIP', exact: true }).click(); await p;
  await openEditor(page); await openMap(page, 'map.forest');
  // Outside edit after the page read its index: the guarded server must re-read the actual bytes.
  await page.route('**/__maplab/export', async (route) => {
    writeLibraryFile('maps/forest.map.json', Buffer.concat([libraryFile('maps/forest.map.json'), Buffer.from(' ')]));
    await route.continue();
  });
  await page.getByRole('button', { name: 'Export saved map ZIP', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Export', exact: true })).toContainText('saved entry map changed');
});

test('switching maps keeps one export panel and aborts an in-flight saved export', async ({ page }) => {
  await openEditor(page); await openMap(page, 'map.forest');
  for (const id of ['map.clearing', 'map.forest', 'map.clearing', 'map.forest']) {
    await openMap(page, id); await expect(page.getByRole('region', { name: 'Export', exact: true })).toHaveCount(1);
  }
  let release!: () => void;
  const intercepted = new Promise<void>((done) => { release = done; });
  await page.route('**/__maplab/export', () => { release(); });
  const failed = page.waitForEvent('requestfailed', { predicate: (r) => r.url().endsWith('/__maplab/export') });
  await page.getByRole('button', { name: 'Export saved map ZIP', exact: true }).click();
  await intercepted;
  await openMap(page, 'map.clearing');
  expect((await failed).failure()).not.toBeNull();
  await expect(page.getByRole('region', { name: 'Export', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Export saved map ZIP', exact: true })).toBeEnabled();
});
