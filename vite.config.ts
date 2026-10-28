import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { maplabLibrary } from './src/library/plugin';

export default defineConfig({
  base: './',
  // The library plugin exists only on the dev server; the static build has no write endpoint (R1 C2).
  plugins: [maplabLibrary({ repoRoot: fileURLToPath(new URL('.', import.meta.url)) })],
  build: { target: 'es2023', manifest: true, rollupOptions: { input: ['index.html', 'benchmarks/editor.html'] } },
});
