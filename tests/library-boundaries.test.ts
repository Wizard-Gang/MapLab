// ML-009 boundaries (adopted H1, R1 H1/H4): Node-only library modules stay on the dev server, the browser side
// never imports them, pure layers import no library code, and there is no hosted write API, picker or OPFS path.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';
import { repoRoot } from './library-support';

const files = (dir: string): string[] => readdirSync(join(repoRoot, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? files(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));
const imports = (file: string): string[] => [...readFileSync(join(repoRoot, file), 'utf8').matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+'([^']+)'/gm)].map((m) => m[1] as string);
const resolveImport = (file: string, spec: string): string => (spec.startsWith('.') ? relative(repoRoot, join(repoRoot, file, '..', spec)) : spec);
const NODE_ONLY = ['src/library/riglab', 'src/riglab/bundle', 'src/library/folder', 'src/library/writer', 'src/library/plugin', 'src/library/assets', 'src/library/export', 'src/export/bundle', 'src/export/zip'];

describe('module boundaries', () => {
  test('only the Node-only library modules import node: built-ins or vite', () => {
    const offenders = files('src').filter((f) => !NODE_ONLY.includes(f.replace(/\.tsx?$/, '')) && imports(f).some((s) => s.startsWith('node:') || s === 'vite'));
    expect(offenders).toEqual([]);
  });

  test('the browser app and its library client never reach a Node-only module', () => {
    const seen = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const spec of imports(file)) {
        if (!spec.startsWith('.')) continue;
        const target = resolveImport(file, spec);
        expect(NODE_ONLY, `${file} imports ${target}`).not.toContain(target);
        const next = [`${target}.ts`, `${target}.tsx`].find((c) => files(c.split('/').slice(0, -1).join('/')).includes(c));
        if (next) walk(next);
      }
    };
    walk('src/app/main.tsx');
    expect(seen.has('src/library/client.ts') && seen.has('src/library/drafts.ts')).toBe(true);
  });

  test('contracts, export, domain and history import no library, app or editor session code', () => {
    for (const f of [...files('src/contracts'), ...files('src/export'), ...files('src/domain'), 'src/editor/history.ts', 'src/editor/gesture.ts']) {
      for (const spec of imports(f)) expect(`${f} -> ${spec}`).not.toMatch(/-> .*\/(library|app|editor)\/|-> \.\/document$/);
    }
  });

  test('no picker, OPFS or remote write authority exists; the client posts only to its own /__maplab/ routes', () => {
    const source = files('src').map((f) => readFileSync(join(repoRoot, f), 'utf8')).join('\n');
    expect(source).not.toMatch(/showDirectoryPicker|showSaveFilePicker|showOpenFilePicker|FileSystem(?:Directory|File)?Handle|storage\.getDirectory/);
    // The browser side names no absolute URL: every request is same-origin.
    const browser = [...files('src/app'), 'src/library/client.ts', 'src/library/drafts.ts', 'src/library/protocol.ts'];
    for (const f of browser) expect(readFileSync(join(repoRoot, f), 'utf8'), f).not.toMatch(/(?:https?|wss?):\/\//);
    const client = readFileSync(join(repoRoot, 'src/library/client.ts'), 'utf8');
    const exporter = readFileSync(join(repoRoot, 'src/app/ExportPanel.tsx'), 'utf8');
    expect([...exporter.matchAll(/fetch\(([^,]+),/g)].map((m) => m[1])).toEqual(['ROUTES.export']);
    expect([...client.matchAll(/fetch\(([^,]+),/g)].map((m) => m[1])).toEqual(['route']);
    expect(readFileSync(join(repoRoot, 'src/library/protocol.ts'), 'utf8').match(/'\/__maplab\/[a-z-]+'/g)).toEqual(
      ["'/__maplab/rig-import'", "'/__maplab/rig-read'", "'/__maplab/export'", "'/__maplab/asset-import'", "'/__maplab/asset-read'", "'/__maplab/identity'", "'/__maplab/library'", "'/__maplab/read'", "'/__maplab/save'", "'/__maplab/recover'"]);
  });
});
