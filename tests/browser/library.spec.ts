// ML-009 acceptance in real WebKit and Chromium (R1 I3): Save through the loopback plugin, reopen, conflicts, backups,
// torn-save recovery, drafts, Save As, New map, Revert, the placeholder library and cross-origin refusal.
import { expect, test } from '@playwright/test';
import {
  backups, command, fileIds, index, libraryFile, nameField, openEditor, openMap, placeholder, placeholderUrl, rename, resetLibrary, sha256, shownIds, status, writeLibraryFile,
} from './support';

const FOREST = 'maps/forest.map.json';
const CLEARING = 'maps/clearing.map.json';
const metadataName = (path: string, dir?: string): string => JSON.parse(libraryFile(path, dir).toString('utf8')).metadata.name;

test.beforeEach(() => resetLibrary());

test('two maps save together and reopen with every persistent ID intact', async ({ page }) => {
  const forestIds = fileIds(FOREST), clearingIds = fileIds(CLEARING);
  await openEditor(page);
  await openMap(page, 'map.forest');
  expect(await shownIds(page)).toEqual(forestIds);
  await rename(page, 'Forest, renamed');
  await openMap(page, 'map.clearing');
  await rename(page, 'Clearing, renamed');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(status(page)).toContainText(/^Saved maps\/forest\.map\.json, maps\/clearing\.map\.json to /);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect([metadataName(FOREST), metadataName(CLEARING)]).toEqual(['Forest, renamed', 'Clearing, renamed']);
  expect(index().documents.find((d) => d.id === 'map.forest')?.sha256).toBe(sha256(libraryFile(FOREST)));

  await page.reload();
  await openMap(page, 'map.forest');
  await expect(nameField(page)).toHaveValue('Forest, renamed');
  expect(await shownIds(page)).toEqual(forestIds);
  await openMap(page, 'map.clearing');
  await expect(nameField(page)).toHaveValue('Clearing, renamed');
  expect(await shownIds(page)).toEqual(clearingIds);
  expect([fileIds(FOREST), fileIds(CLEARING)]).toEqual([forestIds, clearingIds]);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
});

test('a stale base digest conflict refuses the save and writes nothing', async ({ page }) => {
  await openEditor(page);
  await openMap(page, 'map.forest');
  await rename(page, 'Edited in MapLab');
  const outside = libraryFile(FOREST).toString('utf8').replace('"Forest acceptance world"', '"Edited outside MapLab"');
  writeLibraryFile(FOREST, outside);
  await command(page, 'Save').click();
  await expect(status(page)).toContainText('Save refused: a file changed on disk since it was opened. Nothing was written.');
  await expect(page.getByRole('group', { name: 'Conflict' })).toBeVisible();
  expect(libraryFile(FOREST).toString('utf8')).toBe(outside);
  expect(backups()).toEqual([]);
  await page.getByRole('button', { name: 'Reload from disk' }).click();
  await expect(nameField(page)).toHaveValue('Edited outside MapLab');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
});

test('a save backs up the replaced bytes before it replaces them', async ({ page }) => {
  const before = libraryFile(FOREST), indexBefore = libraryFile('maplab.project.json');
  await openEditor(page);
  await openMap(page, 'map.forest');
  await rename(page, 'Backed up');
  await command(page, 'Save').click();
  await expect(status(page)).toContainText('Saved maps/forest.map.json');
  const [stamp] = backups();
  expect(stamp).toMatch(/^\d{8}T\d{9}Z-[0-9a-f]{8}$/);
  expect(libraryFile(`backups/${stamp}/${FOREST}`)).toEqual(before);
  expect(libraryFile(`backups/${stamp}/maplab.project.json`)).toEqual(indexBefore);
  expect(metadataName(FOREST)).toBe('Backed up');
});

