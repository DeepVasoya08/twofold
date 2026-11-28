import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Session, Space } from '@arcafold/core/account';

type SpaceKeys = NonNullable<Session['otherSpace']>;

import { useAccount } from '../session/account';
import { KEEP_FROM_AUTOFILL, moveLabel, wrongOtherPassword } from '../session/forms';
import { Banner, Button, Field } from '../ui/kit';
import { usePalette } from '../ui/theme';

/**
 * Asks for the other space's password before the first move out of this one, as on the web.
 * A space can't reach the other on its own; once opened, the other space's keys stay in
 * memory until Arcafold locks, so later moves go straight through. Drawn in the app's own
 * window (not a dialog window), so screenshot blocking covers it too.
 */
export function MoveSheet({
  space,
  onCancel,
  onUnlocked,
}: {
  space: Space;
  onCancel: () => void;
  onUnlocked: (otherSpace: SpaceKeys) => void;
}) {
  const { openOtherSpace } = useAccount();
  const palette = usePalette();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const isPrivate = space === 'private';
  const working = checking;

  const submit = () => {
    if (working) return;
    if (!password) {
      setError('Enter the password first.');
      return;
    }
    setChecking(true);
    openOtherSpace(password).then(
      (keys) => {
        setChecking(false);
        setPassword('');
        onUnlocked(keys);
      },
      () => {
        setChecking(false);
        setError(wrongOtherPassword(space));
      },
    );
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
      <Pressable style={styles.dismiss} onPress={working ? undefined : onCancel} />
      <View style={[styles.sheet, { backgroundColor: palette.surface }]}>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          {moveLabel(space)}
        </Text>
        <Text style={[styles.body, { color: palette.muted }]}>
          {isPrivate
            ? 'This photo will leave your private space and appear in your library.'
            : 'This photo will leave your library and only appear when you open Arcafold with your private password.'}
          {' You won’t be asked for the password again until Arcafold locks.'}
        </Text>
        <Field
          label={isPrivate ? 'Main password' : 'Private password'}
          value={password}
          onChangeText={(text) => {
            setPassword(text);
            setError(null);
          }}
          secure
          {...KEEP_FROM_AUTOFILL}
          autoFocus
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {error ? <Banner>{error}</Banner> : null}
        <Button label="Move" busyLabel="Checking…" busy={working} onPress={submit} />
        <Button kind="link" label="Cancel" onPress={working ? () => undefined : onCancel} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  dismiss: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    gap: 14,
  },
  title: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
});
