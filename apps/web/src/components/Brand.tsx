import { initials } from '../lib/format';
import type { Person } from '../mock/data';
import { Icon } from './Icon';

import './brand.css';

/** The mark: two overlapping circles, the two of you, folded into one place. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="logo-mark__a" cx="12" cy="16" r="9" />
      <circle className="logo-mark__b" cx="20" cy="16" r="9" />
      <path className="logo-mark__fold" d="M16 8.6a9 9 0 0 1 0 14.8 9 9 0 0 1 0-14.8z" />
    </svg>
  );
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo__word">Twofold</span>
    </span>
  );
}

export function Avatar({ person, size = 'md' }: { person: Person; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`avatar avatar--${size} avatar--${person.id}`} aria-hidden="true">
      {initials(person.name)}
    </span>
  );
}

export function CoupleAvatars({
  a,
  b,
  size = 'md',
}: {
  a: Person;
  b: Person;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span className="couple" role="img" aria-label={`${a.name} and ${b.name}`}>
      <Avatar person={a} size={size} />
      <Avatar person={b} size={size} />
    </span>
  );
}

/** A quiet reminder that everything here is end-to-end encrypted. */
export function LockBadge({ label = 'End-to-end encrypted' }: { label?: string }) {
  return (
    <span className="lock-badge">
      <Icon name="lock" size={14} />
      {label}
    </span>
  );
}