test('a torn save is detected from the index digests and resolved only as the user chooses', async ({ page }) => {
  // What an interrupted save leaves: backups written and documents renamed into place, but no new index.
  const forest = libraryFile(FOREST), clearing = libraryFile(CLEARING);
  writeLibraryFile(`backups/20261018T000000000Z-0000torn/${FOREST}`, forest);
  writeLibraryFile(FOREST, forest.toString('utf8').replace('"Forest acceptance world"', '"Half-saved forest"'));
  writeLibraryFile(CLEARING, clearing.toString('utf8').replace('"Clearing destination"', '"Half-saved clearing"'));
  await openEditor(page);
  await expect(page.getByRole('button', { name: 'Open map.forest' })).toBeDisabled();
  await expect(page.getByRole('group', { name: 'Torn map.forest' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore backup map.clearing' })).toBeDisabled();
  await page.getByRole('button', { name: 'Restore backup map.forest' }).click();
  await expect(status(page)).toContainText('maps/forest.map.json: restored from the newest matching backup');
  expect(libraryFile(FOREST)).toEqual(forest);
  await page.getByRole('button', { name: 'Keep file map.clearing' }).click();
  await expect(status(page)).toContainText('maps/clearing.map.json: kept the file and updated the index');
  expect(index().documents.find((d) => d.id === 'map.clearing')?.sha256).toBe(sha256(libraryFile(CLEARING)));
  await openMap(page, 'map.clearing');
  await expect(nameField(page)).toHaveValue('Half-saved clearing');
});

test('a wrong Origin is refused and the placeholder library is read-only', async ({ page }) => {
  const placeholderForest = libraryFile(FOREST, placeholder);
  await openEditor(page, placeholderUrl);
  await expect(page.getByText('placeholder library · read-only')).toBeVisible();
  await openMap(page, 'map.forest');
  await expect(page.getByText(/^Read-only: placeholder library is read-only/)).toBeVisible();
  await expect(nameField(page)).toBeDisabled();
  const text = libraryFile(FOREST, placeholder).toString('utf8');
  const direct = await page.evaluate(async (body) => {
    const r = await fetch('/__maplab/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    return [r.status, (await r.json()).code];
  }, JSON.stringify({ documents: [{ id: 'map.forest', kind: 'map', text, baseDigest: sha256(text) }] }));
  expect(direct).toEqual([403, 'library.read-only']);
  // This page's origin (port 5192) tries to write the writable library on port 5191.
  const before = libraryFile(FOREST);
  const crossOrigin = await page.evaluate(async (body) => {
    const out: (number | string)[] = [];
    for (const type of ['text/plain', 'application/json']) {
      try {
        const r = await fetch('http://127.0.0.1:5191/__maplab/save', { method: 'POST', headers: { 'Content-Type': type }, body });
        out.push(r.status, (await r.json()).code);
      } catch { out.push('blocked'); }
    }
    return out;
  }, JSON.stringify({ documents: [{ id: 'map.forest', kind: 'map', text, baseDigest: sha256(text) }] }));
  expect(crossOrigin).toEqual([403, 'guard.origin', 403, 'guard.origin']);
  expect(libraryFile(FOREST)).toEqual(before);
  expect(libraryFile(FOREST, placeholder)).toEqual(placeholderForest);
});

test('an unsaved edit survives a reload as a draft that is restored or discarded, never treated as saved', async ({ page }) => {
  await openEditor(page);
  await openMap(page, 'map.forest');
  await rename(page, 'Draft forest');
  await expect(page.getByText('Draft kept in this browser')).toBeVisible();
  await page.reload();
  await openMap(page, 'map.forest');
  const draft = page.getByRole('group', { name: 'Draft' });
  await expect(draft).toContainText('Unsaved draft from');
  await expect(nameField(page)).toHaveValue('Forest acceptance world');
  await draft.getByRole('button', { name: 'Restore draft' }).click();
  await expect(nameField(page)).toHaveValue('Draft forest');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  expect(metadataName(FOREST)).toBe('Forest acceptance world');
  await command(page, 'Save').click();
  await expect(status(page)).toContainText('Saved maps/forest.map.json');
  await page.reload();
  await openMap(page, 'map.forest');
  await expect(page.getByRole('group', { name: 'Draft' })).toHaveCount(0);

  await rename(page, 'Second draft');
  await expect(page.getByText('Draft kept in this browser')).toBeVisible();
  await page.reload();
  await openMap(page, 'map.forest');
  await page.getByRole('group', { name: 'Draft' }).getByRole('button', { name: 'Discard draft' }).click();
  await expect(status(page)).toContainText('Draft discarded');
  await expect(nameField(page)).toHaveValue('Draft forest');
  await page.reload();
  await openMap(page, 'map.forest');
  await expect(page.getByRole('group', { name: 'Draft' })).toHaveCount(0);
});

test('Save As writes a new identity and New map writes a valid new map', async ({ page }) => {
  const forestIds = fileIds(FOREST), forest = libraryFile(FOREST);
  await openEditor(page);
  await openMap(page, 'map.forest');
  await page.getByText('Save As / Duplicate…').click();
  const saveAs = page.getByRole('form', { name: 'Save As' });
  await saveAs.getByLabel('New map ID').fill('map.forest-copy');
  await saveAs.getByLabel('New map name').fill('Forest copy');
  await saveAs.getByRole('button', { name: 'Save copy' }).click();
  await expect(status(page)).toContainText('Saved maps/forest-copy.map.json');
  expect(fileIds('maps/forest-copy.map.json')).toEqual(forestIds);
  expect(metadataName('maps/forest-copy.map.json')).toBe('Forest copy');
  expect(libraryFile(FOREST)).toEqual(forest);
  expect(index().documents.map((d) => d.id)).toContain('map.forest-copy');

  await page.getByText('New map', { exact: true }).click();
  const form = page.getByRole('form', { name: 'New map' });
  await form.getByLabel('Map ID').fill('map.meadow');
  await form.getByLabel('New map name').fill('Meadow');
  await form.getByRole('button', { name: 'Create map' }).click();
  await expect(page.getByRole('region', { name: 'Document map.meadow' })).toContainText('Unsaved changes');
  await command(page, 'Save').click();
  await expect(status(page)).toContainText('Saved maps/meadow.map.json');
  expect(metadataName('maps/meadow.map.json')).toBe('Meadow');
  await page.reload();
  await openMap(page, 'map.meadow');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
});

test('Revert asks first, then restores the saved content with a fresh history', async ({ page }) => {
  await openEditor(page);
  await openMap(page, 'map.forest');
  await rename(page, 'About to revert');
  await command(page, 'Revert…').click();
  await page.getByRole('group', { name: 'Confirm revert' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(nameField(page)).toHaveValue('About to revert');
  await command(page, 'Revert…').click();
  await page.getByRole('button', { name: 'Revert to saved' }).click();
  await expect(nameField(page)).toHaveValue('Forest acceptance world');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(command(page, 'Undo')).toBeDisabled();
});

test('dirty state compares digests: renaming back to the saved name is clean again', async ({ page }) => {
  await openEditor(page);
  await openMap(page, 'map.forest');
  await rename(page, 'Temporary');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await rename(page, 'Forest acceptance world');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(command(page, 'Save')).toBeDisabled();
  await command(page, 'Undo').click();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
});
