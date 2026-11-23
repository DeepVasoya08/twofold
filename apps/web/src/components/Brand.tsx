import { initials } from '../lib/format';
import type { Person } from '../mock/data';
import { Icon } from './Icon';

import './brand.css';

/**
 * The mark: an arch with a smaller arch inside it, a private space within your library.
 * "Arca" is Latin for a chest or vault, and the arch is the shape the app is built around.
 */
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
      <path className="logo-mark__a" d={ARCH_OUTER} fillRule="evenodd" />
      <path className="logo-mark__b" d={ARCH_INNER} />
    </svg>
  );
}

/** The outer arch, with the doorway cut out of it. */
const ARCH_OUTER = 'M6 29V14.5a10 10 0 0 1 20 0V29zM11.5 29v-9a4.5 4.5 0 0 1 9 0v9z';
/** The inner arch that fills the doorway. */
const ARCH_INNER = 'M13.5 29v-8.6a2.5 2.5 0 0 1 5 0V29z';

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo__word">Arcafold</span>
    </span>
  );
}

/** A profile photo when there is one (a decrypted, in-memory URL), or else initials. */
export function Avatar({
  person,
  size = 'md',
  src = null,
}: {
  person: Person;
  size?: 'sm' | 'md' | 'lg';
  src?: string | null;
}) {
  return (
    <span
      className={`avatar avatar--${size} avatar--${person.id}${src ? ' avatar--photo' : ''}`}
      aria-hidden="true"
    >
      {src ? <img className="avatar__image" src={src} alt="" /> : initials(person.name)}
    </span>
  );
}

/** Two people side by side, e.g. you and someone you share a library with. */
export function AvatarPair({
  a,
  b,
  size = 'md',
}: {
  a: Person;
  b: Person;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span className="avatar-pair" role="img" aria-label={`${a.name} and ${b.name}`}>
      <Avatar person={a} size={size} />
      <Avatar person={b} size={size} />
    </span>
  );
}

/** A quiet reminder that everything here is end-to-end encrypted. */
export function LockBadge({ label = 'End-to-end encrypted' }: { label?: string | undefined }) {
  return (
    <span className="lock-badge">
      <Icon name="lock" size={14} />
      {label}
    </span>
  );
}
