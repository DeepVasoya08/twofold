import { useEffect, useState } from 'react';
import type { SubmitEvent } from 'react';

import { NO_CODE_CHANGE } from '@arcafold/core/account';
import { useAccount, useMe } from '../app/account';
import { useSubmit } from '../app/use-submit';
import { AuthLayout } from '../components/AuthLayout';
import { TextField } from '../components/Field';

import './confirm-email.css';

/** Seconds before another code can be asked for (the server waits a minute too). */
export const RESEND_SECONDS = 60;

type Step = 'start' | 'code' | 'change';

/**
 * Shown instead of the library while the account must confirm its email. A 6-digit code goes
 * to the address, and typing it back confirms it. Before it's confirmed, the address can be
 * swapped for another to fix a typo. Email only ever reaches the owner: it never unlocks
 * anything, and there is still no password reset.
 */
export function ConfirmEmail() {
  const { sendEmailCode, verifyEmail, logOut } = useAccount();
  const me = useMe();
  const [step, setStep] = useState<Step>('start');
  const [address, setAddress] = useState(me.email);
  const [newAddress, setNewAddress] = useState('');
  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  /** Bumped each time a code is sent, to restart the countdown. */
  const [sends, setSends] = useState(0);
  const { busy, error, setError, run } = useSubmit();

  // Counts down to when another code can be sent, from the clock so a background tab ends on time.
  useEffect(() => {
    if (step !== 'code') return;
    const deadline = Date.now() + RESEND_SECONDS * 1000;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) clearInterval(timer);
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, [step, sends]);

  const send = (to: string) => {
    if (busy) return;
    void run(() => sendEmailCode(to)).then((ok) => {
      if (!ok) return;
      setAddress(to.trim().toLowerCase());
      setCode('');
      setSends((count) => count + 1);
      setSecondsLeft(RESEND_SECONDS);
      setStep('code');
    });
  };

  const resend = () => {
    if (busy || secondsLeft > 0) return;
    void run(() => sendEmailCode(address)).then((ok) => {
      if (!ok) return;
      setSends((count) => count + 1);
      setSecondsLeft(RESEND_SECONDS);
    });
  };

  const onConfirm = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!code.trim()) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    void run(() => verifyEmail(address, code));
  };

  const onChange = (event: SubmitEvent) => {
    event.preventDefault();
    if (!newAddress.trim()) {
      setError('Enter the email you want to use.');
      return;
    }
    send(newAddress);
  };

  const footer = (
    <button
      type="button"
      className="text-link"
      onClick={() => {
        void logOut();
      }}
    >
      Sign out
    </button>
  );

  if (step === 'change') {
    return (
      <AuthLayout
        title="Use a different email"
        subtitle="We’ll send a code to the new address. Your photos and passwords stay as they are."
        footer={footer}
      >
        <form className="form" onSubmit={onChange} noValidate>
          <TextField
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={newAddress}
            onChange={(event) => {
              setNewAddress(event.currentTarget.value);
              setError(null);
            }}
            error={error}
          />
          <button
            type="submit"
            className="btn btn--primary btn--block btn--lg"
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? 'Sending…' : 'Send code'}
          </button>
          <div className="form__row form__row--center">
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setError(null);
                setStep('start');
              }}
            >
              Back
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  if (step === 'code') {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={
          <>
            We sent a 6-digit code to <strong className="confirm-email__address">{address}</strong>.
            It works for 10 minutes.
          </>
        }
        footer={footer}
      >
        <form className="form" onSubmit={onConfirm} noValidate>
          <TextField
            label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            className="confirm-email__code"
            value={code}
            onChange={(event) => {
              setCode(event.currentTarget.value);
              setError(null);
            }}
            error={error}
          />
          <button
            type="submit"
            className="btn btn--primary btn--block btn--lg"
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? 'Checking…' : 'Confirm email'}
          </button>
          {address !== me.email && <p className="confirm-email__hint">{NO_CODE_CHANGE}</p>}
          <div className="form__row form__row--center confirm-email__links">
            <button
              type="button"
              className="text-link"
              disabled={secondsLeft > 0 || busy}
              onClick={resend}
            >
              {secondsLeft > 0 ? `Send a new code in ${String(secondsLeft)}s` : 'Send a new code'}
            </button>
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setError(null);
                setStep('change');
              }}
            >
              Use a different email
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Confirm your email"
      subtitle="Arcafold uses it to tell you about new sign-ins and invites. It can’t unlock your photos: only your password or recovery key can."
      footer={footer}
    >
      <div className="confirm-email__current">
        <span className="confirm-email__label">Your email</span>
        <span className="confirm-email__value">{address}</span>
      </div>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          send(address);
        }}
        noValidate
      >
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="btn btn--primary btn--block btn--lg"
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? 'Sending…' : 'Send code'}
        </button>
        <div className="form__row form__row--center">
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setError(null);
              setStep('change');
            }}
          >
            Use a different email
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
