import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App';
import type { AccountState } from './app/account';
import { Providers } from './app/Providers';
import { MemoryRouter } from './app/router';
import { emptyVaults, mockVaults } from './app/vault';
import type { VaultsState } from './app/vault';
import {
  lockedAccount,
  mainSession,
  privateSession,
  signedOut,
  testAccount,
} from './test/sessions';

function render(
  path: string,
  account: AccountState = mainSession(),
  vault: VaultsState = mockVaults,
): string {
  return renderToStaticMarkup(
    <MemoryRouter initialPath={path}>
      <Providers initialAccount={account} initialVault={vault}>
        <App />
      </Providers>
    </MemoryRouter>,
  );
}

function heading(html: string): string | undefined {
  return /<h1[^>]*>(.*?)<\/h1>/s.exec(html)?.[1]?.replace(/<[^>]+>/g, '');
}

describe('App', () => {
  it.each([
    ['/photos', 'Photos'],
    ['/albums', 'Albums'],
    ['/albums/kyoto', 'Kyoto in autumn'],
    ['/albums/missing', 'Album not found'],
    ['/favorites', 'Favorites'],
    ['/settings', 'Settings'],
    ['/settings/share', 'Share your library'],
    ['/nowhere', 'This page wandered off'],
  ])('renders %s when unlocked', (path, title) => {
    expect(heading(render(path))).toBe(title);
  });

  it.each([
    ['/', 'Your photos.Truly private.'],
    ['/signup', 'Create your vault'],
    ['/login', 'Welcome back'],
    ['/recover', 'Recover your vault'],
  ])('renders %s when signed out', (path, title) => {
    expect(heading(render(path, signedOut))).toBe(title);
  });

  it('greets a locked account by name on the unlock screen', () => {
    const html = render('/unlock', lockedAccount);
    expect(heading(html)).toBe('Welcome back, Sam');
    expect(html).toContain('sam@example.com');
  });

  it('shows a new recovery key screen from the main library only', () => {
    expect(heading(render('/signup/recovery-key'))).toBe('Save your recovery key');
    expect(heading(render('/signup/recovery-key', privateSession()))).toBeUndefined();
  });

  it.each([
    ['/photos', signedOut],
    ['/settings', lockedAccount],
    ['/unlock', signedOut],
    ['/login', mainSession()],
    ['/signup/recovery-key', signedOut],
  ])('redirects instead of rendering %s', (path, account) => {
    expect(heading(render(path, account))).toBeUndefined();
  });

  it('renders nothing while it checks for a session', () => {
    expect(heading(render('/photos', { status: 'loading' }))).toBeUndefined();
  });

  it('opens a photo with its details', () => {
    const html = render('/photos/p006');
    expect(html).toContain('Kyoto, Japan');
    expect(html).toContain('aria-label="Next photo"');
  });

  it('shows empty states for an empty library', () => {
    const empty = emptyVaults;
    expect(render('/photos', mainSession(), empty)).toContain('Your library is ready');
    expect(render('/favorites', mainSession(), empty)).toContain('No favorites yet');
    expect(render('/photos/p001', mainSession(), empty)).toContain(
      'isn&#x27;t in your vault anymore',
    );
  });

  it('offers picking photos one by one and a whole month at a time', () => {
    const html = render('/photos');
    expect(html).toContain('>Select<');
    expect(html).toContain('aria-label="Select all of October 2026"');
    expect(html).toMatch(/aria-label="Select photo from [^"]+" aria-pressed="false"/);
    expect(render('/favorites')).toContain('>Select<');
    expect(render('/albums/kyoto')).toContain('>Select<');
  });

  it('offers actions on every album', () => {
    expect(render('/albums/kyoto')).toContain('aria-label="Actions for Kyoto in autumn"');
    expect(render('/albums')).toContain('aria-label="Actions for Lisbon weekend"');
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
    // Settings offers "Set up" whether or not the private slot is in use.
    const withSpace = render('/settings', mainSession(testAccount('D'.repeat(118))));
    const withoutSpace = render('/settings', mainSession(testAccount('E'.repeat(118))));
    expect(withSpace).toBe(withoutSpace);
    expect(withSpace).toContain('Set up');
  });

  it('shows the private space when it is open', () => {
    const open = privateSession();
    expect(heading(render('/photos', open))).toBe('Private space');
    expect(render('/photos', open)).toContain('>Private<');
    expect(render('/albums', open)).toContain('Keepsakes');
    expect(render('/albums', open)).not.toContain('Kyoto in autumn');
    expect(heading(render('/settings/share', open))).toBe('Share your private space');
    expect(render('/settings', open)).toContain('can&#x27;t be recovered');
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
    for (const path of paths) {
      const account =
        path.startsWith('/photos') || path === '/settings'
          ? mainSession()
          : path === '/unlock'
            ? lockedAccount
            : signedOut;
      expect(render(path, account)).not.toMatch(/couple|partner|two of you/i);
    }
  });
});
