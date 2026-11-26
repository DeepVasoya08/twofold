import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { api } from '@arcafold/core/api';
import { errorMessage } from '@arcafold/core/errors';
import type { Session } from '@arcafold/core/account';
import type { Device } from '@arcafold/types';

import { backupStatusText } from '../backup/backup-text';
import { lastRunText } from '../backup/last-run';
import { useBackup } from '../backup/use-backup';
import { lastActiveText, shortDay } from '../library/devices';
import { storageShown } from '../library/storage-text';
import { useAccount } from '../session/account';
import { useProfile } from '../session/profile';
import { AUTO_LOCK_CHOICES, autoLockLabel } from '../session/auto-lock';
import { biometricsAvailable } from '../session/biometric';
import { Avatar } from '../ui/avatar';
import { Banner, Button, Field } from '../ui/kit';
import { Icon } from '../ui/icons';
import { Sheet } from '../ui/sheet';
import { IconTile, PillButton, Row, Section } from '../ui/rows';
import { useAppearance } from '../ui/appearance';
import type { ThemeChoice } from '../ui/appearance-settings';
import { ChangeEmailSheet } from './ChangeEmailSheet';
import { ProfileSheet } from './ProfileSheet';
import { SharingSettings } from './SharingSettings';
import { SmartSettings } from './SmartSettings';
import type { Smart } from './SmartSettings';
import { fonts } from '../theme';
import { usePalette } from '../ui/theme';
import type { Palette } from '../ui/theme';

