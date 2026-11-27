import { useEffect, useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';

import { NO_CODE_SIGN_UP, confirmSignUpEmail, startSignUp } from '@arcafold/core/account';

import { useAccount } from '../session/account';
import { firstProblem, signUpErrors } from '../session/forms';
import type { SignUpErrors, SignUpValues } from '../session/forms';
import { Banner, Button, Field, Note, Screen, StrengthMeter, useSubmit } from '../ui/kit';

/** Seconds before another code can be asked for (the server waits a minute too). */
const RESEND_SECONDS = 60;

/**
 * Step 1 of 2: name, email and password, then (when the server sends email) the code it
 * emailed. The keys are made on this phone once the email is confirmed.
 */
export function SignUp({ onSignIn }: { onSignIn: () => void }) {
  const { prepareSignUp } = useAccount();
  const [values, setValues] = useState<SignUpValues>({
    name: '',
    email: '',
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<SignUpErrors>({});
  const { busy, error, setError, run } = useSubmit();
  /** Set once a code was emailed: the screen asks for it before making keys. */
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [sends, setSends] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Counts down to when another code can be sent, from the clock so time away still counts.
  useEffect(() => {
    if (sends === 0) return;
    const deadline = Date.now() + RESEND_SECONDS * 1000;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) clearInterval(timer);
    }, 500);
    return () => {
      clearInterval(timer);
    };
  }, [sends]);

  const codeWentTo = (address: string) => {
    setCodeSentTo(address.trim().toLowerCase());
    setCode('');
    setSecondsLeft(RESEND_SECONDS);
    setSends((count) => count + 1);
  };
  // The return key moves on to the next field, so the keyboard stays up between them.
  const nameField = useRef<TextInputInstance>(null);
  const emailField = useRef<TextInputInstance>(null);
  const passwordField = useRef<TextInputInstance>(null);
  const confirmField = useRef<TextInputInstance>(null);
  const set = (key: keyof SignUpValues) => (text: string) => {
    setValues((current) => ({ ...current, [key]: text }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = () => {
    const found = signUpErrors(values);
    setErrors(found);
    const problem = firstProblem(found);
    if (problem) {
      // Back to the first field that needs fixing, which scrolls it into view above the keyboard.
      const fields = {
        name: nameField,
        email: emailField,
        password: passwordField,
        confirm: confirmField,
      };
      fields[problem].current?.focus();
      return;
    }
    // First a code to the email, when the server sends email; otherwise straight to the keys.
    run(async () => {
      if ((await startSignUp(values.email)) === 'code-sent') codeWentTo(values.email);
      else await prepareSignUp(values);
    });
  };

  if (codeSentTo) {
    const confirm = () => {
      if (!code.trim()) {
        setError('Enter the 6-digit code from the email.');
        return;
      }
      run(async () => {
        const ticket = await confirmSignUpEmail(codeSentTo, code);
        await prepareSignUp({ ...values, ticket });
      });
    };
    return (
      <Screen
        branded
        title="Check your email"
        subtitle={`We sent a 6-digit code to ${codeSentTo}. It works for 10 minutes.`}
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
          onSubmitEditing={confirm}
          returnKeyType="done"
        />
        {error ? <Banner>{error}</Banner> : null}
        <Button label="Continue" busyLabel="Creating your keys…" busy={busy} onPress={confirm} />
        <Note>{NO_CODE_SIGN_UP}</Note>
        <Button
          kind="secondary"
          label={secondsLeft > 0 ? `Send a new code in ${String(secondsLeft)}s` : 'Send a new code'}
          disabled={secondsLeft > 0 || busy}
          onPress={() => {
            run(async () => {
              await startSignUp(codeSentTo);
              codeWentTo(codeSentTo);
            });
          }}
        />
        <Button
          kind="link"
          label="Change email"
          onPress={() => {
            setError(null);
            setCodeSentTo(null);
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen
      branded
      title="Create your vault"
      subtitle="Your photos, encrypted on your device before they go anywhere."
    >
      <Field
        ref={nameField}
        label="Your name"
        value={values.name}
        onChangeText={set('name')}
        autoComplete="name-given"
        error={errors.name}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => emailField.current?.focus()}
      />
      <Field
        ref={emailField}
        label="Email"
        value={values.email}
        onChangeText={set('email')}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        error={errors.email}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordField.current?.focus()}
      />
      <Field
        ref={passwordField}
        label="Password"
        value={values.password}
        onChangeText={set('password')}
        secure
        autoComplete="new-password"
        textContentType="newPassword"
        error={errors.password}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => confirmField.current?.focus()}
      />
      {values.password && !errors.password ? <StrengthMeter password={values.password} /> : null}
      <Field
        ref={confirmField}
        label="Confirm password"
        value={values.confirm}
        onChangeText={set('confirm')}
        secure
        autoComplete="new-password"
        textContentType="newPassword"
        error={errors.confirm}
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <Note>
        Your password unlocks your photos, so we can’t reset it for you. Next you’ll get a recovery
        key to keep somewhere safe.
      </Note>
      {error ? <Banner>{error}</Banner> : null}
      <Button label="Continue" busyLabel="Creating your keys…" busy={busy} onPress={submit} />
      <Button kind="link" label="I already have an account" onPress={onSignIn} />
    </Screen>
  );
}
