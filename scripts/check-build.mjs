import { readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const readAsset = (file) => {
  const path = resolve(root, file);
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error('Build path escapes dist');
  if (!statSync(path).isFile()) throw new Error(`Missing build asset: ${file}`);
  return readFileSync(path, 'utf8');
};

try {
  const html = readAsset('index.html');
  const manifest = JSON.parse(readAsset('.vite/manifest.json'));
  const entry = manifest['index.html'];
  if (!html.includes('<title>MapLab</title>') || !html.includes('<div id="root"></div>')
    || /\/src\/|localhost|https?:\/\//.test(html)) throw new Error('Production HTML identity/locality failed');
  if (!entry?.isEntry || !html.includes(entry.file)) throw new Error('Production entry is not linked');
  const js = readAsset(entry.file);
  // The static build is the library client only: it calls the dev server's loopback endpoints and says when none answers.
  if (!js.includes('MapLab') || !js.includes('/__maplab/library') || !js.includes('no MapLab library server')) {
    throw new Error('Built shell identity/library client is missing');
  }
  if (!entry.css?.length) throw new Error('Production stylesheet is missing');
  for (const css of entry.css) {
    if (!html.includes(css) || !readAsset(css).trim()) throw new Error('Production stylesheet is not linked');
  }
  for (const chunk of Object.values(manifest)) {
    readAsset(chunk.file);
    for (const file of [...(chunk.css ?? []), ...(chunk.assets ?? [])]) readAsset(file);
  }
  console.log('Build smoke passed: local production entry, linked assets, MapLab identity and library client');
} catch (error) {
  console.error(`Build smoke rejected: ${error.message}`);
  process.exitCode = 1;
}
