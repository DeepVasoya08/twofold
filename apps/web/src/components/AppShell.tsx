import { useState } from 'react';
import type { ReactNode } from 'react';

import { Link, useRouter } from '../app/router';
import { paths } from '../app/routes';
import { me, partner } from '../mock/data';
import { CoupleAvatars, LockBadge, Logo } from './Brand';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { UploadDialog } from './UploadDialog';

import './app-shell.css';

const nav: { to: string; label: string; icon: IconName; match: (path: string) => boolean }[] = [
  {
    to: paths.gallery,
    label: 'Photos',
    icon: 'photos',
    match: (path) => path === paths.gallery || path.startsWith(`${paths.gallery}/`),
  },
  {
    to: paths.albums,
    label: 'Albums',
    icon: 'albums',
    match: (path) => path.startsWith(paths.albums),
  },
  {
    to: paths.favorites,
    label: 'Favorites',
    icon: 'heart',
    match: (path) => path === paths.favorites,
  },
  {
    to: paths.settings,
    label: 'Settings',
    icon: 'settings',
    match: (path) => path === paths.settings,
  },
];

interface AppShellProps {
  children: ReactNode;
  /** New uploads go into this album as well as the timeline. */
  uploadAlbumId?: string;
}

/** Signed-in chrome: a sidebar on wide screens, a top bar and bottom tabs on phones. */
export function AppShell({ children, uploadAlbumId }: AppShellProps) {
  const { pathname } = useRouter();
  const [uploading, setUploading] = useState(false);
  const openUpload = () => {
    setUploading(true);
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside className="shell__sidebar">
        <Link to={paths.gallery} className="shell__brand" aria-label="Twofold photos">
          <Logo size={30} />
        </Link>
        <button type="button" className="btn btn--primary btn--block" onClick={openUpload}>
          <Icon name="upload" size={18} />
          Upload
        </button>
        <nav className="shell__nav" aria-label="Main">
          {nav.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`shell__nav-link${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon name={item.icon} size={20} filled={active && item.icon === 'heart'} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="shell__couple">
          <CoupleAvatars a={me} b={partner} size="sm" />
          <div className="shell__couple-text">
            <span className="shell__couple-names">
              {me.name} &amp; {partner.name}
            </span>
            <LockBadge label="Encrypted vault" />
          </div>
        </div>
      </aside>

      <header className="shell__topbar">
        <Link to={paths.gallery} className="shell__brand" aria-label="Twofold photos">
          <Logo size={26} />
        </Link>
        <button
          type="button"
          className="icon-btn icon-btn--accent"
          onClick={openUpload}
          aria-label="Upload photos"
        >
          <Icon name="upload" />
        </button>
      </header>

      <main className="shell__content" id="content">
        {children}
      </main>

      <nav className="shell__tabs" aria-label="Main">
        {nav.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`shell__tab${active ? ' is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon name={item.icon} size={22} filled={active && item.icon === 'heart'} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <UploadDialog
        open={uploading}
        albumId={uploadAlbumId}
        onClose={() => {
          setUploading(false);
        }}
      />
    </div>
  );
}

/** Page heading row used by every signed-in screen. */
export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        {back && (
          <Link to={back.to} className="page-header__back">
            <Icon name="chevron-left" size={16} />
            {back.label}
          </Link>
        )}
        <h1 className="page-header__title">{title}</h1>
        {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}
