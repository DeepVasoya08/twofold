import { useEffect, useRef, useState } from 'react';

import { useAccount } from '../session/account';
import { KEEP_FROM_AUTOFILL } from '../session/forms';
import { Banner, Button, Field, Note, Screen, useSubmit } from '../ui/kit';

/**
 * The locked app: one password field, as on the web. The same field opens either space; the
 * password is checked on this phone and never sent anywhere.
 */
export function Unlock() {
  const { state, unlock, logOut, biometricFor, unlockWithBiometrics } = useAccount();
  const [password, setPassword] = useState('');
  const { busy, error, setError, run } = useSubmit();
  const lockedEmail = state.status === 'locked' ? state.account.email : null;
  const canUseBiometrics = lockedEmail !== null && lockedEmail === biometricFor;
  const asked = useRef(false);

  // Asks for a fingerprint once as the lock screen shows; cancelling leaves the password.
  useEffect(() => {
    if (!canUseBiometrics || asked.current) return;
    asked.current = true;
    run(unlockWithBiometrics);
  }, [canUseBiometrics, run, unlockWithBiometrics]);

  if (state.status !== 'locked') return null;
  const { name, email } = state.account;

  const submit = () => {
    if (!password) {
      setError('Enter your password.');
      return;
    }
    run(async () => {
      await unlock(password);
      setPassword('');
    });
  };

  return (
    <Screen
      branded
      title={`Welcome back, ${name}`}
      subtitle="Arcafold locked itself to keep your photos safe. Enter your password to open it."
    >
      <Note>{email}</Note>
      <Field
        label="Password"
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          setError(null);
        }}
        secure
        {...KEEP_FROM_AUTOFILL}
        autoFocus={!canUseBiometrics}
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      {error ? <Banner>{error}</Banner> : null}
      <Button label="Unlock" busyLabel="Unlocking…" busy={busy} onPress={submit} />
      {canUseBiometrics ? (
        <Button
          kind="secondary"
          label="Use fingerprint or face"
          onPress={() => {
            run(unlockWithBiometrics);
          }}
        />
      ) : null}
      <Button
        kind="link"
        label="Sign out"
        onPress={() => {
          void logOut();
        }}
      />
    </Screen>
  );
}
