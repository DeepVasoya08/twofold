import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { BackupPanel } from './src/BackupPanel';
import { caughtErrors, onCaughtError } from './src/crash-guard';
import { checkWebFixture, sharePhoneFixture, timeArgon2 } from './src/crypto-runner';
import { scanDisk } from './src/disk-scan';
import { Grid } from './src/Grid';
import type { GridReport } from './src/Grid';
import type { Check } from './src/interop';
import { checkModel, ensureClip, sfaceUri } from './src/models';
import type { ModelReport, Provider } from './src/models';

function deviceName(): string {
  const constants: Record<string, unknown> = Platform.constants;
  const parts = [
    constants.Manufacturer,
    constants.Model,
    `${Platform.OS} ${String(Platform.Version)}`,
  ];
  return parts.filter((part) => typeof part === 'string' && part.length > 0).join(' ');
}

const DEVICE = deviceName();
const PROVIDERS: Provider[] = ['cpu', 'xnnpack', 'nnapi'];

function checksText(title: string, checks: Check[]): string {
  const failed = checks.filter((c) => !c.ok);
  const lines = [
    `${title}: ${String(checks.length - failed.length)}/${String(checks.length)} passed`,
  ];
  for (const c of failed) lines.push(`  FAILED ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
  return lines.join('\n');
}

function modelText(r: ModelReport): string {
  if (r.error) return `${r.model} on ${r.provider}: error ${r.error}`;
  return `${r.model} on ${r.provider}: match ${r.minCosine.toFixed(5)}, ${String(r.runMs)} ms/run, load ${String(r.loadMs)} ms`;
}

export default function App() {
  const [tab, setTab] = useState<'tests' | 'grid'>('tests');
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<readonly string[]>(caughtErrors());

  useEffect(
    () =>
      onCaughtError(() => {
        setErrors([...caughtErrors()]);
        setBusy(null);
      }),
    [],
  );

  const record = (key: string, value: string) => {
    setResults((prev) => ({ ...prev, [key]: value }));
  };

  const run = (label: string, work: () => Promise<void> | void) => async () => {
    if (busy) return;
    setBusy(label);
    try {
      await work();
    } catch (error) {
      record(label, `${label}: error ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const tests = [
    {
      label: '1. Open web-made data',
      work: async () => {
        const report = await checkWebFixture();
        record(
          '1',
          `${checksText('Web fixture on this phone', report.checks)}\n  unlock times ${report.unlockMs.join(', ')} ms`,
        );
      },
    },
    {
      label: '2. Make data for the web to open',
      work: async () => {
        const checks = await sharePhoneFixture(DEVICE);
        record(
          '2',
          `${checksText('Phone fixture (self-check)', checks)}\n  shared as arcafold-phone-fixture.json`,
        );
      },
    },
    {
      label: '3. Argon2id timing (64 MiB, 3 passes)',
      work: async () => {
        const t = await timeArgon2();
        record('3', `Argon2id: median ${String(t.median)} ms (runs ${t.runs.join(', ')})`);
      },
    },
    {
      label: '4. Face model (SFace) vs web',
      work: async () => {
        const uri = await sfaceUri();
        const lines: string[] = [];
        for (const p of PROVIDERS) lines.push(modelText(await checkModel('sface', uri, p)));
        record('4', lines.join('\n'));
      },
    },
    {
      label: '5. Search model (CLIP) vs web — downloads 89 MB',
      work: async () => {
        const uri = await ensureClip((done) => {
          setBusy(`Downloading resources ${String(Math.round(done * 100))}%`);
        });
        setBusy('Running search model');
        const lines: string[] = [];
        for (const p of PROVIDERS) lines.push(modelText(await checkModel('clip', uri, p)));
        record('5', lines.join('\n'));
      },
    },
    {
      label: '7. Look for photos on disk',
      work: () => {
        const scan = scanDisk();
        record(
          '7',
          `Disk: ${String(scan.files)} files, ${(scan.bytes / 1e6).toFixed(1)} MB, image files: ${String(scan.images.length)}, system files skipped: ${String(scan.unreadable.length)}${scan.images.length ? `\n  ${scan.images.slice(0, 5).join('\n  ')}` : ''}`,
        );
      },
    },
  ];

  const summary = [
    `Arcafold spike on ${DEVICE}`,
    ...Object.keys(results)
      .sort()
      .map((k) => results[k]),
    ...(errors.length ? [`Uncaught errors:\n  ${errors.join('\n  ')}`] : []),
  ].join('\n\n');

  if (tab === 'grid') {
    return (
      <View style={styles.fill}>
        <Pressable
          style={styles.back}
          onPress={() => {
            setTab('tests');
          }}
        >
          <Text style={styles.link}>‹ Back to tests</Text>
        </Pressable>
        <Grid
          onDone={(r: GridReport) => {
            record(
              '6',
              `Grid: ${String(r.tiles)} tiles decrypted (median ${String(r.decryptMs)} ms), ${String(r.slowFrames)}/${String(r.frames)} JS frames over 25 ms in ${String(r.seconds)} s`,
            );
            setTab('tests');
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.title}>Arcafold phone spike</Text>
        <Text style={styles.muted}>{DEVICE}</Text>
        <Text style={styles.muted}>
          Run the tests in order, then tap Share results and send them back.
        </Text>
        {tests.map((t) => (
          <Pressable
            key={t.label}
            style={[styles.button, busy ? styles.disabled : null]}
            onPress={run(t.label, t.work)}
          >
            <Text style={styles.buttonText}>{t.label}</Text>
          </Pressable>
        ))}
        <Pressable
          style={[styles.button, busy ? styles.disabled : null]}
          onPress={() => {
            if (!busy) setTab('grid');
          }}
        >
          <Text style={styles.buttonText}>6. Scroll 5,000 encrypted photos</Text>
        </Pressable>
        <BackupPanel busy={busy !== null} setBusy={setBusy} record={record} />
        {busy ? <Text style={styles.busy}>Working: {busy}…</Text> : null}
        <View style={styles.results}>
          <Text selectable style={styles.mono}>
            {summary}
          </Text>
        </View>
        <Pressable style={styles.button} onPress={() => void Share.share({ message: summary })}>
          <Text style={styles.buttonText}>Share results</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: 'white' },
  page: { padding: 16, paddingTop: 48, gap: 10 },
  title: { fontSize: 22, fontWeight: '700' },
  muted: { color: '#555' },
  button: { padding: 14, backgroundColor: '#1d4ed8', borderRadius: 8 },
  disabled: { opacity: 0.5 },
  buttonText: { color: 'white', fontWeight: '600' },
  busy: { color: '#b45309', fontWeight: '600' },
  results: { padding: 12, backgroundColor: '#f3f4f6', borderRadius: 8 },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 },
  back: { padding: 12, paddingTop: 40 },
  link: { color: '#1d4ed8', fontWeight: '600' },
});
