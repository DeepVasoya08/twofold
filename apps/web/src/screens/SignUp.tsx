import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { useAccount } from '../app/account';
import { Link, useRouter } from '../app/router';
import { parseNext, paths, withNext } from '../app/routes';
import { useSubmit } from '../app/use-submit';
import { AuthLayout } from '../components/AuthLayout';
import { PasswordField, TextField } from '../components/Field';
import { FormAlert } from '../components/FormAlert';
import { Icon } from '../components/Icon';
import { MIN_PASSWORD_LENGTH, isValidEmail, passwordStrength } from '@arcafold/core/password';

interface Errors {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

export function validateSignUp(values: {
  name: string;
  email: string;
  password: string;
  confirm: string;
}): Errors {
  const errors: Errors = {};
  if (!values.name.trim()) errors.name = 'Tell us what to call you.';
  if (!isValidEmail(values.email)) errors.email = 'Enter a valid email address.';
  if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`;
  } else if (passwordStrength(values.password).score < 2) {
    errors.password = 'Too easy to guess. Try a longer phrase.';
  }
  if (values.confirm !== values.password) errors.confirm = "Passwords don't match.";
  return errors;
}

export function SignUp() {
  const { navigate, search } = useRouter();
  const next = parseNext(search);
  const { prepareSignUp } = useAccount();
  const { busy, error, run } = useSubmit();
  const [values, setValues] = useState({ name: '', email: '', password: '', confirm: '' });
  const [submitted, setSubmitted] = useState(false);
  const errors = submitted ? validateSignUp(values) : {};

  const set = (key: keyof typeof values) => (event: { currentTarget: HTMLInputElement }) => {
    const { value } = event.currentTarget;
    setValues((current) => ({ ...current, [key]: value }));
  };

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (busy || Object.keys(validateSignUp(values)).length > 0) return;
    // Keys and the recovery key are made here, on this device; the password goes no further.
    void run(() => prepareSignUp(values)).then((ok) => {
      if (ok) navigate(withNext(paths.recoveryKey, next));
    });
  };

  return (
    <AuthLayout
      title="Create your vault"
      subtitle="Your photos, encrypted on your device before they go anywhere."
      step={{ current: 1, total: 2 }}
      footer={
        <>
          Already have an account? <Link to={withNext(paths.login, next)}>Log in</Link>
        </>
      }
    >
      <form className="form" onSubmit={onSubmit} noValidate>
        <TextField
          label="Your name"
          autoComplete="given-name"
          value={values.name}
          onChange={set('name')}
          error={errors.name}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={values.email}
          onChange={set('email')}
          error={errors.email}
        />
        <PasswordField
          label="Password"
          autoComplete="new-password"
          value={values.password}
          onChange={set('password')}
          error={errors.password}
          showStrength
          hint={`At least ${String(MIN_PASSWORD_LENGTH)} characters. A short sentence works well.`}
        />
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          value={values.confirm}
          onChange={set('confirm')}
          error={errors.confirm}
        />
        <div className="callout">
          <Icon name="key" size={18} />
          <p>
            Your password unlocks your photos, so we can&apos;t reset it for you. Next you&apos;ll
            get a recovery key to keep somewhere safe.
          </p>
        </div>
        <FormAlert message={error} />
        <button
          type="submit"
          className="btn btn--primary btn--block btn--lg"
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? 'Creating your keys…' : 'Continue'}
        </button>
      </form>
    </AuthLayout>
  );
}
