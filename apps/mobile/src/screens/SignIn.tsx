import { useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';

import { useAccount } from '../session/account';
import { signInError } from '../session/forms';
import { Banner, Button, Field, Note, Screen, useSubmit } from '../ui/kit';

/** Email and either password: the one the password fits decides which space opens. */
export function SignIn({ onSignUp }: { onSignUp: () => void }) {
  const {
    email: remembered,
    logIn,
    forgetAccount,
    biometricFor,
    unlockWithBiometrics,
  } = useAccount();
  const [email, setEmail] = useState(remembered ?? '');
  const [password, setPassword] = useState('');
  const { busy, error, setError, run } = useSubmit();
  const passwordField = useRef<TextInputInstance>(null);

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
    <Screen branded title="Sign in" subtitle="Your password unlocks your photos on this phone.">
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordField.current?.focus()}
      />
      <Field
        ref={passwordField}
        label="Password"
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          setError(null);
        }}
        secure
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      {error ? <Banner>{error}</Banner> : null}
      <Button label="Sign in" busyLabel="Signing in…" busy={busy} onPress={submit} />
      {biometricFor !== null && email.trim() === biometricFor ? (
        <Button
          kind="secondary"
          label="Sign in with fingerprint or face"
          onPress={() => {
            run(unlockWithBiometrics);
          }}
        />
      ) : null}
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
