import { Link } from '../app/router';
import { paths } from '../app/routes';
import { Logo } from './Brand';

import './site-chrome.css';

/** Sections of the landing page. Plain links, so they work from the legal pages too. */
const sections = [
  { href: '/#private', label: 'Private space' },
  { href: '/#device', label: 'Smart search' },
  { href: '/#sharing', label: 'Sharing' },
  { href: '/#how', label: 'How it works' },
  { href: '/#faq', label: 'FAQ' },
];

/** The top bar of the landing and legal pages. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <Link to={paths.welcome} className="site-header__home" aria-label="Arcafold home">
        <Logo />
      </Link>
      <nav className="site-header__nav" aria-label="Main">
        {sections.map((section) => (
          <a key={section.href} href={section.href} className="site-header__link">
            {section.label}
          </a>
        ))}
      </nav>
      <div className="site-header__actions">
        <Link to={paths.login} className="btn btn--ghost btn--sm">
          Log in
        </Link>
        <Link to={paths.signup} className="btn btn--primary btn--sm site-header__signup">
          Get started
        </Link>
      </div>
    </header>
  );
}

/** The footer of the landing and legal pages. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <Logo size={28} />
          <p>An end-to-end encrypted photo library. No ads, no scanning.</p>
        </div>
        <nav className="site-footer__columns" aria-label="Footer">
          <div className="site-footer__column">
            <h2 className="site-footer__heading">Arcafold</h2>
            {sections.map((section) => (
              <a key={section.href} href={section.href}>
                {section.label}
              </a>
            ))}
          </div>
          <div className="site-footer__column">
            <h2 className="site-footer__heading">Account</h2>
            <Link to={paths.signup}>Create an account</Link>
            <Link to={paths.login}>Log in</Link>
            <Link to={paths.recover}>Use a recovery key</Link>
          </div>
          <div className="site-footer__column">
            <h2 className="site-footer__heading">Legal</h2>
            <Link to={paths.privacy}>Privacy Policy</Link>
            <Link to={paths.terms}>Terms of Use</Link>
          </div>
        </nav>
      </div>
      <p className="site-footer__fine">© {new Date().getFullYear()} Arcafold</p>
    </footer>
  );
}
