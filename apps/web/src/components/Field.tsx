import { useId, useState } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

import { passwordStrength } from '@arcafold/core/password';
import { Icon } from './Icon';

import './field.css';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'>;

interface FieldProps extends InputProps {
  label: string;
  hint?: ReactNode;
  error?: string | null | undefined;
  type?: 'text' | 'email';
}

export function TextField({ label, hint, error, type = 'text', className, ...input }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={`field${error ? ' field--error' : ''}${className ? ` ${className}` : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        {...input}
        id={id}
        type={type}
        className="field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {error ? (
        <p className="field__error" id={`${id}-error`}>
          {error}
        </p>
      ) : (
        hint && (
          <p className="field__hint" id={`${id}-hint`}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}

interface PasswordFieldProps extends InputProps {
  label: string;
  hint?: ReactNode;
  error?: string | null | undefined;
  showStrength?: boolean;
  value: string;
}

export function PasswordField({
  label,
  hint,
  error,
  showStrength = false,
  value,
  className,
  ...input
}: PasswordFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const strength = passwordStrength(value);
  const describedBy = [
    error ? `${id}-error` : hint ? `${id}-hint` : null,
    showStrength && value ? `${id}-strength` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`field${error ? ' field--error' : ''}${className ? ` ${className}` : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__control">
        <input
          {...input}
          id={id}
          value={value}
          type={visible ? 'text' : 'password'}
          className="field__input field__input--with-action"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          spellCheck={false}
          autoCapitalize="off"
        />
        <button
          type="button"
          className="field__action"
          onClick={() => {
            setVisible((v) => !v);
          }}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          <Icon name={visible ? 'eye-off' : 'eye'} size={18} />
        </button>
      </div>
      {showStrength && value && (
        <div className="strength" id={`${id}-strength`} data-score={strength.score}>
          <span className="strength__bars" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span className="strength__label">{strength.label}</span>
        </div>
      )}
      {error ? (
        <p className="field__error" id={`${id}-error`}>
          {error}
        </p>
      ) : (
        hint && (
          <p className="field__hint" id={`${id}-hint`}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}
