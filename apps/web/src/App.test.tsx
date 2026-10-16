import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App';
import { Providers } from './app/Providers';
import { MemoryRouter } from './app/router';
import type { VaultState } from './app/vault';

function render(path: string, initialVault?: VaultState): string {
  return renderToStaticMarkup(
    <MemoryRouter initialPath={path}>
      {initialVault ? (
        <Providers initialVault={initialVault}>
          <App />
        </Providers>
      ) : (
        <Providers>
          <App />
        </Providers>
      )}
    </MemoryRouter>,
  );
}

function heading(html: string): string | undefined {
  return /<h1[^>]*>(.*?)<\/h1>/s.exec(html)?.[1]?.replace(/<[^>]+>/g, '');
}

describe('App', () => {
  it.each([
    ['/', 'A private placefor the two of you.'],
    ['/signup', 'Create your vault'],
    ['/signup/recovery-key', 'Save your recovery key'],
    ['/login', 'Welcome back'],
    ['/unlock', 'Welcome back, Deepu'],
    ['/recover', 'Recover your vault'],
    ['/pair', 'Invite your partner'],
    ['/photos', 'Our photos'],
    ['/albums', 'Albums'],
    ['/albums/kyoto', 'Kyoto in autumn'],
    ['/albums/missing', 'Album not found'],
    ['/favorites', 'Favorites'],
    ['/settings', 'Settings'],
    ['/nowhere', 'This page wandered off'],
  ])('renders %s', (path, title) => {
    expect(heading(render(path))).toBe(title);
  });

  it('opens a photo with its details', () => {
    const html = render('/photos/p006');
    expect(html).toContain('Kyoto, Japan');
    expect(html).toContain('aria-label="Next photo"');
  });

  it('shows empty states for an empty vault', () => {
    const empty: VaultState = { photos: [], albums: [] };
    expect(render('/photos', empty)).toContain('Your vault is ready');
    expect(render('/favorites', empty)).toContain('No favorites yet');
    expect(render('/photos/p001', empty)).toContain('isn&#x27;t in your vault anymore');
  });

  it('never renders a shared header without the encryption badge', () => {
    expect(render('/photos')).toContain('End-to-end encrypted');
  });
});
