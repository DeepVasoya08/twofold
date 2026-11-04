import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { RECOVERY_FILE_NAME, recoveryFileText } from '@arcafold/core/recovery-file';

import { saveTextFile } from '../../modules/save-file';
import { useAccount } from '../session/account';
import { Banner, Button, CheckBox, Note, Screen, useSubmit } from '../ui/kit';
import { usePalette } from '../ui/theme';

/**
 * Step 2 of 2: the recovery key, shown once. Screenshots are blocked, so it has to be written
 * down or saved as a file; it is never copied to the clipboard, where other apps could read it.
 * "Download key" saves it as a text file, as on the web, through Android's "Save to" screen, so
 * the person picks where it goes; ticking the box does too, if it isn't saved yet.
 */
export function RecoveryWords() {
  const { pendingSignUp, completeSignUp, cancelSignUp } = useAccount();
  const [saved, setSaved] = useState(false);
  const [savedFile, setSavedFile] = useState(false);
  const { busy, error, setError, run } = useSubmit();
  const palette = usePalette();
  if (!pendingSignUp) return null;
  const words = pendingSignUp.recoveryWords;

  const download = () => {
    setError(null);
    saveTextFile(RECOVERY_FILE_NAME, recoveryFileText(words))
      .then((done) => {
        if (!done) return;
        setSavedFile(true);
        setSaved(true);
      })
      .catch(() => {
        setError('The file couldn’t be saved. Write the words down instead.');
      });
  };

  const tick = (next: boolean) => {
    setSaved(next);
    setError(null);
    if (next && !savedFile) download();
  };

  const submit = () => {
    if (!saved) {
      setError('Tick the box once you’ve saved the words.');
      return;
    }
    run(completeSignUp);
  };

  return (
    <Screen
      branded
      title="Save your recovery key"
      subtitle="If you ever forget your password, these 12 words are the only way back into your photos. Not even we can help without them."
    >
      <View style={styles.words} accessibilityLabel="Recovery key">
        {words.map((word, index) => (
          <Text
            key={index}
            style={[
              styles.word,
              {
                color: palette.text,
                borderColor: palette.border,
                backgroundColor: palette.background,
              },
            ]}
          >
            {index + 1}. {word}
          </Text>
        ))}
      </View>
      <Note>Write them on paper, or keep them in a password manager. Don’t share them.</Note>
      <Button
        kind="secondary"
        label={savedFile ? 'Saved. Download again' : 'Download key'}
        onPress={download}
      />
      <CheckBox checked={saved} label="I’ve saved my recovery key somewhere safe" onChange={tick} />
      {savedFile ? <Note>Saved as {RECOVERY_FILE_NAME}.</Note> : null}
      {error ? <Banner>{error}</Banner> : null}
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
});
