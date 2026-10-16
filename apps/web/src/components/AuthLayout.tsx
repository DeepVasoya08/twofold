import type { ReactNode } from 'react';

import { Link } from '../app/router';
import { paths } from '../app/routes';
import { initialPhotos } from '../mock/data';
import { Logo } from './Brand';
import { Icon } from './Icon';

import './auth-layout.css';

const collage = ['p006', 'p016', 'p013']
  .map((id) => initialPhotos.find((photo) => photo.id === id))
  .filter((photo) => photo !== undefined);

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
        <div className="auth__collage">
          {collage.map((photo, index) => (
            <figure key={photo.id} className={`auth__polaroid auth__polaroid--${String(index)}`}>
              <img src={photo.src} alt="" />
            </figure>
          ))}
        </div>
        <blockquote className="auth__quote">
          <p>Every photo is locked on your device before it leaves. Only you hold the key.</p>
          <span className="auth__quote-mark">
            <Icon name="lock" size={14} /> End-to-end encrypted
          </span>
        </blockquote>
      </aside>
      <main className="auth__main">
        <header className="auth__top">
          <Link to={paths.welcome} className="auth__logo" aria-label="Twofold home">
            <Logo size={28} />
          </Link>
          {step && (
            <span className="auth__step">
              Step {step.current} of {step.total}
            </span>
          )}
        </header>
        <div className="auth__panel">
          <h1 className="auth__title">{title}</h1>
          {subtitle && <p className="auth__subtitle">{subtitle}</p>}
          {children}
        </div>
        {footer && <footer className="auth__footer">{footer}</footer>}
      </main>
    </div>
  );
}
