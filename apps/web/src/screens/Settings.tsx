import { useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';

import { useAccount, useMe } from '../app/account';
import { errorMessage } from '../app/account-ops';
import { useRouter } from '../app/router';
import { paths } from '../app/routes';
import { useTheme } from '../app/theme';
import type { ThemePreference } from '../app/theme';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { Avatar } from '../components/Brand';
import { Dialog } from '../components/Dialog';
import { PasswordField } from '../components/Field';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { formatShortDay } from '../lib/format';
import { MIN_PASSWORD_LENGTH } from '../lib/password';
import { contact, sharedSince } from '../mock/data';

import './settings.css';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `settings-${title.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section className="settings-section" aria-labelledby={id}>
      <h2 className="settings-section__title" id={id}>
        {title}
      </h2>
      <div className="settings-card">{children}</div>
    </section>
  );
}

function Row({
  icon,
  title,
  description,
  action,
}: {
  icon: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <span className="settings-row__icon">
        <Icon name={icon} size={20} />
      </span>
      <div className="settings-row__text">
        <span className="settings-row__title">{title}</span>
        {description && <span className="settings-row__description">{description}</span>}
      </div>
      {action && <div className="settings-row__action">{action}</div>}
    </div>
  );
}

const themes: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

type DialogName = 'main-password' | 'private-password' | 'stop-sharing' | 'delete' | null;

export function Settings() {
  const { navigate } = useRouter();
  const { theme, setTheme } = useTheme();
  const { space } = useVault();
  const account = useAccount();
  const me = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const isPrivate = space === 'private';
  const [dialog, setDialog] = useState<DialogName>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [autoLock, setAutoLock] = useState('15');
  // Sharing is not built yet, so nothing is shared.
  const [shared, setShared] = useState(false);

  const closeDialog = () => {
    setDialog(null);
    setCurrent('');
    setNext('');
    setConfirm('');
    setPasswordError(null);
  };

  /** Runs an account change from a dialog, showing any error in the dialog. */
  const runInDialog = (operation: () => Promise<void>, done: () => void) => {
    setBusy(true);
    void operation()
      .then(done, (error: unknown) => {
        setPasswordError(errorMessage(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const onChangeMain = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!current) {
      setPasswordError('Enter your current password.');
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`);
      return;
    }
    runInDialog(
      () => account.changeMainPassword(current, next),
      () => {
        closeDialog();
        toast.show('Password changed');
      },
    );
  };

  // In the main library this always reads "set up", whether or not a private space exists.
  const onSetPrivate = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    if (isPrivate && !current) {
      setPasswordError('Enter your current private password.');
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`);
      return;
    }
    if (next !== confirm) {
      setPasswordError("Passwords don't match.");
      return;
    }
    runInDialog(
      () => account.setPrivatePassword(isPrivate ? current : null, next),
      () => {
        closeDialog();
        toast.show(isPrivate ? 'Private password changed' : 'Private space ready');
      },
    );
  };

  const onDelete = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!current) {
      setPasswordError('Enter your password to confirm.');
      return;
    }
    runInDialog(
      () => account.deleteAccount(current),
      () => {
        closeDialog();
        toast.show('Account deleted');
        navigate(paths.welcome);
      },
    );
  };

  const signOut = () => {
    void account.logOut().then(() => {
      navigate(paths.welcome);
    });
  };

  return (
    <div className="page page--narrow">
      <PageHeader title="Settings" />

      <Section title="You">
        <div className="profile">
          <Avatar person={me} size="lg" />
          <div className="profile__text">
            <span className="profile__name">{me.name}</span>
            <span className="profile__email">{me.email}</span>
          </div>
        </div>
      </Section>

      <Section title="Passwords">
        <Row
          icon="key"
          title="Main password"
          description="Opens your photo library."
          action={
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => {
                setDialog('main-password');
              }}
            >
              Change
            </button>
          }
        />
        <Row
          icon="eye-off"
          title={isPrivate ? 'Private password' : 'Private space'}
          description={
            isPrivate
              ? 'Opens this private space. Type it in the same box as your main password.'
              : 'A second password that opens a separate space. Your main password never shows it.'
          }
          action={
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => {
                setDialog('private-password');
              }}
            >
              {isPrivate ? 'Change' : 'Set up'}
            </button>
          }
        />
      </Section>

      <Section title="Sharing">
        {shared ? (
          <Row
            icon="users"
            title={`Shared with ${contact.name}`}
            description={`Since ${formatShortDay(sharedSince)}. They see this library, and nothing else.`}
            action={
              <button
                type="button"
                className="btn btn--danger-ghost btn--sm"
                onClick={() => {
                  setDialog('stop-sharing');
                }}
              >
                Stop
              </button>
            }
          />
        ) : (
          <Row
            icon="users"
            title="Not shared"
            description={
              isPrivate ? 'Only you can see this private space.' : 'Only you can see this library.'
            }
          />
        )}
        <Row
          icon="link"
          title="Invite someone"
          description={
            isPrivate
              ? 'Share this private space with someone you trust.'
              : 'Share your library with someone you trust.'
          }
          action={
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => {
                navigate(paths.share);
              }}
            >
              Invite
            </button>
          }
        />
      </Section>

      <Section title="Security">
        {isPrivate ? (
          <Row
            icon="shield"
            title="Recovery key"
            description="Your recovery key only opens your main library. If you forget your private password, this space can't be recovered."
          />
        ) : (
          <Row
            icon="shield"
            title="Recovery key"
            description="Saved when you signed up. Make a new one if you've lost it."
            action={
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  navigate(paths.recoveryKey);
                }}
              >
                New key
              </button>
            }
          />
        )}
        <Row
          icon="lock"
          title="Auto-lock"
          description="Lock Twofold after a while without use."
          action={
            <select
              className="select"
              aria-label="Auto-lock after"
              value={autoLock}
              onChange={(event) => {
                setAutoLock(event.currentTarget.value);
              }}
            >
              <option value="1">1 minute</option>
              <option value="5">5 minutes</option>
              <option value="15">15 minutes</option>
              <option value="0">When I close the tab</option>
            </select>
          }
        />
      </Section>

      <Section title="Devices">
        <Row
          icon="laptop"
          title="This browser"
          description="Signed in now"
          action={<span className="pill">Current</span>}
        />
      </Section>

      <Section title="Appearance">
        <div className="theme-picker" role="radiogroup" aria-label="Theme">
          {themes.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={theme === option.value}
              className="theme-picker__option"
              onClick={() => {
                setTheme(option.value);
              }}
            >
              <span className={`theme-picker__swatch theme-picker__swatch--${option.value}`}>
                <Icon name={option.icon} size={18} />
              </span>
              {option.label}
            </button>
          ))}
        </div>
      </Section>

      <div className="settings-footer">
        <button type="button" className="btn btn--secondary btn--block" onClick={signOut}>
          <Icon name="logout" size={18} />
          Sign out
        </button>
        <button
          type="button"
          className="btn btn--danger-ghost btn--block"
          onClick={() => {
            setDialog('delete');
          }}
        >
          Delete account
        </button>
      </div>

      <Dialog open={dialog === 'main-password'} onClose={closeDialog} title="Change main password">
        <form className="form" onSubmit={onChangeMain} noValidate>
          <PasswordField
            label="Current password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => {
              setCurrent(event.currentTarget.value);
              setPasswordError(null);
            }}
          />
          <PasswordField
            label="New password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => {
              setNext(event.currentTarget.value);
              setPasswordError(null);
            }}
            error={passwordError}
            showStrength
          />
          <div className="dialog__actions">
            <button type="button" className="btn btn--ghost" onClick={closeDialog}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
              {busy ? 'Changing…' : 'Change password'}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={dialog === 'private-password'}
        onClose={closeDialog}
        title={isPrivate ? 'Change private password' : 'Set up a private space'}
        description={
          isPrivate
            ? undefined
            : 'Choose a second password. Open Twofold with it to see a separate space with its own photos and albums. Your main password will never show that it exists. If you set one up before, this replaces it, and your recovery key cannot open it.'
        }
      >
        <form className="form" onSubmit={onSetPrivate} noValidate>
          {isPrivate && (
            <PasswordField
              label="Current private password"
              autoComplete="off"
              value={current}
              onChange={(event) => {
                setCurrent(event.currentTarget.value);
                setPasswordError(null);
              }}
            />
          )}
          <PasswordField
            label={isPrivate ? 'New private password' : 'Private password'}
            autoComplete="off"
            value={next}
            onChange={(event) => {
              setNext(event.currentTarget.value);
              setPasswordError(null);
            }}
            showStrength
            hint="Make it different from your main password."
          />
          <PasswordField
            label="Confirm private password"
            autoComplete="off"
            value={confirm}
            onChange={(event) => {
              setConfirm(event.currentTarget.value);
              setPasswordError(null);
            }}
            error={passwordError}
          />
          <div className="dialog__actions">
            <button type="button" className="btn btn--ghost" onClick={closeDialog}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
              {busy ? 'Saving…' : isPrivate ? 'Change password' : 'Create private space'}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={dialog === 'stop-sharing'}
        onClose={closeDialog}
        title={`Stop sharing with ${contact.name}?`}
        description={`${contact.name} will lose access to this library. Photos they added stay with them.`}
      >
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={closeDialog}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              closeDialog();
              setShared(false);
              toast.show(`Stopped sharing with ${contact.name}`);
            }}
          >
            Stop sharing
          </button>
        </div>
      </Dialog>

      <Dialog
        open={dialog === 'delete'}
        onClose={closeDialog}
        title="Delete your account?"
        description="Your account and every photo in it will be permanently erased. This can't be undone."
      >
        <form className="form" onSubmit={onDelete} noValidate>
          <PasswordField
            label="Your password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => {
              setCurrent(event.currentTarget.value);
              setPasswordError(null);
            }}
            error={passwordError}
          />
          <div className="dialog__actions">
            <button type="button" className="btn btn--ghost" onClick={closeDialog}>
              Cancel
            </button>
            <button type="submit" className="btn btn--danger" disabled={busy} aria-busy={busy}>
              {busy ? 'Deleting…' : 'Delete account'}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
