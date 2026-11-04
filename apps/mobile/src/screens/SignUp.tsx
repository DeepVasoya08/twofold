import { useState } from 'react';

import { passwordStrength } from '@arcafold/core/password';

import { useAccount } from '../session/account';
import { signUpErrors } from '../session/forms';
import type { SignUpErrors, SignUpValues } from '../session/forms';
import { Button, Field, Note, Screen, useSubmit } from '../ui/kit';

/** Step 1 of 2: name, email and password. The keys are made on this phone. */
export function SignUp({ onSignIn }: { onSignIn: () => void }) {
  const { prepareSignUp } = useAccount();
  const [values, setValues] = useState<SignUpValues>({
    name: '',
    email: '',
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<SignUpErrors>({});
  const { busy, error, run } = useSubmit();
  const set = (key: keyof SignUpValues) => (text: string) => {
    setValues((current) => ({ ...current, [key]: text }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = () => {
    const found = signUpErrors(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    run(() => prepareSignUp(values));
  };

  const strength = values.password ? passwordStrength(values.password).label : null;
  return (
    <Screen
      title="Create your vault"
      subtitle="Your photos, encrypted on your device before they go anywhere."
    >
      <Field
        label="Your name"
        value={values.name}
        onChangeText={set('name')}
        autoComplete="name-given"
        error={errors.name}
      />
      <Field
        label="Email"
        value={values.email}
        onChangeText={set('email')}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        error={errors.email}
      />
      <Field
        label="Password"
        value={values.password}
        onChangeText={set('password')}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={errors.password}
      />
      {strength && !errors.password ? <Note>Strength: {strength}</Note> : null}
      <Field
        label="Confirm password"
        value={values.confirm}
        onChangeText={set('confirm')}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={errors.confirm}
      />
      <Note>
        Your password unlocks your photos, so we can’t reset it for you. Next you’ll get a recovery
        key to keep somewhere safe.
      </Note>
      {error ? <Note error>{error}</Note> : null}
      <Button label="Continue" busyLabel="Creating your keys…" busy={busy} onPress={submit} />
      <Button kind="link" label="I already have an account" onPress={onSignIn} />
    </Screen>
  );
}
