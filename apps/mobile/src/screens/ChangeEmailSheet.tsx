import { useEffect, useState } from 'react';

import { NO_CODE_CHANGE, normalizeEmail } from '@arcafold/core/account';

import { useAccount } from '../session/account';
import { Banner, Button, Field, Note, useSubmit } from '../ui/kit';
import { useNotice } from '../ui/notice';
import { Sheet } from '../ui/sheet';

/** Seconds before another code can be asked for (the server waits a minute too). */
const RESEND_SECONDS = 60;

/**
 * Changes a confirmed email from Settings, as on the web. A code goes to the new address with
 * the open session's login key (the password never leaves the phone), and the account moves
 * only once it's typed back. The old address then gets a notice.
 */
export function ChangeEmailSheet({ onClose }: { onClose: () => void }) {
  const { state, sendEmailCode, verifyEmail } = useAccount();
  const notice = useNotice();
  const [address, setAddress] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [sends, setSends] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const { busy, error, setError, run } = useSubmit();

  useEffect(() => {
    if (sentTo === null) return;
    const deadline = Date.now() + RESEND_SECONDS * 1000;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) clearInterval(timer);
    }, 500);
    return () => {
      clearInterval(timer);
    };
  }, [sentTo, sends]);

  if (state.status !== 'unlocked') return null;

  const send = (to: string) => {
    run(async () => {
      await sendEmailCode(to);
      setSentTo(normalizeEmail(to));
      setCode('');
      setSends((count) => count + 1);
      setSecondsLeft(RESEND_SECONDS);
    });
  };

  if (sentTo === null) {
    const submit = () => {
      if (!address.trim()) {
        setError('Enter the email you want to use.');
        return;
      }
      send(address);
    };
    return (
      <Sheet
        title="Change email"
        body={`Now: ${state.session.account.email}. We’ll send a code to the new address. Your photos and passwords stay as they are.`}
        busy={busy}
        onCancel={onClose}
      >
        <Field
          label="New email"
          value={address}
          onChangeText={(text) => {
            setAddress(text);
            setError(null);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          autoFocus
          onSubmitEditing={submit}
          returnKeyType="send"
        />
        {error ? <Banner>{error}</Banner> : null}
        <Button label="Send code" busyLabel="Sending…" busy={busy} onPress={submit} />
      </Sheet>
    );
  }

  const submit = () => {
    if (!code.trim()) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    run(async () => {
      await verifyEmail(sentTo, code);
      notice('Email changed');
      onClose();
    });
  };
  return (
    <Sheet
      title="Check your email"
      body={`We sent a 6-digit code to ${sentTo}. It works for 10 minutes.`}
      busy={busy}
      onCancel={onClose}
    >
      <Field
        label="Code"
        value={code}
        onChangeText={(text) => {
          setCode(text);
          setError(null);
        }}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={7}
        autoFocus
        onSubmitEditing={submit}
        returnKeyType="done"
      />
      {error ? <Banner>{error}</Banner> : null}
      <Button label="Change email" busyLabel="Checking…" busy={busy} onPress={submit} />
      <Note>{NO_CODE_CHANGE}</Note>
      <Button
        kind="secondary"
        label={secondsLeft > 0 ? `Send a new code in ${String(secondsLeft)}s` : 'Send a new code'}
        disabled={secondsLeft > 0 || busy}
        onPress={() => {
          send(sentTo);
        }}
      />
      <Button
        kind="link"
        label="Back"
        onPress={() => {
          setError(null);
          setSentTo(null);
        }}
      />
    </Sheet>
  );
}
