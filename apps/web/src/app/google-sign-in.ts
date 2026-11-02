import { PICKER_SCOPE } from '../lib/import/google-picker';

/**
 * Signs in to Google for the Photos Picker, in a window of its own so the open vault (whose
 * keys live only in this page's memory) isn't reloaded. Google sends the window back to
 * GOOGLE_REDIRECT_PATH with an access token in the URL fragment, which never reaches any
 * server; that page hands the token to this one over a BroadcastChannel (the app's
 * Cross-Origin-Opener-Policy cuts the window off from its opener) and closes. The token is
 * only ever held in memory.
 */

export const GOOGLE_REDIRECT_PATH = '/import/google/done';
const CHANNEL = 'twofold-google-sign-in';
/** How long to wait for the sign-in window before giving up. */
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

export class GoogleSignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSignInError';
  }
}

interface SignInMessage {
  state: string;
  token?: string;
  error?: string;
}

function isSignInMessage(value: unknown): value is SignInMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message.state === 'string' &&
    (message.token === undefined || typeof message.token === 'string') &&
    (message.error === undefined || typeof message.error === 'string')
  );
}

/** Google's sign-in page for the Picker's one scope. */
export function googleSignInUrl(clientId: string, origin: string, state: string): string {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}${GOOGLE_REDIRECT_PATH}`,
    response_type: 'token',
    scope: PICKER_SCOPE,
    state,
    include_granted_scopes: 'false',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
}

export interface SignInDeps {
  open: (url: string) => Window | null;
  channel: () => BroadcastChannel;
  newState: () => string;
  origin: string;
}

const browserDeps = (): SignInDeps => ({
  open: (url) => window.open(url, '_blank'),
  channel: () => new BroadcastChannel(CHANNEL),
  newState: () => crypto.randomUUID(),
  origin: window.location.origin,
});

/**
 * Opens Google's sign-in and resolves with an access token. Call it straight from a click,
 * or the browser blocks the window. Rejects if the window is blocked, the person says no,
 * `signal` aborts, or nothing comes back in time.
 */
export function googleSignIn(
  clientId: string,
  signal: AbortSignal,
  deps: SignInDeps = browserDeps(),
): Promise<string> {
  const state = deps.newState();
  const channel = deps.channel();
  const opened = deps.open(googleSignInUrl(clientId, deps.origin, state));
  return new Promise<string>((resolve, reject) => {
    const finish = (outcome: () => void) => {
      clearTimeout(timer);
      channel.close();
      signal.removeEventListener('abort', onAbort);
      outcome();
    };
    const onAbort = () => {
      finish(() => {
        reject(new GoogleSignInError('Cancelled.'));
      });
    };
    const timer = setTimeout(() => {
      finish(() => {
        reject(new GoogleSignInError('Google sign-in took too long. Try again.'));
      });
    }, SIGN_IN_TIMEOUT_MS);
    if (!opened) {
      finish(() => {
        reject(
          new GoogleSignInError(
            'Your browser blocked the Google sign-in window. Allow pop-ups for Twofold and try again.',
          ),
        );
      });
      return;
    }
    signal.addEventListener('abort', onAbort);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      // Only an answer to this sign-in counts.
      if (!isSignInMessage(message) || message.state !== state) return;
      finish(() => {
        if (message.token) resolve(message.token);
        else
          reject(
            new GoogleSignInError(
              message.error === 'access_denied'
                ? 'Google Photos wasn’t connected.'
                : 'Google sign-in didn’t work. Try again.',
            ),
          );
      });
    };
  });
}

/**
 * Run first on every page load. On the page Google sends the sign-in window back to, hands
 * the result to the page that asked, wipes it from the address bar and closes the window;
 * returns true there, so the app isn't started. Elsewhere it does nothing and returns false.
 */
export function finishGoogleSignIn(
  location: Pick<Location, 'pathname' | 'hash'>,
  deps: {
    channel: () => Pick<BroadcastChannel, 'postMessage' | 'close'>;
    clearHash: () => void;
    close: () => void;
  } = {
    channel: () => new BroadcastChannel(CHANNEL),
    clearHash: () => {
      history.replaceState(null, '', GOOGLE_REDIRECT_PATH);
    },
    close: () => {
      window.close();
    },
  },
): boolean {
  if (location.pathname !== GOOGLE_REDIRECT_PATH) return false;
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  deps.clearHash();
  const state = params.get('state');
  if (state) {
    const message: SignInMessage = { state };
    const token = params.get('access_token');
    const error = params.get('error');
    if (token) message.token = token;
    else message.error = error ?? 'unknown';
    const channel = deps.channel();
    channel.postMessage(message);
    channel.close();
  }
  deps.close();
  return true;
}
