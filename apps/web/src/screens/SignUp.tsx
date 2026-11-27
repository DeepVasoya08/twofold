import { useEffect, useState } from 'react';
import type { SubmitEvent } from 'react';

import { useAccount } from '../app/account';
import { Link, useRouter } from '../app/router';
import { parseNext, paths, withNext } from '../app/routes';
import { useSubmit } from '../app/use-submit';
import { AuthLayout } from '../components/AuthLayout';
import { PasswordField, TextField } from '../components/Field';
import { FormAlert } from '../components/FormAlert';
import { Icon } from '../components/Icon';
import { NO_CODE_SIGN_UP, confirmSignUpEmail, startSignUp } from '@arcafold/core/account';
import { MIN_PASSWORD_LENGTH, isValidEmail, passwordStrength } from '@arcafold/core/password';
import { RESEND_SECONDS } from './ConfirmEmail';

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
  const { busy, error, setError, run } = useSubmit();
  const [values, setValues] = useState({ name: '', email: '', password: '', confirm: '' });
  const [submitted, setSubmitted] = useState(false);
  /** Set once a code was emailed: the screen asks for it before making keys. */
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [sends, setSends] = useState(0);
  const errors = submitted ? validateSignUp(values) : {};

  // Counts down to when another code can be sent, from the clock so a background tab ends on time.
  useEffect(() => {
    if (sends === 0) return;
    const deadline = Date.now() + RESEND_SECONDS * 1000;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) clearInterval(timer);
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, [sends]);

  /** Keys and the recovery key are made here, on this device; the password goes no further. */
  const makeKeys = async (ticket?: string) => {
    await prepareSignUp(ticket ? { ...values, ticket } : values);
  };

  const set = (key: keyof typeof values) => (event: { currentTarget: HTMLInputElement }) => {
    const { value } = event.currentTarget;
    setValues((current) => ({ ...current, [key]: value }));
  };

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (busy || Object.keys(validateSignUp(values)).length > 0) return;
    // First a code to the email, when the server sends email; otherwise straight to the keys.
    let codeSent = false;
    void run(async () => {
      if ((await startSignUp(values.email)) === 'code-sent') {
        codeSent = true;
        return;
      }
      await makeKeys();
    }).then((ok) => {
      if (!ok) return;
      if (codeSent) {
        setCodeSentTo(values.email.trim().toLowerCase());
        setCode('');
        setSecondsLeft(RESEND_SECONDS);
        setSends((count) => count + 1);
      } else {
        navigate(withNext(paths.recoveryKey, next));
      }
    });
  };

  if (codeSentTo) {
    const onConfirm = (event: SubmitEvent) => {
      event.preventDefault();
      if (busy) return;
      if (!code.trim()) {
        setError('Enter the 6-digit code from the email.');
        return;
      }
      void run(async () => {
        await makeKeys(await confirmSignUpEmail(codeSentTo, code));
      }).then((ok) => {
        if (ok) navigate(withNext(paths.recoveryKey, next));
      });
    };
    const resend = () => {
      if (busy || secondsLeft > 0) return;
      void run(async () => {
        await startSignUp(codeSentTo);
      }).then((ok) => {
        if (!ok) return;
        setSecondsLeft(RESEND_SECONDS);
        setSends((count) => count + 1);
      });
    };
    return (
      <AuthLayout
        title="Check your email"
        subtitle={
          <>
            We sent a 6-digit code to <strong>{codeSentTo}</strong>. It works for 10 minutes.
          </>
        }
        step={{ current: 1, total: 2 }}
        footer={
          <>
            Already have an account? <Link to={withNext(paths.login, next)}>Log in</Link>
          </>
        }
      >
        <form className="form" onSubmit={onConfirm} noValidate>
          <TextField
            label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            className="confirm-email__code"
            value={code}
            onChange={(event) => {
              setCode(event.currentTarget.value);
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
            {busy ? 'Creating your keys…' : 'Continue'}
          </button>
          <p className="confirm-email__hint">{NO_CODE_SIGN_UP}</p>
          <div className="form__row form__row--center confirm-email__links">
            <button
              type="button"
              className="text-link"
              disabled={secondsLeft > 0 || busy}
              onClick={resend}
            >
              {secondsLeft > 0 ? `Send a new code in ${String(secondsLeft)}s` : 'Send a new code'}
            </button>
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setError(null);
                setCodeSentTo(null);
              }}
            >
              Change email
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

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
