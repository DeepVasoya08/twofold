import { useState } from 'react';

import { useAccount } from '../session/account';
import { signInError } from '../session/forms';
import { Button, Field, Note, Screen, useSubmit } from '../ui/kit';

/** Email and either password: the one the password fits decides which space opens. */
export function SignIn({ onSignUp }: { onSignUp: () => void }) {
  const { email: remembered, logIn, forgetAccount } = useAccount();
  const [email, setEmail] = useState(remembered ?? '');
  const [password, setPassword] = useState('');
  const { busy, error, setError, run } = useSubmit();

  const submit = () => {
    const problem = signInError(email, password);
    if (problem) {
      setError(problem);
      return;
    }
    run(async () => {
      await logIn(email, password);
      setPassword('');
    });
  };

  return (
    <Screen title="Sign in" subtitle="Your password unlocks your photos on this phone.">
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
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
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      {error ? <Note error>{error}</Note> : null}
      <Button label="Sign in" busyLabel="Signing in…" busy={busy} onPress={submit} />
      <Button kind="link" label="Create an account" onPress={onSignUp} />
      {remembered ? (
        <Button
          kind="link"
          label={`Not ${remembered}? Forget this account`}
          onPress={() => {
            setEmail('');
            void forgetAccount();
          }}
        />
      ) : null}
      <Note>Forgot your password? Use your recovery key at arcafold.com.</Note>
    </Screen>
  );
}
