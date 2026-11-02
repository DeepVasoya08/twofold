import { useRef } from 'react';
import type { ReactNode } from 'react';

import { useAccount, useMe } from '../app/account';
import { useProfile } from '../app/profile';
import { Link, useRouter } from '../app/router';
import { paths } from '../app/routes';
import { useUploads } from '../app/uploads';
import { isViewOnly, useVault } from '../app/vault';
import { Avatar, LockBadge, Logo } from './Brand';
import { DownloadDialog } from './DownloadDialog';
import { DownloadProgress } from './DownloadProgress';
import { SearchBar } from './SearchBar';
import { SmartSearchCard } from './SmartSearchCard';
import { Icon } from './Icon';
import { InviteRequests } from './Invites';
import type { IconName } from './Icon';
import { SmartFeaturesPrompt } from './SmartFeaturesPrompt';
import { StorageMeter } from './StorageMeter';
import { UploadDialog } from './UploadDialog';
import { UploadProgress } from './UploadProgress';

import './app-shell.css';

const nav: {
  to: string;
  label: string;
  icon: IconName;
  match: (path: string) => boolean;
}[] = [
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
    to: paths.people,
    label: 'People',
    icon: 'person',
    match: (path) => path.startsWith(paths.people),
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
    match: (path) => path.startsWith(paths.settings),
  },
];

interface AppShellProps {
  children: ReactNode;
  /** New uploads go into this album as well as the timeline. */
  uploadAlbumId?: string;
}

/** Signed-in chrome: a sidebar on wide screens, a top bar and bottom tabs on phones. */
export function AppShell({ children, uploadAlbumId }: AppShellProps) {
  const { pathname, navigate } = useRouter();
  const { space, state } = useVault();
  // An album you can only view can't take photos, so uploads there go to your timeline.
  const target = state.albums.find((album) => album.id === uploadAlbumId);
  const uploadTarget = target && isViewOnly(target) ? undefined : uploadAlbumId;
  const { lock: lockAccount } = useAccount();
  const me = useMe();
  const { photo } = useProfile();
  const { openDialog: openUpload } = useUploads();
  const isPrivate = space === 'private';
  const searchInput = useRef<HTMLInputElement>(null);
  // Locking drops the keys and every decrypted photo; the next password decides the space.
  const lock = () => {
    lockAccount();
    navigate(paths.unlock);
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside className="shell__sidebar">
        <div className="shell__brand-row">
          <Link to={paths.gallery} className="shell__brand" aria-label="Arcafold photos">
            <Logo size={30} />
          </Link>
          {isPrivate && <PrivatePill />}
        </div>
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
        <div className="shell__storage">
          <StorageMeter compact />
        </div>
        <div className="shell__account">
          <Avatar person={me} size="sm" src={photo} />
          <div className="shell__account-text">
            <span className="shell__account-name">{me.name}</span>
            <LockBadge label="Encrypted" />
          </div>
          <button type="button" className="icon-btn" onClick={lock} aria-label="Lock Arcafold">
            <Icon name="lock" size={18} />
          </button>
        </div>
      </aside>

      <header className="shell__topbar">
        <div className="shell__brand-row">
          <Link to={paths.gallery} className="shell__brand" aria-label="Arcafold photos">
            <Logo size={26} />
          </Link>
          {isPrivate && <PrivatePill />}
        </div>
        <div className="shell__topbar-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              searchInput.current?.scrollIntoView({ block: 'center' });
              searchInput.current?.focus();
            }}
            aria-label="Search"
          >
            <Icon name="search" />
          </button>
          <button type="button" className="icon-btn" onClick={lock} aria-label="Lock Arcafold">
            <Icon name="lock" />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--accent"
            onClick={openUpload}
            aria-label="Upload photos"
          >
            <Icon name="upload" />
          </button>
        </div>
      </header>

      <main className="shell__content" id="content">
        <div className="shell__search">
          <SearchBar inputRef={searchInput} />
        </div>
        <InviteRequests />
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

      <UploadDialog albumId={uploadTarget} />
      <DownloadDialog />
      <SmartFeaturesPrompt />
      <div className="status-cards">
        <UploadProgress />
        <DownloadProgress />
        <SmartSearchCard />
      </div>
    </div>
  );
}

/** Shown only inside the private space, so you always know where you are. */
function PrivatePill() {
  return (
    <span className="private-pill">
      <Icon name="eye-off" size={13} />
      Private
    </span>
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
