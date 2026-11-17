import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
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
import { useAccount } from '../session/account';
import { AUTO_LOCK_CHOICES, autoLockLabel } from '../session/auto-lock';
import { biometricsAvailable } from '../session/biometric';
import { Banner, Button, Field } from '../ui/kit';
import { usePalette } from '../ui/theme';
import type { Palette } from '../ui/theme';

function Section({
  title,
  palette,
  children,
}: {
  title: string;
  palette: Palette;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: palette.muted }]} accessibilityRole="header">
        {title}
      </Text>
      <View
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
      >
        {children}
      </View>
    </View>
  );
}

function Row({
  title,
  detail,
  palette,
  action,
}: {
  title: string;
  detail?: string;
  palette: Palette;
  action?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: palette.text }]}>{title}</Text>
        {detail ? <Text style={[styles.rowDetail, { color: palette.muted }]}>{detail}</Text> : null}
      </View>
      {action}
    </View>
  );
}

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
  const palette = usePalette();
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
    <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
      <Pressable style={styles.dismiss} onPress={busy ? undefined : onDone} />
      <View style={[styles.sheet, { backgroundColor: palette.surface }]}>
        <Text style={[styles.sheetTitle, { color: palette.text }]} accessibilityRole="header">
          Turn on fingerprint unlock
        </Text>
        <Text style={[styles.rowDetail, { color: palette.muted }]}>
          Enter your main password once. Android then asks for your fingerprint or face.
        </Text>
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
        <Button kind="link" label="Cancel" onPress={busy ? () => undefined : onDone} />
      </View>
    </KeyboardAvoidingView>
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

/**
 * The phone's settings, over the timeline (in the app's own window, so screenshot blocking
 * covers it): the account, fingerprint unlock and auto-lock, devices, and signing out.
 */
export function Settings({
  session,
  onClose,
  onBackedUp,
}: {
  session: Session;
  onClose: () => void;
  /** Photos were backed up just now, so the library should show them. */
  onBackedUp: () => void;
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
  const { name, email } = session.account;
  const fingerprintOn = biometricFor === email;
  // Fingerprint unlock opens only the main library, so it's set from there.
  const showFingerprint = space === 'main' && (fingerprintOn || biometricsAvailable());

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
          hitSlop={12}
          style={styles.back}
        >
          <Text style={[styles.backText, { color: palette.text }]}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Settings
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[
            styles.profile,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <View style={[styles.avatar, { backgroundColor: palette.accent }]}>
            <Text style={[styles.avatarText, { color: palette.onAccent }]}>
              {(name.trim().at(0) ?? '?').toUpperCase()}
            </Text>
          </View>
          <View style={styles.rowText}>
            <Text style={[styles.profileName, { color: palette.text }]}>{name}</Text>
            <Text style={[styles.rowDetail, { color: palette.muted }]}>{email}</Text>
          </View>
        </View>

        <Section title="Security" palette={palette}>
          {showFingerprint ? (
            <Row
              title="Fingerprint or face unlock"
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
          <View style={styles.row}>
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
                          ? { backgroundColor: palette.accent, borderColor: palette.accent }
                          : { borderColor: palette.border },
                      ]}
                    >
                      <Text
                        style={[
                          styles.choiceText,
                          { color: chosen ? palette.onAccent : palette.text },
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

        <Section title="Devices" palette={palette}>
          <Devices palette={palette} />
        </Section>

        <Section title="This phone" palette={palette}>
          <View style={styles.rowPad}>
            <Button kind="secondary" label="Lock now" onPress={lock} />
            <Button
              kind="secondary"
              label="Sign out"
              onPress={() => {
                void logOut();
              }}
            />
            <Button
              kind="link"
              label="Sign out and forget this account"
              onPress={() => {
                void forgetAccount();
              }}
            />
          </View>
        </Section>
      </ScrollView>
      {askingPassword ? (
        <PasswordSheet
          onDone={() => {
            setAskingPassword(false);
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
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 34, lineHeight: 38 },
  title: { fontSize: 22, fontWeight: '700' },
  content: { padding: 16, paddingBottom: 48, gap: 20 },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 20, fontWeight: '700' },
  profileName: { fontSize: 18, fontWeight: '700' },
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
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowDetail: { fontSize: 14, lineHeight: 20 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  pillText: { fontSize: 14, fontWeight: '600' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  choice: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  choiceText: { fontSize: 14, fontWeight: '600' },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  dismiss: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
    gap: 14,
  },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
});
