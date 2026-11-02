import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { useAccount, useMe } from '../app/account';
import { Link, useRouter } from '../app/router';
import { parseNext, paths, withNext } from '../app/routes';
import { useSubmit } from '../app/use-submit';
import { AuthLayout } from '../components/AuthLayout';
import { Avatar } from '../components/Brand';
import { PasswordField } from '../components/Field';

import './unlock.css';

/** Shown to a returning user whose session is still valid but whose keys are not in memory. */
export function Unlock() {
  const { navigate, search } = useRouter();
  const next = parseNext(search);
  const { unlock, logOut } = useAccount();
  const me = useMe();
  const { busy, error, setError, run } = useSubmit();
  const [password, setPassword] = useState('');

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!password) {
      setError('Enter your password to unlock.');
      return;
    }
    // The same box opens either space; the slot the password fits decides which. This
    // happens on this device: the password and keys are not sent anywhere.
    void run(() => unlock(password)).then((ok) => {
      if (ok) navigate(next ?? paths.gallery);
    });
  };

  const switchAccount = () => {
    void logOut().then(() => {
      navigate(withNext(paths.login, next));
    });
  };

  return (
    <AuthLayout
      title={`Welcome back, ${me.name}`}
      subtitle="Arcafold locked itself to keep your photos safe. Enter your password to open it."
      footer={
        <>
          Not {me.name}?{' '}
          <button type="button" className="text-link" onClick={switchAccount}>
            Use another account
          </button>
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
        <button
          type="submit"
          className="btn btn--primary btn--block btn--lg"
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? 'Unlocking…' : 'Unlock'}
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
