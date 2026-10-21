import type { AccountState } from './account';
import type { Space } from './account-ops';
import { parseNext, paths, withNext } from './routes';
import type { Route } from './routes';

/**
 * Where a screen sends you when your account isn't in the right state for it, or null to
 * show it. Library screens need unlocked keys; unlock needs a signed-in account.
 */
export function redirectFor(
  route: Route,
  state: AccountState,
  options: { space: Space | null; signingUp: boolean; search?: string },
): string | null {
  const { status } = state;
  // An invite link someone followed before signing in, to come back to afterwards.
  const next = parseNext(options.search ?? '');
  switch (route.name) {
    case 'not-found':
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
    case 'recovery-key':
      // Step 2 of sign-up, or a new key from Settings (main library only).
      if (options.signingUp) return null;
      if (status === 'unlocked') return options.space === 'main' ? null : paths.settings;
      return status === 'locked' ? paths.unlock : paths.signup;
    case 'gallery':
    case 'albums':
    case 'album':
    case 'favorites':
    case 'photo':
    case 'settings':
    case 'share':
      if (status === 'unlocked') return null;
      return status === 'locked' ? paths.unlock : paths.login;
  }
}
