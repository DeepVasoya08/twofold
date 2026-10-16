import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { Link, useRouter } from '../app/router';
import { paths } from '../app/routes';
import { useVault } from '../app/vault';
import { AuthLayout } from '../components/AuthLayout';
import { Avatar } from '../components/Brand';
import { PasswordField } from '../components/Field';
import { me } from '../mock/data';

import './unlock.css';

/** Shown to a returning user whose session is still valid but whose vault key is not in memory. */
export function Unlock() {
  const { navigate } = useRouter();
  const { openSpace, spaceFor } = useVault();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!password) {
      setError('Enter your password to unlock.');
      return;
    }
    // The same box opens either space; the password decides which.
    openSpace(spaceFor(password));
    navigate(paths.gallery);
  };

  return (
    <AuthLayout
      title={`Welcome back, ${me.name}`}
      subtitle="Twofold locked itself to keep your photos safe. Enter your password to open it."
      footer={
        <>
          Not {me.name}? <Link to={paths.login}>Use another account</Link>
        </>
      }
    >
      <div className="unlock__account">
        <Avatar person={me} size="lg" />
        <span className="unlock__text">
          <span className="unlock__name">{me.name}</span>
          <span className="unlock__email">{me.email}</span>
        </span>
      </div>
      <form className="form" onSubmit={onSubmit} noValidate>
        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.currentTarget.value);
            setError(null);
          }}
          error={error}
        />
        <button type="submit" className="btn btn--primary btn--block btn--lg">
          Unlock
        </button>
        <div className="form__row form__row--center">
          <Link to={paths.recover} className="text-link">
            Forgot password? Use your recovery key
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
