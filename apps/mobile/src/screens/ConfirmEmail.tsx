import { useEffect, useState } from 'react';

import { NO_CODE_CHANGE } from '@arcafold/core/account';

import { useAccount } from '../session/account';
import { Banner, Button, Callout, Field, Note, Screen, useSubmit } from '../ui/kit';

/** Seconds before another code can be asked for (the server waits a minute too). */
const RESEND_SECONDS = 60;

type Step = 'start' | 'code' | 'change';

/**
 * Shown instead of the library while the account must confirm its email, as on the web. A
 * 6-digit code goes to the address and typing it back confirms it. Before that, the address
 * can be swapped to fix a typo. Email never unlocks anything: there is no password reset.
 */
export function ConfirmEmail() {
  const { state, sendEmailCode, verifyEmail, logOut } = useAccount();
  const [step, setStep] = useState<Step>('start');
  const [address, setAddress] = useState(
    state.status === 'unlocked' ? state.session.account.email : '',
  );
  const [newAddress, setNewAddress] = useState('');
  const [code, setCode] = useState('');
  const [sends, setSends] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const { busy, error, setError, run } = useSubmit();

  // Counts down to when another code can be sent, from the clock so time away still counts.
  useEffect(() => {
    if (step !== 'code') return;
    const deadline = Date.now() + RESEND_SECONDS * 1000;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) clearInterval(timer);
    }, 500);
    return () => {
      clearInterval(timer);
    };
  }, [step, sends]);

  if (state.status !== 'unlocked') return null;

  const send = (to: string) => {
    run(async () => {
      await sendEmailCode(to);
      setAddress(to.trim().toLowerCase());
      setCode('');
      setSends((count) => count + 1);
      setSecondsLeft(RESEND_SECONDS);
      setStep('code');
    });
  };

  const signOut = (
    <Button
      kind="link"
      label="Sign out"
      onPress={() => {
        void logOut();
      }}
    />
  );

  if (step === 'change') {
    const submit = () => {
      if (!newAddress.trim()) {
        setError('Enter the email you want to use.');
        return;
      }
      send(newAddress);
    };
    return (
      <Screen
        branded
        title="Use a different email"
        subtitle="We’ll send a code to the new address. Your photos and passwords stay as they are."
      >
        <Field
          label="Email"
          value={newAddress}
          onChangeText={(text) => {
            setNewAddress(text);
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
        <Button
          kind="link"
          label="Back"
          onPress={() => {
            setError(null);
            setStep('start');
          }}
        />
      </Screen>
    );
  }

  if (step === 'code') {
    const submit = () => {
      if (!code.trim()) {
        setError('Enter the 6-digit code from the email.');
        return;
      }
      run(() => verifyEmail(address, code));
    };
    return (
      <Screen
        branded
        title="Check your email"
        subtitle={`We sent a 6-digit code to ${address}. It works for 10 minutes.`}
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
        {address !== state.session.account.email ? <Callout>{NO_CODE_CHANGE}</Callout> : null}
        {error ? <Banner>{error}</Banner> : null}
        <Button label="Confirm email" busyLabel="Checking…" busy={busy} onPress={submit} />
        <Button
          kind="secondary"
          label={secondsLeft > 0 ? `Send a new code in ${String(secondsLeft)}s` : 'Send a new code'}
          disabled={secondsLeft > 0 || busy}
          onPress={() => {
            send(address);
          }}
        />
        <Button
          kind="link"
          label="Use a different email"
          onPress={() => {
            setError(null);
            setStep('change');
          }}
        />
        {signOut}
      </Screen>
    );
  }

  return (
    <Screen
      branded
      title="Confirm your email"
      subtitle="Arcafold uses it to tell you about new sign-ins and invites. It can’t unlock your photos: only your password or recovery key can."
    >
      <Note>{address}</Note>
      {error ? <Banner>{error}</Banner> : null}
      <Button
        label="Send code"
        busyLabel="Sending…"
        busy={busy}
        onPress={() => {
          send(address);
        }}
      />
      <Button
        kind="link"
        label="Use a different email"
        onPress={() => {
          setError(null);
          setStep('change');
        }}
      />
      {signOut}
    </Screen>
  );
}
