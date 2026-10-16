import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('App', () => {
  it('renders the app name', () => {
    expect(renderToStaticMarkup(<App />)).toContain('<h1>Twofold</h1>');
  });
});
