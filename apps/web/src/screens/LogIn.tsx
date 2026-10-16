import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { Link, useRouter } from '../app/router';
import { paths } from '../app/routes';
import { useVault } from '../app/vault';
import { AuthLayout } from '../components/AuthLayout';
import { PasswordField, TextField } from '../components/Field';
import { isValidEmail } from '../lib/password';

export function LogIn() {
  const { navigate } = useRouter();
  const { openSpace, spaceFor } = useVault();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const emailError = submitted && !isValidEmail(email) ? 'Enter a valid email address.' : null;
  const passwordError = submitted && !password ? 'Enter your password.' : null;

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!isValidEmail(email) || !password) return;
    // The same box opens either space; the password decides which.
    openSpace(spaceFor(password));
    navigate(paths.gallery);
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to open your photos."
      footer={
        <>
          New to Twofold? <Link to={paths.signup}>Create a vault</Link>
        </>
      }
    >
      <form className="form" onSubmit={onSubmit} noValidate>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => {
            setEmail(event.currentTarget.value);
          }}
          error={emailError}
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.currentTarget.value);
          }}
          error={passwordError}
        />
        <div className="form__row form__row--end">
          <Link to={paths.recover} className="text-link">
            Forgot password?
          </Link>
        </div>
        <button type="submit" className="btn btn--primary btn--block btn--lg">
          Log in
        </button>
      </form>
    </AuthLayout>
  );
}
