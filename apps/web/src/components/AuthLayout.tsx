import type { ReactNode } from 'react';

import { Link } from '../app/router';
import { paths } from '../app/routes';
import { landscapeDataUri } from '../mock/art';
import { Logo } from './Brand';
import { Icon } from './Icon';

import './auth-layout.css';

/*
 * Arcafold's own artwork, never a user's photo: nothing is decrypted before unlocking, and the
 * screen must look the same whichever password is typed next. Two arches: a day one for the
 * library, and a small night one tucked inside it for the private space.
 */
const DAY = landscapeDataUri({ seed: 23, palette: 'golden', width: 640, height: 800 });
const NIGHT = landscapeDataUri({ seed: 7, palette: 'night', width: 320, height: 400 });

/** The arch windows, large beside the form on wide screens and small above it on phones. */
function ArchArt({ small = false }: { small?: boolean }) {
  return (
    <span className={`arch-art${small ? ' arch-art--small' : ''}`} aria-hidden="true">
      <img className="arch-art__day" src={DAY} alt="" />
      <img className="arch-art__night" src={NIGHT} alt="" />
    </span>
  );
}

interface AuthLayoutProps {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Step indicator for multi-step flows, e.g. { current: 2, total: 3 }. */
  step?: { current: number; total: number };
}

/** Two-panel layout for sign up, log in and sharing; a single column on phones. */
export function AuthLayout({ title, subtitle, children, footer, step }: AuthLayoutProps) {
  return (
    <div className="auth">
      <aside className="auth__aside" aria-hidden="true">
        <ArchArt />
        <blockquote className="auth__quote">
          <p>Every photo is locked on your device before it leaves. Only you hold the key.</p>
          <span className="auth__quote-mark">
            <Icon name="lock" size={14} /> End-to-end encrypted
          </span>
        </blockquote>
      </aside>
      <main className="auth__main">
        <header className="auth__top">
          <Link to={paths.welcome} className="auth__logo" aria-label="Arcafold home">
            <Logo size={28} />
          </Link>
          {step && (
            <span className="auth__step">
              Step {step.current} of {step.total}
            </span>
          )}
        </header>
        <div className="auth__panel">
          <ArchArt small />
          <h1 className="auth__title">{title}</h1>
          {subtitle && <p className="auth__subtitle">{subtitle}</p>}
          {children}
        </div>
        {footer && <footer className="auth__footer">{footer}</footer>}
      </main>
    </div>
  );
}
