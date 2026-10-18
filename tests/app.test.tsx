import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/app/App';

test('the shell renders MapLab identity and waits for the library before showing documents', () => {
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain('<h1>MapLab</h1>');
  expect(html).toContain('No library');
  expect(html).toContain('<p role="status" class="status">Connecting to the library…</p>');
  expect(html).toContain('Open a map from the library.');
  expect(html).not.toContain('Save');
});
