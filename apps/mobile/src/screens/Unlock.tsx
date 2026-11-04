import { useState } from 'react';

import { useAccount } from '../session/account';
import { Button, Field, Note, Screen, useSubmit } from '../ui/kit';

/**
 * The locked app: one password field, as on the web. The same field opens either space; the
 * password is checked on this phone and never sent anywhere.
 */
export function Unlock() {
  const { state, unlock, logOut } = useAccount();
  const [password, setPassword] = useState('');
  const { busy, error, setError, run } = useSubmit();
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
      showLogo
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
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        autoFocus
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      {error ? <Note error>{error}</Note> : null}
      <Button label="Unlock" busyLabel="Unlocking…" busy={busy} onPress={submit} />
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
