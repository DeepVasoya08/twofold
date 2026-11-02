import { useEffect, useRef, useState } from 'react';

import { errorMessage } from '../app/account-ops';
import { GoogleSignInError, googleSignIn } from '../app/google-sign-in';
import { useImports } from '../app/imports';
import { useVault } from '../app/vault';
import { pluralize } from '../lib/format';
import {
  PICKER_MAX_ITEMS,
  PickerError,
  pickedItems,
  pickerClient,
  waitForPicks,
} from '../lib/import/google-picker';
import type { PickerSession } from '../lib/import/google-picker';
import { FormAlert } from './FormAlert';
import { Icon } from './Icon';

/** Google's own errors are written for people; anything else gets the usual message. */
const connectError = (error: unknown): string =>
  error instanceof PickerError || error instanceof GoogleSignInError
    ? error.message
    : errorMessage(error);

type Step =
  | { kind: 'idle' }
  | { kind: 'signing-in' }
  /** Waiting for the person to pick photos in Google Photos. */
  | { kind: 'picking'; session: PickerSession }
  | { kind: 'reading' };

/**
 * "Connect Google Photos": sign in with Google, pick photos in Google Photos, and the import
 * takes it from there, downloading each photo straight into this browser to be encrypted.
 */
export function GooglePhotosConnect({ clientId }: { clientId: string }) {
  const imports = useImports();
  const { space } = useVault();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [videos, setVideos] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const where = space === 'private' ? 'private space' : 'library';

  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );

  const reset = (message: string | null) => {
    abort.current?.abort();
    abort.current = null;
    setStep({ kind: 'idle' });
    setError(message);
  };

  const onConnect = () => {
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    setError(null);
    setVideos(0);
    setStep({ kind: 'signing-in' });
    // The sign-in window has to open straight from the click, so this comes first.
    const signedIn = googleSignIn(clientId, controller.signal);
    // A function, so each check reads the signal afresh after an await.
    const stopped = () => controller.signal.aborted;
    void (async () => {
      try {
        const token = await signedIn;
        const client = pickerClient(token);
        const session = await client.createSession();
        if (stopped()) return;
        // Google Photos opens from a tap on its link: a window opened without one is blocked.
        setStep({ kind: 'picking', session });
        const picked = await waitForPicks(client, session, controller.signal);
        if (!picked) return;
        setStep({ kind: 'reading' });
        const { photos, videos: skipped } = await client.listPicked(session.id);
        if (stopped()) return;
        setVideos(skipped);
        if (photos.length === 0) {
          reset(
            skipped > 0
              ? 'You only picked videos, which Twofold can’t store yet.'
              : 'No photos were picked.',
          );
          void client.deleteSession(session.id).catch(() => undefined);
          return;
        }
        setStep({ kind: 'idle' });
        imports.start(
          pickedItems(photos, client.download).map((item) => ({ item, albums: [] })),
          () => {
            void client.deleteSession(session.id).catch(() => undefined);
          },
        );
      } catch (caught) {
        if (!stopped()) reset(connectError(caught));
      }
    })();
  };

  if (step.kind === 'picking' || step.kind === 'reading') {
    return (
      <div className="import__connect">
        <p className="import__summary" role="status">
          {step.kind === 'picking'
            ? 'Connected. Now choose your photos in Google Photos and tap Done there; this page carries on by itself.'
            : 'Getting the photos you picked…'}
        </p>
        <div className="import__choose">
          {step.kind === 'picking' && (
            <a
              className="btn btn--primary btn--lg"
              // On the web, "/autoclose" closes Google Photos once the picking is done.
              href={`${step.session.pickerUri.replace(/\/$/, '')}/autoclose`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Choose photos in Google Photos
            </a>
          )}
          <button
            type="button"
            className="btn btn--secondary btn--lg"
            onClick={() => {
              reset(null);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="import__connect">
      <FormAlert message={error} />
      {videos > 0 && step.kind === 'idle' && imports.phase === 'idle' && (
        <p className="import__fit">{pluralize(videos, 'video')} skipped.</p>
      )}
      <p className="import__connect-text">
        Sign in with Google and pick the photos to bring into your {where}, up to{' '}
        {PICKER_MAX_ITEMS.toLocaleString('en-US')} at a time. Their dates come along; albums stay in
        Google Photos.
      </p>
      <button
        type="button"
        className="btn btn--primary btn--lg"
        disabled={step.kind === 'signing-in'}
        aria-busy={step.kind === 'signing-in'}
        onClick={onConnect}
      >
        <Icon name="cloud" size={18} />
        {step.kind === 'signing-in' ? 'Waiting for Google…' : 'Connect Google Photos'}
      </button>
      {step.kind === 'signing-in' && (
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            reset(null);
          }}
        >
          Cancel
        </button>
      )}
      <p className="share__note">
        <Icon name="shield" size={16} />
        Photos come straight from Google to this device and are encrypted here. Twofold never sees
        them or your Google account, and forgets the sign-in once the import ends.
      </p>
    </div>
  );
}
