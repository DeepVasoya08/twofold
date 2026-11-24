import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@arcafold/core/errors';

import { MemoryImages } from '../../modules/memory-image';
import { useAccount } from '../session/account';
import { MAX_NAME_LENGTH, nameError } from '../session/forms';
import { pickProfilePhoto, useProfile } from '../session/profile';
import { Avatar } from '../ui/avatar';
import { Banner, Button, Field } from '../ui/kit';
import { useNotice } from '../ui/notice';
import { Sheet } from '../ui/sheet';
import { usePalette } from '../ui/theme';

/** The photo as it will be saved: unchanged, a newly picked one, or none. */
type PhotoChoice =
  | { kind: 'keep' }
  | { kind: 'new'; jpeg: Uint8Array<ArrayBuffer>; imageId: string }
  | { kind: 'remove' };

/**
 * Edits your name and the open space's profile photo, as the web's Edit profile does. The
 * photo is cropped square on the phone and encrypted like any photo; each space keeps its own.
 */
export function ProfileSheet({ onClose }: { onClose: () => void }) {
  const { state, space, onSystemScreen, changeName } = useAccount();
  const profile = useProfile();
  const palette = usePalette();
  const notice = useNotice();
  const saved = state.status === 'unlocked' ? state.session.account.name : '';
  const [name, setName] = useState(saved);
  const [choice, setChoice] = useState<PhotoChoice>({ kind: 'keep' });
  const [nameProblem, setNameProblem] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A picked photo's preview lives only while it's picked.
  useEffect(() => {
    if (choice.kind !== 'new') return;
    return () => {
      MemoryImages.release(choice.imageId);
    };
  }, [choice]);

  const preview =
    choice.kind === 'new' ? choice.imageId : choice.kind === 'remove' ? null : profile.imageId;

  const pick = () => {
    setFailed(null);
    pickProfilePhoto(onSystemScreen).then(
      (jpeg) => {
        if (jpeg) setChoice({ kind: 'new', jpeg, imageId: MemoryImages.put(jpeg) });
      },
      (error: unknown) => {
        setFailed(errorMessage(error));
      },
    );
  };

  const save = () => {
    if (busy) return;
    const problem = nameError(name);
    if (problem) {
      setNameProblem(problem);
      return;
    }
    const trimmed = name.trim();
    setBusy(true);
    setFailed(null);
    const run = async () => {
      if (trimmed !== saved) await changeName(trimmed);
      if (choice.kind === 'new') await profile.save(choice.jpeg);
      if (choice.kind === 'remove') await profile.save(null);
    };
    run().then(
      () => {
        notice('Profile saved');
        onClose();
      },
      (error: unknown) => {
        setBusy(false);
        setFailed(errorMessage(error));
      },
    );
  };

  return (
    <Sheet title="Edit profile" busy={busy} onCancel={onClose}>
      <View style={styles.photo}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={preview ? 'Change photo' : 'Add photo'}
          onPress={pick}
          disabled={busy}
        >
          <Avatar
            imageId={preview}
            name={name || saved}
            size={104}
            background={palette.accentWash}
            ink={palette.accent}
          />
        </Pressable>
        <View style={styles.photoButtons}>
          <Pressable
            accessibilityRole="button"
            onPress={pick}
            disabled={busy}
            style={[styles.chip, { backgroundColor: palette.accentWash }]}
          >
            <Text style={[styles.chipText, { color: palette.accent }]}>
              {preview ? 'Change photo' : 'Add photo'}
            </Text>
          </Pressable>
          {preview ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setChoice({ kind: 'remove' });
              }}
              disabled={busy}
              style={[styles.chip, { borderColor: palette.border, borderWidth: 1 }]}
            >
              <Text style={[styles.chipText, { color: palette.muted }]}>Remove photo</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={[styles.note, { color: palette.muted }]}>
          {space === 'private'
            ? 'Your photo is encrypted on this phone. Only this private space shows it.'
            : 'Your photo is encrypted on this phone, like your other photos. Only you see it.'}
        </Text>
      </View>
      <Field
        label="Name"
        autoComplete="name"
        value={name}
        maxLength={MAX_NAME_LENGTH}
        editable={!busy}
        error={nameProblem}
        onChangeText={(text) => {
          setName(text);
          setNameProblem(null);
        }}
      />
      <Text style={[styles.note, styles.left, { color: palette.muted }]}>
        People you share with see this name.
      </Text>
      {failed ? <Banner>{failed}</Banner> : null}
      <Button label="Save" busyLabel="Saving…" busy={busy} onPress={save} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  photo: { alignItems: 'center', gap: 12, paddingBottom: 4 },
  photoButtons: { flexDirection: 'row', gap: 8 },
  chip: { height: 40, paddingHorizontal: 16, borderRadius: 20, justifyContent: 'center' },
  chipText: { fontSize: 14, fontWeight: '600' },
  note: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  left: { textAlign: 'left', marginTop: -6 },
});
