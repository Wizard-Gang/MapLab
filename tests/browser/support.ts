// Shared helpers for the WebKit and Chromium library tests: the scratch library on disk and the editor page.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const placeholder = join(repoRoot, 'placeholder-library');
export const scratch = (): string => {
  const dir = process.env.MAPLAB_E2E_LIBRARY;
  if (!dir) throw new Error('playwright.config.ts sets MAPLAB_E2E_LIBRARY');
  return dir;
};
export const placeholderUrl = 'http://127.0.0.1:5192/';

/**
 * Puts the scratch library back to the placeholder's exact bytes, in place: extra files go, folders the dev server
 * watches stay, so a recreated folder never hides a later change from the watcher.
 */
export function resetLibrary(): void {
  const dir = scratch();
  const keep = new Set<string>();
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(placeholder, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      keep.add(r);
      if (e.isDirectory()) walk(r);
    }
  };
  walk('');
  const prune = (rel: string): void => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (!keep.has(r)) rmSync(join(dir, r), { recursive: true, force: true });
      else if (e.isDirectory()) prune(r);
    }
  };
  prune('');
  cpSync(placeholder, dir, { recursive: true });
}

export const libraryFile = (path: string, dir = scratch()): Buffer => readFileSync(join(dir, path));
export function writeLibraryFile(path: string, bytes: string | Buffer, dir = scratch()): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), bytes);
}
export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
export const index = (dir = scratch()): { documents: { id: string; path: string; sha256: string }[] } => JSON.parse(libraryFile('maplab.project.json', dir).toString('utf8'));
/** What another MapLab tab's save leaves: new file bytes and an index that records them (so the file is not torn). */
export function saveElsewhere(path: string, bytes: string, dir = scratch()): void {
  writeLibraryFile(path, bytes, dir);
  const value = index(dir);
  for (const d of value.documents) if (d.path === path) d.sha256 = sha256(bytes);
  writeLibraryFile('maplab.project.json', `${JSON.stringify(value, null, 2)}\n`, dir);
}
export const backups = (dir = scratch()): string[] => (existsSync(join(dir, 'backups')) ? readdirSync(join(dir, 'backups')).sort() : []);

const COLLECTIONS = ['assets', 'presentations', 'layers', 'visuals', 'materials', 'bodies', 'footholds', 'traversals', 'regions', 'entities', 'waypoints',
  'routes', 'triggers', 'encounters', 'flags', 'prefabPlacements'];
/** Every top-level persistent ID of a map file, as sorted `collection:id` strings. */
export function fileIds(path: string, dir = scratch()): string[] {
  const doc = JSON.parse(libraryFile(path, dir).toString('utf8')) as Record<string, { id: string }[]>;
  return COLLECTIONS.flatMap((c) => (doc[c] ?? []).map((r) => `${c}:${r.id}`)).sort();
}

/** The persistent IDs the editor shows for the open document, as sorted `collection:id` strings. */
export async function shownIds(page: Page): Promise<string[]> {
  const lists = page.getByRole('region', { name: 'Objects' }).locator('ul[data-collection]');
  const out: string[] = [];
  for (const list of await lists.all()) {
    const collection = await list.getAttribute('data-collection');
    for (const id of await list.locator('code').allTextContents()) out.push(`${collection}:${id}`);
  }
  return out.sort();
}

export async function openEditor(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole('complementary', { name: 'Library' })).toBeVisible();
}

export async function openMap(page: Page, id: string): Promise<void> {
  await page.getByRole('button', { name: `Open ${id}` }).click();
  await expect(page.getByRole('region', { name: `Document ${id}` })).toBeVisible();
}

export const nameField = (page: Page) => page.getByRole('textbox', { name: 'Map name', exact: true });

export async function rename(page: Page, name: string): Promise<void> {
  const field = nameField(page);
  await field.fill(name);
  await field.press('Enter');
}

export const command = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Document commands' }).getByRole('button', { name, exact: true });
export const status = (page: Page) => page.getByRole('status');
