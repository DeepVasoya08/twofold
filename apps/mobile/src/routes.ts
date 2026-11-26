import type { AccountState } from './session/state';

export type Route =
  'starting' | 'timeline' | 'confirm-email' | 'unlock' | 'recovery-words' | 'sign-up' | 'sign-in';

/** Which screen shows. Signed out, it's sign-in unless sign-up was chosen since. */
export function routeFor(state: AccountState, pendingSignUp: boolean, signingUp: boolean): Route {
  switch (state.status) {
    case 'starting':
      return 'starting';
    case 'unlocked':
      // The server refuses the library until the email is confirmed, so that comes first.
      return state.session.account.mustVerifyEmail ? 'confirm-email' : 'timeline';
    case 'locked':
      return 'unlock';
    case 'signed-out':
      if (pendingSignUp) return 'recovery-words';
      return signingUp ? 'sign-up' : 'sign-in';
  }
}

/** Whether a sign-up choice should be forgotten: once in, signing out returns to sign-in. */
export function forgetSignUpChoice(state: AccountState): boolean {
  return state.status !== 'signed-out';
}
