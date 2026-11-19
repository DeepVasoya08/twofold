import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@arcafold/core/errors';
import { groupName, labelNames, personTitle } from '@arcafold/core/people/edits';
import { PERSON_LABELS } from '@arcafold/core/people/grouping';
import type { Group, PersonLabel } from '@arcafold/core/people/grouping';
import type { Photo } from '@arcafold/core/library/model';

import { photoCount } from '../library/album-text';
import { Banner, Button, CheckBox, Field } from '../ui/kit';
import { Sheet, SheetOption } from '../ui/sheet';
import { usePalette } from '../ui/theme';
import { FaceThumb } from './FaceThumb';

/** Longest name a person can be given. */
export const MAX_PERSON_NAME = 60;

/** Runs a sheet's save once at a time, with its busy state and the error to show. */
function useSave(onSave: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    onSave().then(
      () => {
        setBusy(false);
      },
      (caught: unknown) => {
        setBusy(false);
        setError(errorMessage(caught));
      },
    );
  };
  return { busy, error, setError, save };
}

/** What you can do about one person. */
export function PersonMenuSheet({
  group,
  onName,
  onMe,
  onLabels,
  onMerge,
  onHide,
  onCancel,
}: {
  group: Group;
  onName: () => void;
  onMe: () => void;
  onLabels: () => void;
  onMerge: () => void;
  onHide: () => void;
  onCancel: () => void;
}) {
  const person = group.person;
  return (
    <Sheet title={personTitle(group)} onCancel={onCancel}>
      <SheetOption label={person?.name ? 'Rename' : 'Add a name'} onPress={onName} />
      <SheetOption label={person?.me ? 'This isn’t me' : 'This is me'} onPress={onMe} />
      <SheetOption
        label="Labels"
        detail="Friends, Family or Work, to search for groups of people"
        onPress={onLabels}
      />
      <SheetOption label="Merge with someone" onPress={onMerge} />
      <SheetOption
        label={person?.hidden ? 'Show in People' : 'Hide from People'}
        onPress={onHide}
      />
    </Sheet>
  );
}

/** Names someone, or renames them. Names stay encrypted, like everything else. */
export function PersonNameSheet({
  group,
  onSave,
  onCancel,
}: {
  group: Group;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const named = Boolean(group.person?.name);
  const [name, setName] = useState(group.person?.name ?? '');
  const { busy, error, setError, save } = useSave(() => onSave(name.trim()));
  const submit = () => {
    if (name.trim() === '') {
      setError('Type a name.');
      return;
    }
    save();
  };
  return (
    <Sheet
      title={named ? 'Rename' : 'Add a name'}
      body="Names stay encrypted in your library, like everything else."
      busy={busy}
      onCancel={onCancel}
    >
      <Field
        label="Name"
        value={name}
        maxLength={MAX_PERSON_NAME}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
        onChangeText={(text) => {
          setName(text);
          setError(null);
        }}
        error={error}
      />
      <Button label="Save" busyLabel="Saving…" busy={busy} onPress={submit} />
      <Button kind="link" label="Cancel" onPress={busy ? () => undefined : onCancel} />
    </Sheet>
  );
}

/** Puts someone in groups (Friends, Family, Work), so searches can ask for them. */
export function LabelsSheet({
  group,
  onSave,
  onCancel,
}: {
  group: Group;
  onSave: (labels: PersonLabel[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [labels, setLabels] = useState<PersonLabel[]>(group.person?.labels ?? []);
  const { busy, error, save } = useSave(() => onSave(labels));
  return (
    <Sheet
      title="Labels"
      body="Labels let you search for groups, like “my friends at the beach”."
      busy={busy}
      onCancel={onCancel}
    >
      {PERSON_LABELS.map((label) => (
        <CheckBox
          key={label}
          label={labelNames[label]}
          checked={labels.includes(label)}
          onChange={(on) => {
            setLabels((current) =>
              on ? [...current, label] : current.filter((each) => each !== label),
            );
          }}
        />
      ))}
      {error ? <Banner>{error}</Banner> : null}
      <Button label="Save" busyLabel="Saving…" busy={busy} onPress={save} />
      <Button kind="link" label="Cancel" onPress={busy ? () => undefined : onCancel} />
    </Sheet>
  );
}

/** Picks who else these photos are of; the two become one person. */
export function MergeSheet({
  others,
  photos,
  thumbs,
  requestThumbs,
  onMerge,
  onCancel,
}: {
  others: readonly Group[];
  photos: ReadonlyMap<string, Photo>;
  thumbs: ReadonlyMap<string, string>;
  requestThumbs: (photoIds: readonly string[], onScreen?: boolean) => void;
  onMerge: (into: Group) => Promise<void>;
  onCancel: () => void;
}) {
  const palette = usePalette();
  const [chosen, setChosen] = useState<Group | null>(null);
  const { busy, error, save } = useSave(() =>
    chosen ? onMerge(chosen) : Promise.resolve(undefined),
  );
  return (
    <Sheet
      title="Merge with someone"
      body="Pick who these photos are of. Their photos and these become one person."
      busy={busy}
      onCancel={onCancel}
    >
      {others.length === 0 ? (
        <Text style={[styles.empty, { color: palette.muted }]}>There’s nobody else yet.</Text>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {others.map((each) => {
            const face = each.faces[0];
            const picked = chosen?.id === each.id;
            return (
              <Pressable
                key={each.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: picked, disabled: busy }}
                accessibilityLabel={`${groupName(each)}, ${photoCount(each.photoIds.length)}`}
                disabled={busy}
                onPress={() => {
                  setChosen(each);
                }}
                style={[
                  styles.choice,
                  {
                    borderColor: picked ? palette.accent : palette.border,
                    backgroundColor: picked ? palette.track : 'transparent',
                  },
                ]}
              >
                <FaceThumb
                  face={face}
                  photo={photos.get(face.photoId)}
                  imageId={thumbs.get(face.photoId) ?? null}
                  size={44}
                  requestThumbs={requestThumbs}
                />
                <View style={styles.choiceText}>
                  <Text style={[styles.choiceName, { color: palette.text }]} numberOfLines={1}>
                    {groupName(each)}
                  </Text>
                  <Text style={[styles.choiceMeta, { color: palette.muted }]}>
                    {photoCount(each.photoIds.length)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {error ? <Banner>{error}</Banner> : null}
      {others.length > 0 ? (
        <Button
          label={chosen ? `Merge with ${groupName(chosen)}` : 'Merge'}
          busyLabel="Merging…"
          busy={busy}
          disabled={!chosen}
          onPress={save}
        />
      ) : null}
      <Button kind="link" label="Cancel" onPress={busy ? () => undefined : onCancel} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 15 },
  list: { maxHeight: 320 },
  listContent: { gap: 8 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
  },
  choiceText: { flex: 1 },
  choiceName: { fontSize: 16, fontWeight: '600' },
  choiceMeta: { fontSize: 13 },
});
