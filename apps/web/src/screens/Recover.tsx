import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { useAccount } from '../app/account';
import { Link, useRouter } from '../app/router';
import { paths } from '../app/routes';
import { useToast } from '../app/toast';
import { useSubmit } from '../app/use-submit';
import { AuthLayout } from '../components/AuthLayout';
import { PasswordField, TextField } from '../components/Field';
import { FormAlert } from '../components/FormAlert';
import { MIN_PASSWORD_LENGTH, isValidEmail } from '../lib/password';

const RECOVERY_WORDS = 12;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function Recover() {
  const { navigate } = useRouter();
  const toast = useToast();
  const { recover } = useAccount();
  const { busy, error, setError, run } = useSubmit();
  const [email, setEmail] = useState('');
  const [words, setWords] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const wordCount = countWords(words);
  const errors = {
    email: submitted && !isValidEmail(email) ? 'Enter a valid email address.' : null,
    words:
      submitted && wordCount !== RECOVERY_WORDS
        ? `Your recovery key has ${String(RECOVERY_WORDS)} words. You've entered ${String(wordCount)}.`
        : null,
    password:
      submitted && password.length < MIN_PASSWORD_LENGTH
        ? `Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`
        : null,
  };

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (
      busy ||
      !isValidEmail(email) ||
      wordCount !== RECOVERY_WORDS ||
      password.length < MIN_PASSWORD_LENGTH
    ) {
      return;
    }
    void run(() => recover(email.trim(), words, password)).then((ok) => {
      if (!ok) return;
      toast.show('Password reset. Welcome back.');
      navigate(paths.gallery);
    });
  };

  return (
    <AuthLayout
      title="Recover your vault"
      subtitle="Enter the 12-word recovery key you saved when you signed up, then choose a new password for your library."
      footer={
        <>
          Remembered it? <Link to={paths.login}>Log in</Link>
        </>
      }
    >
      <form className="form" onSubmit={onSubmit} noValidate>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.currentTarget.value);
            setError(null);
          }}
          error={errors.email}
        />
        <div className={`field${errors.words ? ' field--error' : ''}`}>
          <label className="field__label" htmlFor="recovery-words">
            Recovery key
          </label>
          <textarea
            id="recovery-words"
            className="field__input field__textarea"
            rows={3}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="maple river garden …"
            value={words}
            onChange={(event) => {
              setWords(event.currentTarget.value);
              setError(null);
            }}
            aria-invalid={errors.words ? true : undefined}
            aria-describedby="recovery-words-note"
          />
          <p className={errors.words ? 'field__error' : 'field__hint'} id="recovery-words-note">
            {errors.words ?? `${String(wordCount)} of ${String(RECOVERY_WORDS)} words`}
          </p>
        </div>
        <PasswordField
          label="New password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.currentTarget.value);
            setError(null);
          }}
          error={errors.password}
          showStrength
        />
        <FormAlert message={error} />
        <button
          type="submit"
          className="btn btn--primary btn--block btn--lg"
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? 'Checking your key…' : 'Reset password'}
        </button>
      </form>
    </AuthLayout>
  );
}