/** Every device signed in to the account, this one first; others can be signed out. */
function Devices({ palette }: { palette: Palette }) {
  const [list, setList] = useState<{ devices: Device[]; loadedAt: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [signingOut, setSigningOut] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.devices().then(
      ({ devices }) => {
        if (cancelled) return;
        setFailed(false);
        setList({
          devices: [...devices].sort((a, b) => Number(b.current) - Number(a.current)),
          loadedAt: Date.now(),
        });
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (!list) {
    return failed ? (
      <Row title="Devices couldn’t be loaded" detail="Check your connection." palette={palette} />
    ) : (
      <View style={styles.row}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  const signOut = (device: Device) => {
    if (signingOut) return;
    setSigningOut(device.id);
    setError(null);
    api
      .signOutDevice(device.id)
      .catch((caught: unknown) => {
        setError(errorMessage(caught));
      })
      .finally(() => {
        setSigningOut(null);
        setVersion((current) => current + 1);
      });
  };

  return (
    <>
      {list.devices.map((device) => {
        const name = device.name || 'Unknown device';
        const active = device.current
          ? 'This phone'
          : lastActiveText(device.lastActive, list.loadedAt);
        return (
          <Row
            key={device.id}
            title={name}
            icon="phone"
            detail={`${active} · Signed in ${shortDay(device.signedInAt)}`}
            palette={palette}
            action={
              device.current ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Sign out ${name}`}
                  disabled={signingOut !== null}
                  onPress={() => {
                    signOut(device);
                  }}
                  style={[styles.pill, { borderColor: palette.border }]}
                >
                  <Text style={[styles.pillText, { color: palette.text }]}>
                    {signingOut === device.id ? 'Signing out…' : 'Sign out'}
                  </Text>
                </Pressable>
              )
            }
          />
        );
      })}
      {error ? (
        <View style={styles.rowPad}>
          <Banner>{error}</Banner>
        </View>
      ) : null}
    </>
  );
}

/** Asks for the main password before fingerprint unlock is turned on from here. */
function PasswordSheet({ onDone }: { onDone: () => void }) {
  const { enableBiometricsWithPassword } = useAccount();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (busy) return;
    if (!password) {
      setError('Enter your main password.');
      return;
    }
    setBusy(true);
    setError(null);
    enableBiometricsWithPassword(password).then(
      () => {
        setBusy(false);
        setPassword('');
        onDone();
      },
      (caught: unknown) => {
        setBusy(false);
        setError(errorMessage(caught));
      },
    );
  };
  return (
    <Sheet
      title="Turn on fingerprint unlock"
      body="Enter your main password once. Android then asks for your fingerprint or face."
      busy={busy}
      onCancel={onDone}
    >
      <Field
        label="Main password"
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          setError(null);
        }}
        secure
        autoComplete="current-password"
        autoFocus
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {error ? <Banner>{error}</Banner> : null}
      <Button label="Turn on" busyLabel="Checking…" busy={busy} onPress={submit} />
    </Sheet>
  );
}

/** Automatic backup of the main library: on or off, and backing up now. */
function Backup({
  session,
  palette,
  onBackedUp,
}: {
  session: Session;
  palette: Palette;
  onBackedUp: () => void;
}) {
  const backup = useBackup(session, onBackedUp);
  const text = backupStatusText(backup.status);
  const running = backup.status.kind === 'running';
  return (
    <>
      <Row
        title="Back up new photos"
        icon="upload"
        detail={
          backup.on
            ? 'New photos on this phone go to your library by themselves, encrypted, even while Arcafold is locked or closed.'
            : 'Photos you take from now on go to your library, encrypted. Older ones stay as they are.'
        }
        palette={palette}
        action={
          backup.loaded && !backup.busy ? (
            <Switch
              accessibilityLabel="Back up new photos"
              value={backup.on}
              trackColor={{ true: palette.accent, false: palette.track }}
              thumbColor={palette.surface}
              onValueChange={(on) => {
                void (on ? backup.turnOn() : backup.turnOff());
              }}
            />
          ) : (
            <ActivityIndicator color={palette.accent} />
          )
        }
      />
      {backup.on ? (
        <Row
          title="Use mobile data"
          icon="signal"
          detail={
            backup.mobileData
              ? 'Backs up on Wi-Fi or mobile data, when the battery isn’t low.'
              : 'Backs up on Wi-Fi only, when the battery isn’t low.'
          }
          palette={palette}
          action={
            <Switch
              accessibilityLabel="Use mobile data"
              value={backup.mobileData}
              trackColor={{ true: palette.accent, false: palette.track }}
              thumbColor={palette.surface}
              onValueChange={(on) => {
                void backup.setMobileData(on);
              }}
            />
          }
        />
      ) : null}
      {backup.on || text ? (
        <View style={styles.rowPad}>
          {text ? (
            backup.status.kind === 'failed' ? (
              <Banner>{text}</Banner>
            ) : (
              <Text style={[styles.rowDetail, { color: palette.muted }]}>{text}</Text>
            )
          ) : null}
          {backup.on ? (
            <Text style={[styles.rowDetail, { color: palette.muted }]}>
              {lastRunText(backup.last)}
            </Text>
          ) : null}
          {backup.on ? (
            <Button
              kind="secondary"
              label="Back up now"
              busy={running}
              onPress={() => {
                void backup.backUpNow();
              }}
            />
          ) : null}
        </View>
      ) : null}
    </>
  );
}

const THEMES: readonly { id: ThemeChoice; label: string }[] = [
  { id: 'system', label: 'Phone setting' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/** A row of rounded choices, one of them picked. */
function Choices<T extends string>({
  choices,
  value,
  palette,
  onChange,
}: {
  choices: readonly { id: T; label: string }[];
  value: T;
  palette: Palette;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.choices} accessibilityRole="radiogroup">
      {choices.map((choice) => {
        const chosen = choice.id === value;
        return (
          <Pressable
            key={choice.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: chosen }}
            onPress={() => {
              onChange(choice.id);
            }}
            style={[
              styles.choice,
              chosen
                ? { backgroundColor: palette.text, borderColor: palette.text }
                : { borderColor: palette.border },
            ]}
          >
            <Text
              style={[styles.choiceText, { color: chosen ? palette.background : palette.text }]}
            >
              {choice.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The theme, for this phone. The private space stays night whatever the theme,
 * so you always know where you are.
 */
function Appearance({ palette }: { palette: Palette }) {
  const { theme, setTheme } = useAppearance();
  return (
    <>
      <View style={styles.rowTop}>
        <IconTile icon="theme" palette={palette} />
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: palette.text }]}>Theme</Text>
          <Text style={[styles.rowDetail, { color: palette.muted }]}>
            The private space always uses its night colours.
          </Text>
          <Choices choices={THEMES} value={theme} palette={palette} onChange={setTheme} />
        </View>
      </View>
    </>
  );
}

/**
 * The phone's settings, over the timeline (in the app's own window, so screenshot blocking
 * covers it): the account, fingerprint unlock and auto-lock, devices, and signing out.
 */
export function Settings({
  session,
  smart,
  onClose,
  onBackedUp,
  onShare,
  onJoin,
}: {
  session: Session;
  /** Face grouping and Smart search on this phone. */
  smart: Smart;
  onClose: () => void;
  /** Photos were backed up just now, so the library should show them. */
  onBackedUp: () => void;
  /** Opens the screen for inviting someone to the open space. */
  onShare: () => void;
  /** Opens the screen for entering an invite code. */
  onJoin: () => void;
}) {
  const {
    space,
    lock,
    logOut,
    forgetAccount,
    biometricFor,
    disableBiometrics,
    autoLockMinutes,
    setAutoLockMinutes,
  } = useAccount();
  const palette = usePalette();
  const [askingPassword, setAskingPassword] = useState(false);
  const [editing, setEditing] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);
  const profile = useProfile();
  const { name, email } = session.account;
  const fingerprintOn = biometricFor === email;
  // Fingerprint unlock opens only the main library, so it's set from there.
  const showFingerprint = space === 'main' && (fingerprintOn || biometricsAvailable());

  // The account's total across both spaces: the same figure in either one, as on the web.
  const [stored, setStored] = useState<{ label: string; fraction: number } | null>(null);
  useEffect(() => {
    let live = true;
    api.storage().then(
      ({ used, limit }) => {
        if (live) setStored(storageShown(used, limit));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  const hero =
    space === 'private'
      ? {
          background: '#1f2a6b',
          arch: 'rgba(140,156,255,0.18)',
          ink: palette.text,
          avatar: palette.accent,
          avatarInk: palette.onAccent,
          bar: palette.accent,
          editBg: 'rgba(140,156,255,0.22)',
        }
      : {
          background: palette.dark ? '#26338f' : '#2f4bf0',
          arch: 'rgba(255,255,255,0.14)',
          ink: '#ffffff',
          avatar: '#ffffff',
          avatarInk: '#2f4bf0',
          bar: '#ffffff',
          editBg: 'rgba(255,255,255,0.22)',
        };

  const close = useCallback(() => {
    if (askingPassword) setAskingPassword(false);
    else onClose();
  }, [askingPassword, onClose]);

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => {
      back.remove();
    };
  }, [close]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { paddingTop: (StatusBar.currentHeight ?? 24) + 12 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onClose}
          hitSlop={8}
          style={[styles.back, { backgroundColor: palette.surface, borderColor: palette.border }]}
        >
          <Icon name="back" size={18} color={palette.text} />
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Settings
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.profile, { backgroundColor: hero.background }]}>
          <View style={[styles.profileArch, { backgroundColor: hero.arch }]} />
          <View style={styles.profileTop}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
              onPress={() => {
                setEditing(true);
              }}
            >
              <Avatar
                imageId={profile.imageId}
                name={name}
                size={52}
                background={hero.avatar}
                ink={hero.avatarInk}
                {...(profile.imageId ? { borderColor: hero.avatar } : {})}
              />
            </Pressable>
            <View style={styles.rowText}>
              <Text style={[styles.profileName, { color: hero.ink }]} numberOfLines={1}>
                {name}
              </Text>
              <Text style={[styles.profileEmail, { color: hero.ink }]} numberOfLines={1}>
                {email}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
              onPress={() => {
                setEditing(true);
              }}
              hitSlop={6}
              style={[styles.edit, { backgroundColor: hero.editBg }]}
            >
              <Text style={[styles.editText, { color: hero.ink }]}>Edit</Text>
            </Pressable>
          </View>
          {stored ? (
            <View style={styles.storage}>
              <View style={styles.storageLine}>
                <Text style={[styles.storageText, { color: hero.ink }]}>Storage used</Text>
                <Text style={[styles.storageText, styles.soft, { color: hero.ink }]}>
                  {stored.label}
                </Text>
              </View>
              <View style={styles.storageTrack}>
                <View
                  style={[
                    styles.storageFill,
                    {
                      width: `${String(Math.round(stored.fraction * 100))}%`,
                      backgroundColor: hero.bar,
                    },
                  ]}
                />
              </View>
            </View>
          ) : null}
        </View>

        <Section title="Appearance" palette={palette}>
          <Appearance palette={palette} />
        </Section>

        <Section title="Security" palette={palette}>
          {session.account.emailVerified ? (
            <Row
              title="Email"
              detail="Used for sign-in alerts and codes. It can’t unlock your photos."
              palette={palette}
              action={
                <PillButton
                  label="Change"
                  accessibilityLabel="Change email"
                  palette={palette}
                  onPress={() => {
                    setChangingEmail(true);
                  }}
                />
              }
            />
          ) : null}
          {showFingerprint ? (
            <Row
              title="Fingerprint or face unlock"
              icon="lock"
              detail="Opens your library without your password."
              palette={palette}
              action={
                <Switch
                  accessibilityLabel="Fingerprint or face unlock"
                  value={fingerprintOn}
                  trackColor={{ true: palette.accent, false: palette.track }}
                  thumbColor={palette.surface}
                  onValueChange={(on) => {
                    if (on) setAskingPassword(true);
                    else disableBiometrics();
                  }}
                />
              }
            />
          ) : null}
          <View style={styles.rowTop}>
            <IconTile icon="clock" palette={palette} />
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: palette.text }]}>Auto-lock</Text>
              <Text style={[styles.rowDetail, { color: palette.muted }]}>
                Locks after {autoLockLabel(autoLockMinutes)} without a touch, even in the
                background.
              </Text>
              <View style={styles.choices}>
                {AUTO_LOCK_CHOICES.map((minutes) => {
                  const chosen = minutes === autoLockMinutes;
                  return (
                    <Pressable
                      key={minutes}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: chosen }}
                      onPress={() => {
                        setAutoLockMinutes(minutes);
                      }}
                      style={[
                        styles.choice,
                        chosen
                          ? { backgroundColor: palette.text, borderColor: palette.text }
                          : { borderColor: palette.border },
                      ]}
                    >
                      <Text
                        style={[
                          styles.choiceText,
                          { color: chosen ? palette.background : palette.text },
                        ]}
                      >
                        {minutes} min
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        </Section>

        {space === 'main' ? (
          <Section title="Backup" palette={palette}>
            <Backup session={session} palette={palette} onBackedUp={onBackedUp} />
          </Section>
        ) : null}

        <Section title="Smart features" palette={palette}>
          <SmartSettings smart={smart} palette={palette} />
        </Section>

        <Section title="Sharing" palette={palette}>
          <SharingSettings
            keys={session.opened.space}
            palette={palette}
            onShare={onShare}
            onJoin={onJoin}
            onLeft={onBackedUp}
          />
        </Section>

        <Section title="Devices" palette={palette}>
          <Devices palette={palette} />
        </Section>

        <View style={styles.endButtons}>
          <Pressable
            accessibilityRole="button"
            onPress={lock}
            style={[
              styles.endButton,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.endText, { color: palette.text }]}>Lock now</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void logOut();
            }}
            style={[styles.endButton, { borderColor: palette.error }]}
          >
            <Text style={[styles.endText, { color: palette.error }]}>Sign out</Text>
          </Pressable>
        </View>
        <Button
          kind="link"
          label="Sign out and forget this account"
          onPress={() => {
            void forgetAccount();
          }}
        />
      </ScrollView>
      {askingPassword ? (
        <PasswordSheet
          onDone={() => {
            setAskingPassword(false);
          }}
        />
      ) : null}
      {changingEmail ? (
        <ChangeEmailSheet
          onClose={() => {
            setChangingEmail(false);
          }}
        />
      ) : null}
      {editing ? (
        <ProfileSheet
          onClose={() => {
            setEditing(false);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: fonts.display, fontSize: 28, letterSpacing: -0.7 },
  content: { padding: 16, paddingBottom: 48, gap: 20 },
  profile: { borderRadius: 26, padding: 18, gap: 16, overflow: 'hidden' },
  profileArch: {
    position: 'absolute',
    right: -30,
    top: -10,
    width: 150,
    height: 190,
    borderTopLeftRadius: 75,
    borderTopRightRadius: 75,
  },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  edit: { height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center' },
  editText: { fontSize: 13, fontWeight: '700' },
  profileName: { fontFamily: fonts.display, fontSize: 20, letterSpacing: -0.3 },
  profileEmail: { fontSize: 13, opacity: 0.8 },
  storage: { gap: 6 },
  storageLine: { flexDirection: 'row', justifyContent: 'space-between' },
  storageText: { fontSize: 13, fontWeight: '600' },
  soft: { opacity: 0.8 },
  storageTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  storageFill: { height: 8, borderRadius: 4 },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  endButtons: { flexDirection: 'row', gap: 10 },
  endButton: {
    flex: 1,
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endText: { fontSize: 15, fontWeight: '600' },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginLeft: 4,
  },
  card: { borderWidth: 1, borderRadius: 18, paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowPad: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowDetail: { fontSize: 13, lineHeight: 18 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  pillText: { fontSize: 14, fontWeight: '600' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  choice: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  choiceText: { fontSize: 14, fontWeight: '600' },
});
