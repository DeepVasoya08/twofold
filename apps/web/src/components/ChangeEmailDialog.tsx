import { useEffect, useState } from 'react';
import type { SubmitEvent } from 'react';

import { NO_CODE_CHANGE, normalizeEmail } from '@arcafold/core/account';
import { useAccount, useMe } from '../app/account';
import { useSubmit } from '../app/use-submit';
import { useToast } from '../app/toast';
import { RESEND_SECONDS } from '../screens/ConfirmEmail';
import { Dialog } from './Dialog';
import { TextField } from './Field';

/**
 * Changes a confirmed email from Settings. A code goes to the new address with the open
 * session's login key (the password itself never leaves the device), and the account moves
 * only once it's typed back. The old address then gets a notice.
 */
export function ChangeEmailDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change email"
      description="We’ll send a code to the new address. Your photos and passwords stay as they are."
    >
      {/* Mounted per opening, so each one starts empty. */}
      {open && <ChangeEmailForm onClose={onClose} />}
    </Dialog>
  );
}

function ChangeEmailForm({ onClose }: { onClose: () => void }) {
  const { sendEmailCode, verifyEmail } = useAccount();
  const me = useMe();
  const toast = useToast();
  const [address, setAddress] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  /** Bumped each time a code is sent, to restart the countdown. */
  const [sends, setSends] = useState(0);
  const { busy, error, setError, run } = useSubmit();

  useEffect(() => {
    if (sentTo === null) return;
    const deadline = Date.now() + RESEND_SECONDS * 1000;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) clearInterval(timer);
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, [sentTo, sends]);

  const send = (to: string) => {
    void run(() => sendEmailCode(to)).then((ok) => {
      if (!ok) return;
      setSentTo(normalizeEmail(to));
      setCode('');
      setSends((count) => count + 1);
      setSecondsLeft(RESEND_SECONDS);
    });
  };

  const onSend = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!address.trim()) {
      setError('Enter the email you want to use.');
      return;
    }
    send(address);
  };

  const onConfirm = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy || sentTo === null) return;
    if (!code.trim()) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    void run(() => verifyEmail(sentTo, code)).then((ok) => {
      if (!ok) return;
      toast.show('Email changed');
      onClose();
    });
  };

  if (sentTo === null) {
    return (
      <form className="form" onSubmit={onSend} noValidate>
        <p className="dialog__description">
          Now: <strong>{me.email}</strong>
        </p>
        <TextField
          label="New email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={address}
          onChange={(event) => {
            setAddress(event.currentTarget.value);
            setError(null);
          }}
          error={error}
        />
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="form" onSubmit={onConfirm} noValidate>
      <p className="dialog__description">
        We sent a 6-digit code to <strong>{sentTo}</strong>. It works for 10 minutes.
      </p>
      <TextField
        label="Code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        value={code}
        onChange={(event) => {
          setCode(event.currentTarget.value);
          setError(null);
        }}
        error={error}
      />
      <p className="confirm-email__hint">{NO_CODE_CHANGE}</p>
      <div className="form__row">
        <button
          type="button"
          className="text-link"
          disabled={secondsLeft > 0 || busy}
          onClick={() => {
            send(sentTo);
          }}
        >
          {secondsLeft > 0 ? `Send a new code in ${String(secondsLeft)}s` : 'Send a new code'}
        </button>
      </div>
      <div className="dialog__actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setError(null);
            setSentTo(null);
          }}
        >
          Back
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
          {busy ? 'Checking…' : 'Confirm code'}
        </button>
      </div>
    </form>
  );
}
