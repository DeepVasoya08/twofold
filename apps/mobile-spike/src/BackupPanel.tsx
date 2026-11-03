import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { removeUploads, runBackup, signIn } from './backup-test';
import type { BackupProgress, BackupReport, SignedIn } from './backup-test';

const COUNT = 200;

function reportText(r: BackupReport): string {
  const spans = r.spans
    .map((s) => `${s.state} ${String(Math.round((s.to - s.from) / 1000))} s`)
    .join(', ');
  return [
    `Backup: ${String(r.uploaded)}/${String(r.total)} uploaded, ${String(r.failed)} failed, ${r.megabytes.toFixed(1)} MB in ${String(r.seconds)} s (${String(r.perPhotoMs)} ms per photo)`,
    `  finished while off screen: ${String(r.inBackground)}, longest pause ${String(Math.round(r.longestGapMs / 1000))} s`,
    `  app states: ${spans}`,
    `  battery optimisation off for app: ${r.ignoresBatteryOptimizations ? 'yes' : 'no'}`,
    ...r.errors.map((e) => `  error: ${e}`),
  ].join('\n');
}

interface Props {
  busy: boolean;
  setBusy: (label: string | null) => void;
  record: (key: string, value: string) => void;
}

/** Test 8: sign in to a throwaway account, then back up the newest 200 photos for real. */
export function BackupPanel({ busy, setBusy, record }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState<SignedIn | null>(null);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const guard = (label: string, work: () => Promise<void>) => () => {
    if (busy) return;
    setBusy(label);
    setError(null);
    work()
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setBusy(null);
      });
  };

  if (!session) {
    return (
      <View style={styles.box}>
        <Text style={styles.heading}>8. Background backup (test account)</Text>
        <Text style={styles.muted}>
          Sign in with a throwaway Arcafold account. Your newest {COUNT} photos will be uploaded
          to it, encrypted.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          autoCapitalize="none"
          autoComplete="off"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          autoComplete="off"
          value={password}
          onChangeText={setPassword}
        />
        <Pressable
          style={[styles.button, busy ? styles.disabled : null]}
          onPress={guard('Signing in', async () => {
            const signed = await signIn(email.trim(), password);
            setPassword('');
            setSession(signed);
            record('8a', `Sign-in: ${String(signed.ms)} ms (${signed.space} library)`);
          })}
        >
          <Text style={styles.buttonText}>Sign in</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Text style={styles.heading}>8. Background backup</Text>
      <Text style={styles.muted}>
        Signed in as {session.email}. Tap Start, then lock the phone or switch apps for a while,
        and come back.
      </Text>
      <Pressable
        style={[styles.button, busy ? styles.disabled : null]}
        onPress={guard('Backing up', async () => {
          const report = await runBackup(session, COUNT, setProgress);
          setUploaded((prev) => [...prev, ...report.ids]);
          record('8b', reportText(report));
        })}
      >
        <Text style={styles.buttonText}>Start: back up {COUNT} photos</Text>
      </Pressable>
      {progress ? (
        <Text style={styles.muted}>
          {progress.done} of {progress.total} uploaded
          {progress.failed ? `, ${String(progress.failed)} failed` : ''}
        </Text>
      ) : null}
      {uploaded.length > 0 ? (
        <Pressable
          style={[styles.secondary, busy ? styles.disabled : null]}
          onPress={guard('Removing test photos', async () => {
            const removed = await removeUploads(session, uploaded);
            setUploaded([]);
            record('8c', `Removed ${String(removed)} test photos from the account`);
          })}
        >
          <Text style={styles.secondaryText}>Remove the {uploaded.length} test photos</Text>
        </Pressable>
      ) : null}
      <Pressable
        style={[styles.secondary, busy ? styles.disabled : null]}
        onPress={guard('Signing out', async () => {
          await session.api.logOut();
          setSession(null);
        })}
      >
        <Text style={styles.secondaryText}>Sign out</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, padding: 12, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8 },
  heading: { fontWeight: '700' },
  muted: { color: '#555' },
  input: {
    borderWidth: 1,
    borderColor: '#9ca3af',
    borderRadius: 6,
    padding: 10,
    color: '#111',
  },
  button: { padding: 14, backgroundColor: '#1d4ed8', borderRadius: 8 },
  disabled: { opacity: 0.5 },
  buttonText: { color: 'white', fontWeight: '600' },
  secondary: { padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#1d4ed8' },
  secondaryText: { color: '#1d4ed8', fontWeight: '600' },
  error: { color: '#b91c1c' },
});
