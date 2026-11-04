import { useCallback, useEffect, useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';

import type { SpaceKeys } from '@arcafold/crypto';
import type { Device, MemberAccess } from '@arcafold/types';

import { useAccount, useMe } from '../app/account';
import { useAutoLock } from '../app/auto-lock';
import { useProfile } from '../app/profile';
import { useRouter } from '../app/router';
import { paths } from '../app/routes';
import {
  leaveLibrary,
  listStillJoined,
  listMembers,
  removeMember,
  updateMemberAccess,
} from '../app/sharing';
import type { JoinedLibrary, Member } from '../app/sharing';
import { useTheme } from '../app/theme';
import type { ThemePreference } from '../app/theme';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { Avatar } from '../components/Brand';
import { Dialog } from '../components/Dialog';
import { PasswordField } from '../components/Field';
import { Icon } from '../components/Icon';
import { PeopleSettings } from '../components/PeopleSettings';
import { SearchSettings } from '../components/SearchSettings';
import type { IconName } from '../components/Icon';
import { ProfileDialog } from '../components/ProfileDialog';
import { StorageMeter } from '../components/StorageMeter';
import { api } from '@arcafold/core/api';
import { onVisibleAgain } from '../lib/when-visible';
import { AUTO_LOCK_CHOICES, parseAutoLock } from '../lib/auto-lock';
import { formatLastActive, formatShortDay, pluralize } from '../lib/format';
import { MIN_PASSWORD_LENGTH } from '../lib/password';
import { errorInput, errorMessage } from '@arcafold/core/errors';

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

type DialogName = 'profile' | 'main-password' | 'private-password' | 'delete' | null;

/** A sharing change waiting for confirmation: stop sharing with someone, or leave a library. */
type SharingChange = { kind: 'stop'; member: Member } | { kind: 'leave'; library: JoinedLibrary };

/** A library this space joined, with what its owner lets you do there. */
interface JoinedWithAccess extends JoinedLibrary {
  access: MemberAccess;
}

interface SharingLists {
  members: Member[];
  joined: JoinedWithAccess[];
}

/** What someone can do in a library, for a settings row. */
const ACCESS_DESCRIPTION: Record<MemberAccess, string> = {
  view: 'Permission: View only. They can see and download photos.',
  edit: 'Permission: Add and edit. They can also add, change and delete photos.',
};

const ACCESS_NAME: Record<MemberAccess, string> = { view: 'View only', edit: 'Add and edit' };

/** Everyone the library is shared with and their permission, as one line. */
export function sharedWithLine(members: readonly Pick<Member, 'name' | 'access'>[]): string {
  return members.map((member) => `${member.name} (${ACCESS_NAME[member.access]})`).join(', ');
}

function parseAccess(value: string): MemberAccess {
  return value === 'edit' ? 'edit' : 'view';
}

/** What you can do in a library someone shared with you. */
const JOINED_DESCRIPTION: Record<MemberAccess, string> = {
  view: 'You can view and download its photos.',
  edit: 'You can view, add and change its photos.',
};

/** Who the whole open space is shared with, and the libraries it joined. Null until loaded. */
function useSharingLists(keys: SpaceKeys | null) {
  const [lists, setLists] = useState<SharingLists | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!keys) return;
    let cancelled = false;
    // Libraries whose owner stopped sharing them drop out (and are forgotten) here.
    Promise.all([listMembers(keys), listStillJoined(keys)]).then(
      ([members, joined]) => {
        if (!cancelled) {
          setLists({
            members: members.filter((member) => member.album === null),
            // Albums shared one at a time are managed from the album, not here.
            joined: joined.filter((library) => library.album === undefined),
          });
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [keys, version]);
  const reload = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);
  // The other side may have stopped sharing or left meanwhile.
  useEffect(() => onVisibleAgain(reload), [reload]);
  return { lists, reload };
}

interface DeviceListState {
  devices: Device[];
  /** When the list arrived, for "Active 3 hours ago". */
  loadedAt: number;
}

/** Every device signed in to the account, this one first. Null until loaded. */
function useDevices() {
  const [list, setList] = useState<DeviceListState | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api.devices().then(
      ({ devices }) => {
        if (!cancelled) setList({ devices, loadedAt: Date.now() });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [version]);
  const reload = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);
  return { list, reload };
}

const UNKNOWN_DEVICE = 'Unknown device';

function DeviceRows() {
  const toast = useToast();
  const { list, reload } = useDevices();
  const [signingOut, setSigningOut] = useState<string | null>(null);

  if (!list) {
    return <Row icon="laptop" title="This device" description="Signed in now" />;
  }

  const signOut = (device: Device) => {
    if (signingOut) return;
    setSigningOut(device.id);
    api
      .signOutDevice(device.id)
      .then(
        () => {
          toast.show(`Signed out ${device.name || 'that device'}`);
        },
        (error: unknown) => {
          toast.show(errorMessage(error));
        },
      )
      .finally(() => {
        setSigningOut(null);
        reload();
      });
  };

  return list.devices.map((device) => {
    const name = device.name || UNKNOWN_DEVICE;
    const active = device.current
      ? 'Active now'
      : formatLastActive(device.lastActive, list.loadedAt);
    const since = `Signed in ${formatShortDay(new Date(device.signedInAt).toISOString())}`;
    return (
      <Row
        key={device.id}
        icon={device.kind === 'computer' ? 'laptop' : 'phone'}
        title={name}
        description={`${active} · ${since}`}
        action={
          device.current ? (
            <span className="pill">This device</span>
          ) : (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              aria-label={`Sign out ${name}`}
              disabled={signingOut !== null}
              aria-busy={signingOut === device.id}
              onClick={() => {
                signOut(device);
              }}
            >
              {signingOut === device.id ? 'Signing out…' : 'Sign out'}
            </button>
          )
        }
      />
    );
  });
}

/** The password input in a dialog that an error is shown under. */
type ErrorInput = 'current' | 'new' | 'confirm';

interface PasswordError {
  input: ErrorInput;
  message: string;
}

export function Settings() {
  const { navigate } = useRouter();
  const { theme, setTheme } = useTheme();
  const { space } = useVault();
  const account = useAccount();
  const me = useMe();
  const profile = useProfile();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const isPrivate = space === 'private';
  const [dialog, setDialog] = useState<DialogName>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordError, setPasswordError] = useState<PasswordError | null>(null);
  const autoLock = useAutoLock();
  const keys = account.state.status === 'unlocked' ? account.state.session.opened.space : null;
  const sharing = useSharingLists(keys);
  const [change, setChange] = useState<SharingChange | null>(null);
  const [accessBusy, setAccessBusy] = useState<string | null>(null);
  const where = isPrivate ? 'private space' : 'library';

  const closeDialog = () => {
    setDialog(null);
    setCurrent('');
    setNext('');
    setConfirm('');
    setPasswordError(null);
  };

  const showError = (input: ErrorInput, message: string) => {
    setPasswordError({ input, message });
  };
  const errorAt = (input: ErrorInput) =>
    passwordError?.input === input ? passwordError.message : null;

  /**
   * Runs an account change from a dialog. An error shows under the input it is about, or
   * under `otherwise` when it isn't about one.
   */
  const runInDialog = (operation: () => Promise<void>, done: () => void, otherwise: ErrorInput) => {
    setBusy(true);
    void operation()
      .then(done, (error: unknown) => {
        showError(errorInput(error) ?? otherwise, errorMessage(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const onChangeMain = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!current) {
      showError('current', 'Enter your current password.');
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      showError('new', `Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`);
      return;
    }
    runInDialog(
      () => account.changeMainPassword(current, next),
      () => {
        closeDialog();
        toast.show('Password changed');
      },
      'new',
    );
  };

  // In the main library this always reads "set up", whether or not a private space exists.
  const onSetPrivate = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    if (isPrivate && !current) {
      showError('current', 'Enter your current private password.');
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      showError('new', `Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`);
      return;
    }
    if (next !== confirm) {
      showError('confirm', "Passwords don't match.");
      return;
    }
    runInDialog(
      () => account.setPrivatePassword(isPrivate ? current : null, next),
      () => {
        closeDialog();
        toast.show(isPrivate ? 'Private password changed' : 'Private space ready');
      },
      'confirm',
    );
  };

  const onDelete = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!current) {
      showError('current', 'Enter your password to confirm.');
      return;
    }
    runInDialog(
      () => account.deleteAccount(current),
      () => {
        closeDialog();
        toast.show('Account deleted');
        navigate(paths.welcome);
      },
      'current',
    );
  };

  const onAccessChange = (member: Member, access: MemberAccess) => {
    if (!keys || accessBusy !== null || access === member.access) return;
    setAccessBusy(member.id);
    updateMemberAccess(keys, member.id, access)
      .then(
        () => {
          toast.show(
            access === 'edit'
              ? `${member.name} can add and edit now`
              : `${member.name} can only view now`,
          );
          sharing.reload();
        },
        (error: unknown) => {
          toast.show(errorMessage(error));
        },
      )
      .finally(() => {
        setAccessBusy(null);
      });
  };

  const onSharingChange = () => {
    if (!change || !keys || busy) return;
    setBusy(true);
    const run =
      change.kind === 'stop'
        ? removeMember(keys, change.member.id)
        : leaveLibrary(keys, change.library);
    run
      .then(
        () => {
          setChange(null);
          if (change.kind === 'stop') {
            toast.show(`Stopped sharing with ${change.member.name}`);
            sharing.reload();
          } else {
            toast.show(`Left ${change.library.name}’s library`);
            // Their photos leave the open space too.
            account.reloadVault();
          }
        },
        (error: unknown) => {
          toast.show(errorMessage(error));
        },
      )
      .finally(() => {
        setBusy(false);
      });
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
          <Avatar person={me} size="lg" src={profile.photo} />
          <div className="profile__text">
            <span className="profile__name">{me.name}</span>
            <span className="profile__email">{me.email}</span>
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--sm profile__edit"
            onClick={() => {
              setDialog('profile');
            }}
          >
            <Icon name="pencil" size={16} />
            Edit
          </button>
        </div>
      </Section>

      <Section title="Storage">
        <div className="settings-storage">
          <StorageMeter />
          <p className="settings-storage__note">
            The 1 GB limit covers everything your account stores, including photos you add to
            libraries shared with you.
          </p>
        </div>
      </Section>

      <Section title="Import">
        <Row
          icon="cloud"
          title="Google Photos"
          description={`Bring your photos and albums in from a Google Takeout export, into your ${where}.`}
          action={
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              aria-label="Import from Google Photos"
              onClick={() => {
                navigate(paths.import);
              }}
            >
              Import
            </button>
          }
        />
        <Row
          icon="cloud"
          title="Apple Photos"
          description={`Bring your photos in from a copy of your iCloud Photos or a Mac export, into your ${where}.`}
          action={
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              aria-label="Import from Apple Photos"
              onClick={() => {
                navigate(paths.importFrom('apple'));
              }}
            >
              Import
            </button>
          }
        />
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
        {sharing.lists && (
          <Row
            icon="users"
            title={
              sharing.lists.members.length === 0
                ? 'Not shared'
                : `Shared with ${pluralize(sharing.lists.members.length, 'person', 'people')}`
            }
            description={
              sharing.lists.members.length === 0
                ? `Only you can see this ${where}.`
                : sharedWithLine(sharing.lists.members)
            }
          />
        )}
        {sharing.lists?.members.map((member) => (
          <Row
            key={member.id}
            icon={member.access === 'edit' ? 'pencil' : 'eye'}
            title={member.name}
            description={ACCESS_DESCRIPTION[member.access]}
            action={
              <div className="settings-row__actions">
                <select
                  className="select"
                  aria-label={`What ${member.name} can do`}
                  value={member.access}
                  disabled={accessBusy === member.id}
                  onChange={(event) => {
                    onAccessChange(member, parseAccess(event.currentTarget.value));
                  }}
                >
                  <option value="view">View only</option>
                  <option value="edit">Add and edit</option>
                </select>
                <button
                  type="button"
                  className="btn btn--danger-ghost btn--sm"
                  aria-label={`Stop sharing with ${member.name}`}
                  onClick={() => {
                    setChange({ kind: 'stop', member });
                  }}
                >
                  Stop
                </button>
              </div>
            }
          />
        ))}
        <Row
          icon="link"
          title="Invite someone"
          description={
            isPrivate
              ? 'Share this private space with someone you trust.'
              : 'Share your library with someone you trust. Your private space is never included.'
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

      <Section title="Shared with you">
        {sharing.lists?.joined.map((library) => (
          <Row
            key={library.id}
            icon="albums"
            title={`${library.name}’s library`}
            description={`${JOINED_DESCRIPTION[library.access]} Its photos appear in your ${where}, marked as shared.`}
            action={
              <button
                type="button"
                className="btn btn--danger-ghost btn--sm"
                aria-label={`Leave ${library.name}’s library`}
                onClick={() => {
                  setChange({ kind: 'leave', library });
                }}
              >
                Leave
              </button>
            }
          />
        ))}
        <Row
          icon="key"
          title="Enter an invite code"
          description="Someone sent you a code like TWO-XXXX-XXXX? Enter it to join."
          action={
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => {
                navigate(paths.joinCode);
              }}
            >
              Enter code
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
          description="Lock Arcafold after a while without use."
          action={
            <select
              className="select"
              aria-label="Auto-lock after"
              value={String(autoLock.minutes)}
              onChange={(event) => {
                autoLock.setMinutes(parseAutoLock(event.currentTarget.value));
              }}
            >
              {AUTO_LOCK_CHOICES.map((choice) => (
                <option key={choice.minutes} value={String(choice.minutes)}>
                  {choice.label}
                </option>
              ))}
            </select>
          }
        />
      </Section>

      <Section title="People">
        <PeopleSettings />
      </Section>

      <Section title="Search">
        <SearchSettings />
      </Section>

      <Section title="Devices">
        <DeviceRows />
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

      <ProfileDialog open={dialog === 'profile'} onClose={closeDialog} />

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
            error={errorAt('current')}
          />
          <PasswordField
            label="New password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => {
              setNext(event.currentTarget.value);
              setPasswordError(null);
            }}
            error={errorAt('new')}
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
            : 'Choose a second password. Open Arcafold with it to see a separate space with its own photos and albums. Your main password will never show that it exists. If you set one up before, this replaces it, and your recovery key cannot open it.'
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
              error={errorAt('current')}
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
            error={errorAt('new')}
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
            error={errorAt('confirm')}
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
        open={change !== null}
        onClose={() => {
          setChange(null);
        }}
        title={
          change?.kind === 'leave'
            ? `Leave ${change.library.name}’s library?`
            : `Stop sharing with ${change?.member.name ?? ''}?`
        }
        description={
          change?.kind === 'leave'
            ? `Their photos will no longer appear in your ${where}. Photos you added stay in their library.`
            : `They will lose access to this ${where} right away. Photos they added stay here.`
        }
      >
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setChange(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            aria-busy={busy}
            onClick={onSharingChange}
          >
            {change?.kind === 'leave' ? 'Leave' : 'Stop sharing'}
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
            error={errorAt('current')}
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
