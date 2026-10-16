import { useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';

import { useRouter } from '../app/router';
import { paths } from '../app/routes';
import { useTheme } from '../app/theme';
import type { ThemePreference } from '../app/theme';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { Avatar, CoupleAvatars } from '../components/Brand';
import { Dialog } from '../components/Dialog';
import { PasswordField } from '../components/Field';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { formatShortDay, formatTime, pluralize } from '../lib/format';
import { MIN_PASSWORD_LENGTH } from '../lib/password';
import { devices, me, pairedSince, partner } from '../mock/data';

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

type DialogName = 'password' | 'unpair' | 'delete' | null;

export function Settings() {
  const { navigate } = useRouter();
  const { theme, setTheme } = useTheme();
  const { state } = useVault();
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogName>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [autoLock, setAutoLock] = useState('15');

  const closeDialog = () => {
    setDialog(null);
    setCurrent('');
    setNext('');
    setPasswordError(null);
  };

  const onChangePassword = (event: SubmitEvent) => {
    event.preventDefault();
    if (!current) {
      setPasswordError('Enter your current password.');
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`);
      return;
    }
    closeDialog();
    toast.show('Password changed');
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

      <Section title="Your partner">
        <div className="profile">
          <CoupleAvatars a={me} b={partner} />
          <div className="profile__text">
            <span className="profile__name">Paired with {partner.name}</span>
            <span className="profile__email">
              Since {formatShortDay(pairedSince)} · {pluralize(state.photos.length, 'photo')}{' '}
              together
            </span>
          </div>
        </div>
        <Row
          icon="users"
          title="Unpair"
          description={`Stop sharing this vault with ${partner.name}.`}
          action={
            <button
              type="button"
              className="btn btn--danger-ghost btn--sm"
              onClick={() => {
                setDialog('unpair');
              }}
            >
              Unpair
            </button>
          }
        />
      </Section>

      <Section title="Security">
        <Row
          icon="key"
          title="Password"
          description="Unlocks your photos on every device."
          action={
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => {
                setDialog('password');
              }}
            >
              Change
            </button>
          }
        />
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
        <Row
          icon="lock"
          title="Auto-lock"
          description="Lock the vault after a while without use."
          action={
            <select
              className="select"
              aria-label="Auto-lock after"
              value={autoLock}
              onChange={(event) => {
                setAutoLock(event.currentTarget.value);
              }}
            >
              <option value="5">5 minutes</option>
              <option value="15">15 minutes</option>
              <option value="60">1 hour</option>
              <option value="0">When I close the tab</option>
            </select>
          }
        />
        <Row
          icon="lock"
          title="Lock now"
          description="Clears your key from memory on this device."
          action={
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => {
                navigate(paths.unlock);
              }}
            >
              Lock
            </button>
          }
        />
      </Section>

      <Section title="Devices">
        {devices.map((device) => (
          <Row
            key={device.id}
            icon={device.kind}
            title={device.name}
            description={
              device.current
                ? 'This device'
                : `Last active ${formatShortDay(device.lastActive)}, ${formatTime(device.lastActive)}`
            }
            action={
              device.current ? (
                <span className="pill">Current</span>
              ) : (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    toast.show(`Signed out of ${device.name}`);
                  }}
                >
                  Sign out
                </button>
              )
            }
          />
        ))}
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
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={() => {
            navigate(paths.welcome);
          }}
        >
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

      <Dialog open={dialog === 'password'} onClose={closeDialog} title="Change password">
        <form className="form" onSubmit={onChangePassword} noValidate>
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
            <button type="submit" className="btn btn--primary">
              Change password
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={dialog === 'unpair'}
        onClose={closeDialog}
        title={`Unpair from ${partner.name}?`}
        description={`You'll each keep a copy of the photos you added, but you won't see each other's anymore.`}
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
              navigate(paths.pair);
            }}
          >
            Unpair
          </button>
        </div>
      </Dialog>

      <Dialog
        open={dialog === 'delete'}
        onClose={closeDialog}
        title="Delete your account?"
        description="Your account and every photo you added will be permanently erased. This can't be undone."
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
              navigate(paths.welcome);
            }}
          >
            Delete account
          </button>
        </div>
      </Dialog>
    </div>
  );
}
