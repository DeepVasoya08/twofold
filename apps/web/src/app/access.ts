import type { AccountState } from './account';
import type { Space } from '@arcafold/core/account';
import { parseNext, paths, withNext } from './routes';
import type { Route } from './routes';

/**
 * Where a screen sends you when your account isn't in the right state for it, or null to
 * show it. Library screens need unlocked keys; unlock needs a signed-in account.
 */
export function redirectFor(
  route: Route,
  state: AccountState,
  options: {
    space: Space | null;
    signingUp: boolean;
    /** A new main password or recovery key is waiting for its new words to be saved. */
    changingKeys?: boolean;
    search?: string;
  },
): string | null {
  const { status } = state;
  // An invite link someone followed before signing in, to come back to afterwards.
  const next = parseNext(options.search ?? '');
  switch (route.name) {
    case 'not-found':
    case 'speed-test':
    case 'privacy':
    case 'terms':
      return null;
    case 'welcome':
    case 'signup':
    case 'login':
    case 'recover':
      return status === 'unlocked' ? (next ?? paths.gallery) : null;
    case 'unlock':
      if (status === 'signed-out') return withNext(paths.login, next);
      return status === 'unlocked' ? (next ?? paths.gallery) : null;
    case 'join':
      if (status === 'unlocked') return null;
      return withNext(status === 'locked' ? paths.unlock : paths.login, paths.join(route.token));
    case 'join-code':
      if (status === 'unlocked') return null;
      return withNext(status === 'locked' ? paths.unlock : paths.login, paths.joinCode);
    case 'recovery-key':
      // Step 2 of sign-up, or the new words for a new main password or recovery key from
      // Settings. Once those are saved (or with nothing waiting) Settings is where to be.
      if (options.signingUp) return null;
      if (status === 'unlocked') return options.changingKeys ? null : paths.settings;
      return status === 'locked' ? paths.unlock : paths.signup;
    case 'gallery':
    case 'albums':
    case 'album':
    case 'smart-album':
    case 'favorites':
    case 'files':
    case 'file':
    case 'folder':
    case 'trash':
    case 'search':
    case 'people':
    case 'person':
    case 'photo':
    case 'settings':
    case 'import':
    case 'share':
      if (status === 'unlocked') return null;
      return status === 'locked' ? paths.unlock : paths.login;
  }
}
