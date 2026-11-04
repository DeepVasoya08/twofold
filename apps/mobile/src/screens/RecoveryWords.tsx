import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAccount } from '../session/account';
import { Button, Note, Screen, useSubmit } from '../ui/kit';
import { usePalette } from '../ui/theme';

/**
 * Step 2 of 2: the recovery key, shown once. Screenshots are blocked, so it has to be written
 * down; it is never copied to the clipboard, where other apps could read it.
 */
export function RecoveryWords() {
  const { pendingSignUp, completeSignUp, cancelSignUp } = useAccount();
  const [saved, setSaved] = useState(false);
  const { busy, error, setError, run } = useSubmit();
  const palette = usePalette();
  if (!pendingSignUp) return null;

  const submit = () => {
    if (!saved) {
      setError('Tick the box once you’ve written the words down.');
      return;
    }
    run(completeSignUp);
  };

  return (
    <Screen
      title="Save your recovery key"
      subtitle="If you ever forget your password, these 12 words are the only way back into your photos. Not even we can help without them."
    >
      <View style={styles.words} accessibilityLabel="Recovery key">
        {pendingSignUp.recoveryWords.map((word, index) => (
          <Text
            key={index}
            style={[styles.word, { color: palette.text, borderColor: palette.border }]}
          >
            {index + 1}. {word}
          </Text>
        ))}
      </View>
      <Note>Write them on paper, or keep them in a password manager. Don’t share them.</Note>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: saved }}
        onPress={() => {
          setSaved((current) => !current);
          setError(null);
        }}
        style={styles.check}
      >
        <View
          style={[
            styles.box,
            {
              borderColor: palette.accent,
              backgroundColor: saved ? palette.accent : 'transparent',
            },
          ]}
        />
        <Text style={{ color: palette.text }}>I’ve saved my recovery key somewhere safe</Text>
      </Pressable>
      {error ? <Note error>{error}</Note> : null}
      <Button label="Create account" busyLabel="Creating account…" busy={busy} onPress={submit} />
      <Button kind="link" label="Back" onPress={cancelSignUp} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  words: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  word: {
    width: '47%',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 16,
  },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  box: { width: 22, height: 22, borderWidth: 2, borderRadius: 4 },
});
