import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/app/App';

test('the shell exposes only MapLab identity and planning-stage status', () => {
  expect(renderToStaticMarkup(<App />)).toBe(
    '<main><h1>MapLab</h1><p>Planning stage · Foundation only</p></main>',
  );
});
