import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { Link, useRouter } from '../app/router';
import { paths } from '../app/routes';
import { AuthLayout } from '../components/AuthLayout';
import { CoupleAvatars } from '../components/Brand';
import { PasswordField } from '../components/Field';
import { me, partner } from '../mock/data';

import './unlock.css';

/** Shown to a returning user whose session is still valid but whose vault key is not in memory. */
export function Unlock() {
  const { navigate } = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!password) {
      setError('Enter your password to unlock.');
      return;
    }
    navigate(paths.gallery);
  };

  return (
    <AuthLayout
      title={`Welcome back, ${me.name}`}
      subtitle="Your vault locked itself to keep your photos safe. Enter your password to open it."
      footer={
        <>
          Not {me.name}? <Link to={paths.login}>Use another account</Link>
        </>
      }
    >
      <div className="unlock__couple">
        <CoupleAvatars a={me} b={partner} size="lg" />
        <span className="unlock__names">
          {me.name} &amp; {partner.name}&apos;s vault
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
          Unlock vault
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
