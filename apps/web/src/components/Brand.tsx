import { useId } from 'react';

import { initials } from '../lib/format';
import type { Person } from '../mock/data';
import { Icon } from './Icon';

import './brand.css';

/**
 * The mark: two arches folded over each other, your library with a private space tucked in
 * front of it. "Arca" is Latin for a chest or vault; the fold is the rest of the name. The
 * front arch is cut out of the back one by a thin gap, so the mark works on any background.
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  const gap = `logo-gap-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox={LOGO_VIEW_BOX}
      aria-hidden="true"
      focusable="false"
    >
      <mask id={gap}>
        <rect width="32" height="32" fill="#fff" />
        <path d={ARCH_FRONT} fill="#000" stroke="#000" strokeWidth="3" strokeLinejoin="round" />
      </mask>
      <path className="logo-mark__a" d={ARCH_BACK} mask={`url(#${gap})`} />
      <path className="logo-mark__b" d={ARCH_FRONT} />
    </svg>
  );
}

/** The two arches in a 32-unit square (scripts/render-images.mjs and favicon.svg match). */
export const LOGO_VIEW_BOX = '2 4 28 28';
const ARCH_BACK = 'M3 29V15a8 8 0 0 1 16 0v14z';
const ARCH_FRONT = 'M13 29V19a8 8 0 0 1 16 0v10z';

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
