import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App';
import type { AccountState } from './app/account';
import { forgetNames } from './app/addresses';
import { Providers } from './app/Providers';
import { MemoryRouter } from './app/router';
import { paths } from './app/routes';
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
  it('asks the smart features question once, in either space, until it is answered', () => {
    const unanswered = { ...testAccount(), smartFeatures: null };
    const asked = 'downloads some resources';
    expect(render('/photos', mainSession(unanswered))).toContain(asked);
    expect(render('/photos', privateSession(unanswered))).toContain(asked);
    expect(render('/photos', mainSession())).not.toContain(asked);
    const older = { ...testAccount(), smartFeatures: { choice: 'on' as const, version: 0 } };
    expect(render('/photos', mainSession(older))).toContain(asked);
  });

  it('shows the confirm-email step instead of the library until the email is confirmed', () => {
    const unconfirmed = { ...testAccount(), emailVerified: false, mustVerifyEmail: true };
    for (const session of [mainSession(unconfirmed), privateSession(unconfirmed)]) {
      const html = render('/photos', session);
      expect(heading(html)).toBe('Confirm your email');
      expect(html).toContain('sam@example.com');
      expect(html).toContain('Use a different email');
    }
    expect(heading(render('/settings', mainSession(unconfirmed)))).toBe('Confirm your email');
    // While locked, unlocking comes first; the step follows once the keys are open.
    const locked: AccountState = { status: 'locked', account: unconfirmed };
    expect(heading(render('/unlock', locked))).not.toBe('Confirm your email');
    // Email not set up yet: the library opens as before.
    const notAsked = { ...testAccount(), emailVerified: false, mustVerifyEmail: false };
    expect(heading(render('/photos', mainSession(notAsked)))).not.toBe('Confirm your email');
  });

  it('never asks the smart features question while locked or signed out', () => {
    const unanswered = { ...testAccount(), smartFeatures: null };
    const locked: AccountState = { status: 'locked', account: unanswered };
    expect(render('/unlock', locked)).not.toContain('downloads some resources');
  });

  it.each([
    ['/photos', 'Photos'],
    ['/albums', 'Albums'],
    [paths.album('kyoto'), 'Kyoto in autumn'],
    [paths.album('missing'), 'Album not found'],
    ['/favorites', 'Favorites'],
    ['/files', 'Files'],
    ['/search', 'Search'],
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
    ['/privacy', 'Privacy Policy'],
    ['/terms', 'Terms of Use'],
  ])('renders %s when signed out', (path, title) => {
    expect(heading(render(path, signedOut))).toBe(title);
  });

  it.each([
    ['/', 'Your photos.Truly private.'],
    ['/privacy', 'Privacy Policy'],
    ['/terms', 'Terms of Use'],
  ])('shows the public page %s while the account is still loading', (path, title) => {
    expect(heading(render(path, { status: 'loading' }))).toBe(title);
  });

  it('shows nothing for app screens while the account is still loading', () => {
    expect(heading(render('/photos', { status: 'loading' }))).toBeUndefined();
  });

  it('shows the legal pages to an unlocked account too', () => {
    expect(heading(render('/privacy'))).toBe('Privacy Policy');
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

  it('shows an invite link to an unlocked account, and sends anyone else to sign in', () => {
    const path = `/join/${'A'.repeat(22)}`;
    const html = render(path);
    expect(heading(html)).toBe('You’re invited');
    expect(html).toContain('Checking the invite');
    expect(heading(render(path, signedOut))).toBeUndefined();
    expect(heading(render(path, lockedAccount))).toBeUndefined();
  });

  it('offers a link as well as a code on the Share screen', () => {
    const html = render('/settings/share');
    expect(html).toContain('Copy link');
    expect(html).toContain('They can accept any time in the next 7 days.');
    expect(html).not.toContain('Keep this screen open');
  });

  it('renders nothing while it checks for a session', () => {
    expect(heading(render('/photos', { status: 'loading' }))).toBeUndefined();
  });

  it('opens a photo with its details', () => {
    const html = render(paths.photo('p006'));
    expect(html).toContain('Kyoto, Japan');
    expect(html).toContain('aria-label="Next photo"');
    // Saving it names it by when it was taken, never by its id.
    expect(html).toMatch(/download="\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}"/);
    expect(html).not.toContain('p006');
  });

  it('never puts an id in an address it links to', () => {
    const ids = /\/(p\d{3}|kyoto|lisbon|monsoon|celebrations|sundays|someday)\b/;
    for (const path of ['/photos', '/albums', paths.album('kyoto'), '/files']) {
      const hrefs = [...render(path).matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) expect(href).not.toMatch(ids);
    }
  });

  it('sends an address from before Arcafold locked on to its list, showing nothing of it', () => {
    const before = [paths.album('kyoto'), paths.photo('p006'), paths.shareAlbum('kyoto')];
    forgetNames();
    for (const path of before) expect(heading(render(path))).toBeUndefined();
  });

  it('shows empty states for an empty library', () => {
    const empty = emptyVaults;
    expect(render('/photos', mainSession(), empty)).toContain('Your library is ready');
    expect(render('/favorites', mainSession(), empty)).toContain('No favorites yet');
    expect(render('/files', mainSession(), empty)).toContain('No files yet');
    expect(render(paths.photo('p001'), mainSession(), empty)).toContain(
      'isn&#x27;t in your vault anymore',
    );
  });

  it('offers picking photos one by one and a whole month at a time', () => {
    const html = render('/photos');
    expect(html).toContain('>Select<');
    expect(html).toContain('aria-label="Select all of October 2026"');
    expect(html).toMatch(/aria-label="Select photo from [^"]+" aria-pressed="false"/);
    expect(render('/favorites')).toContain('>Select<');
    expect(render(paths.album('kyoto'))).toContain('>Select<');
  });

  it('offers actions on every album', () => {
    expect(render(paths.album('kyoto'))).toContain('aria-label="Actions for Kyoto in autumn"');
    expect(render('/albums')).toContain('aria-label="Actions for Lisbon weekend"');
  });

  it('never renders a shared header without the encryption badge', () => {
    expect(render('/photos')).toContain('End-to-end encrypted');
  });

  it('never hints at a private space from the main library', () => {
    for (const path of ['/photos', '/albums', '/favorites', '/settings', paths.photo('p006')]) {
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

  it('shows the open space’s storage against the 1 GB limit', () => {
    const sized: VaultsState = {
      spaces: {
        main: {
          photos: mockVaults.spaces.main.photos.map((photo) => ({ ...photo, size: 1024 * 1024 })),
          albums: [],
        },
        private: {
          photos: mockVaults.spaces.private.photos.map((photo) => ({ ...photo, size: 1 })),
          albums: [],
        },
      },
    };
    const count = mockVaults.spaces.main.photos.length;
    const html = render('/settings', mainSession(), sized);
    expect(html).toContain(`${String(count)} MB of 1 GB used`);
    // The sidebar shows it on every screen.
    expect(render('/photos', mainSession(), sized)).toContain(`${String(count)} MB of 1 GB used`);
    expect(render('/settings', mainSession(), emptyVaults)).toContain('0 B of 1 GB used');
    expect(render('/settings', privateSession(), sized)).toContain('of 1 GB used');
  });

  it('offers to edit the profile', () => {
    const html = render('/settings');
    expect(html).toContain('>Edit<');
    expect(html).toContain('Edit profile');
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
