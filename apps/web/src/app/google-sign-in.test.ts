import { describe, expect, it, vi } from 'vitest';

import { PICKER_SCOPE } from '../lib/import/google-picker';
import {
  GOOGLE_REDIRECT_PATH,
  finishGoogleSignIn,
  googleSignIn,
  googleSignInUrl,
} from './google-sign-in';
import type { SignInDeps } from './google-sign-in';

const ORIGIN = 'https://arcafold.example';

/** A BroadcastChannel stand-in that hands messages to the page listening. */
function fakeChannel() {
  const channel = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    close: vi.fn(),
    send: (data: unknown) => {
      channel.onmessage?.(new MessageEvent('message', { data }));
    },
  };
  return channel;
}

function deps(channel: ReturnType<typeof fakeChannel>, opened = true): SignInDeps {
  return {
    open: vi.fn(() => (opened ? ({} as Window) : null)),
    channel: () => channel as unknown as BroadcastChannel,
    newState: () => 'state-1',
    origin: ORIGIN,
  };
}

describe('googleSignInUrl', () => {
  it('asks Google for the Picker scope only, with a token sent back to this site', () => {
    const url = new URL(googleSignInUrl('client-1', ORIGIN, 'state-1'));
    expect(url.origin).toBe('https://accounts.google.com');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client-1',
      redirect_uri: `${ORIGIN}${GOOGLE_REDIRECT_PATH}`,
      response_type: 'token',
      scope: PICKER_SCOPE,
      state: 'state-1',
    });
  });
});

describe('googleSignIn', () => {
  it('resolves with the token sent back for this sign-in, ignoring others', async () => {
    const channel = fakeChannel();
    const signedIn = googleSignIn('client-1', new AbortController().signal, deps(channel));
    channel.send({ state: 'someone else', token: 'wrong' });
    channel.send('junk');
    channel.send({ state: 'state-1', token: 'token-1' });
    await expect(signedIn).resolves.toBe('token-1');
    expect(channel.close).toHaveBeenCalled();
  });

  it('says when the person said no, the window was blocked, or it was cancelled', async () => {
    const denied = fakeChannel();
    const no = googleSignIn('c', new AbortController().signal, deps(denied));
    denied.send({ state: 'state-1', error: 'access_denied' });
    await expect(no).rejects.toThrow('Google Photos wasn’t connected.');

    await expect(
      googleSignIn('c', new AbortController().signal, deps(fakeChannel(), false)),
    ).rejects.toThrow('blocked the Google sign-in window');

    const controller = new AbortController();
    const cancelled = googleSignIn('c', controller.signal, deps(fakeChannel()));
    controller.abort();
    await expect(cancelled).rejects.toThrow('Cancelled.');
  });
});

describe('finishGoogleSignIn', () => {
  const callbackDeps = () => {
    const posted: unknown[] = [];
    return {
      posted,
      deps: {
        channel: () => ({
          postMessage: (message: unknown) => {
            posted.push(message);
          },
          close: vi.fn(),
        }),
        clearHash: vi.fn(),
        close: vi.fn(),
      },
    };
  };

  it('passes the token on, wipes it from the address bar and closes the window', () => {
    const { posted, deps: callback } = callbackDeps();
    const handled = finishGoogleSignIn(
      {
        pathname: GOOGLE_REDIRECT_PATH,
        hash: '#state=state-1&access_token=token-1&token_type=Bearer&expires_in=3599',
      },
      callback,
    );
    expect(handled).toBe(true);
    expect(posted).toEqual([{ state: 'state-1', token: 'token-1' }]);
    expect(callback.clearHash).toHaveBeenCalled();
    expect(callback.close).toHaveBeenCalled();
  });

  it('passes an error on', () => {
    const { posted, deps: callback } = callbackDeps();
    finishGoogleSignIn(
      { pathname: GOOGLE_REDIRECT_PATH, hash: '#error=access_denied&state=state-1' },
      callback,
    );
    expect(posted).toEqual([{ state: 'state-1', error: 'access_denied' }]);
  });

  it('leaves every other page alone', () => {
    const { posted, deps: callback } = callbackDeps();
    expect(finishGoogleSignIn({ pathname: '/photos', hash: '#x' }, callback)).toBe(false);
    expect(posted).toEqual([]);
    expect(callback.clearHash).not.toHaveBeenCalled();
  });
});
