import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App';
import { Providers } from './app/Providers';
import { MemoryRouter } from './app/router';
import { initialVaults } from './app/vault';
import type { VaultsState } from './app/vault';

function render(path: string, initialVault?: VaultsState): string {
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
    ['/', 'Your photos.Truly private.'],
    ['/signup', 'Create your vault'],
    ['/signup/recovery-key', 'Save your recovery key'],
    ['/login', 'Welcome back'],
    ['/unlock', 'Welcome back, Deepu'],
    ['/recover', 'Recover your vault'],
    ['/photos', 'Photos'],
    ['/albums', 'Albums'],
    ['/albums/kyoto', 'Kyoto in autumn'],
    ['/albums/missing', 'Album not found'],
    ['/favorites', 'Favorites'],
    ['/settings', 'Settings'],
    ['/settings/share', 'Share your library'],
    ['/nowhere', 'This page wandered off'],
  ])('renders %s', (path, title) => {
    expect(heading(render(path))).toBe(title);
  });

  it('opens a photo with its details', () => {
    const html = render('/photos/p006');
    expect(html).toContain('Kyoto, Japan');
    expect(html).toContain('aria-label="Next photo"');
  });

  it('shows empty states for an empty library', () => {
    const empty: VaultsState = {
      ...initialVaults,
      spaces: { main: { photos: [], albums: [] }, private: { photos: [], albums: [] } },
    };
    expect(render('/photos', empty)).toContain('Your library is ready');
    expect(render('/favorites', empty)).toContain('No favorites yet');
    expect(render('/photos/p001', empty)).toContain('isn&#x27;t in your vault anymore');
  });

  it('never renders a shared header without the encryption badge', () => {
    expect(render('/photos')).toContain('End-to-end encrypted');
  });

  it('never hints at a private space from the main library', () => {
    for (const path of ['/photos', '/albums', '/favorites', '/settings', '/photos/p006']) {
      const html = render(path);
      expect(html).not.toContain('>Private<');
      expect(html).not.toContain('Keepsakes');
    }
    // Settings offers "Set up" whether or not a private space exists.
    const withSpace = render('/settings');
    const withoutSpace = render('/settings', { ...initialVaults, privatePassword: null });
    expect(withSpace).toBe(withoutSpace);
  });

  it('shows the private space when it is open', () => {
    const open: VaultsState = { ...initialVaults, space: 'private' };
    expect(heading(render('/photos', open))).toBe('Private space');
    expect(render('/photos', open)).toContain('>Private<');
    expect(render('/albums', open)).toContain('Keepsakes');
    expect(render('/albums', open)).not.toContain('Kyoto in autumn');
    expect(heading(render('/settings/share', open))).toBe('Share your private space');
  });

  it('does not mention couples or partners anywhere', () => {
    const paths = [
      '/',
      '/signup',
      '/signup/recovery-key',
      '/login',
      '/unlock',
      '/photos',
      '/settings',
    ];
    for (const path of paths) expect(render(path)).not.toMatch(/couple|partner|two of you/i);
  });
});
