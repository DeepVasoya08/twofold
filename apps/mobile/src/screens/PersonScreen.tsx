import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { groupName, labelNames, personTitle } from '@arcafold/core/people/edits';
import { PERSON_LABELS } from '@arcafold/core/people/grouping';
import type { Group, PersonLabel } from '@arcafold/core/people/grouping';

import { photoCount } from '../library/album-text';
import { gridRows, photosInRows } from '../library/timeline';
import type { Library } from '../library/use-library';
import { personPhotos } from '../people/use-people';
import type { People } from '../people/use-people';
import { fonts } from '../theme';
import { Note } from '../ui/kit';
import { useNotice } from '../ui/notice';
import { PillButton } from '../ui/pill-button';
import { usePalette } from '../ui/theme';
import { PageTop, RoundButton } from './AppHeader';
import { FaceThumb } from './FaceThumb';
import { LabelsSheet, MergeSheet, PersonMenuSheet, PersonNameSheet } from './PeopleSheets';
import { PhotoGrid } from './PhotoGrid';
import { usePickToDelete } from './use-pick-to-delete';

type Open = 'menu' | 'name' | 'labels' | 'merge' | null;

/** One person: their face, their photos, and naming, labels, merging and hiding. */
export function PersonScreen({
  group,
  people,
  library,
  banner,
  onBack,
  onOpen,
  onShare,
  onSave,
  onTeach,
  onMoved,
  onSearch,
}: {
  group: Group;
  people: People;
  library: Library;
  banner: ReactNode;
  onBack: () => void;
  onOpen: (photoId: string) => void;
  /** Shares picked photos with someone, through an album. */
  onShare?: (photoIds: readonly string[]) => void;
  /** Saves copies of photos to the phone's gallery, where it can. */
  onSave?: (photoIds: readonly string[]) => void;
  /** Teaches search a word from picked photos, while Smart search is on. */
  onTeach?: (photoIds: readonly string[]) => void;
  /** A change made a new person (a group got a name, say): show them from now on. */
  onMoved: (personId: string) => void;
  /** Searches for this person by name (and whatever else is typed after). */
  onSearch?: (name: string) => void;
}) {
  const palette = usePalette();
  const notice = useNotice();
  const [open, setOpen] = useState<Open>(null);
  const byId = useMemo(
    () => new Map(library.photos.map((photo) => [photo.id, photo])),
    [library.photos],
  );
  const photos = useMemo(() => personPhotos(group, byId), [group, byId]);
  const rows = useMemo(() => gridRows(photos), [photos]);
  const all = useMemo(() => photosInRows(rows), [rows]);
  const picking = usePickToDelete(library, onOpen, {
    onShare,
    onSave,
    onTeach,
    filing: library,
    all,
  });
  const cover = group.faces[0];
  const person = group.person;
  const close = () => {
    setOpen(null);
  };
  /** Saves a change, says so, and follows the person if it got a new id. */
  const change = async (run: Promise<string>, done: string) => {
    const id = await run;
    close();
    notice(done);
    if (id !== group.id) onMoved(id);
  };
  const quick = (run: () => Promise<string>, done: string) => {
    close();
    run().then(
      (id) => {
        notice(done);
        if (id !== group.id) onMoved(id);
      },
      () => {
        notice('That didn’t save. Check your connection and try again.');
      },
    );
  };

  const name = person?.name ?? '';
  const labels = person?.labels ?? [];
  const toggleLabel = (label: PersonLabel) => {
    const next = labels.includes(label)
      ? labels.filter((each) => each !== label)
      : [...labels, label];
    quick(() => people.setLabels(group, next), 'Labels saved');
  };

  const summary = (
    <View style={styles.summary}>
      <View style={[styles.ring, { borderColor: palette.accent }]}>
        <FaceThumb
          face={cover}
          photo={byId.get(cover.photoId)}
          imageId={library.thumbs.get(cover.photoId) ?? null}
          size={FACE}
          requestThumbs={library.requestThumbs}
        />
      </View>
      <Text style={[styles.name, { color: palette.text }]} accessibilityRole="header">
        {personTitle(group)}
      </Text>
      <Text style={[styles.meta, { color: palette.muted }]}>
        {[...(person?.me ? ['You'] : []), photoCount(photos.length)].join(' · ')}
      </Text>
      <View style={styles.labels} accessibilityRole="radiogroup">
        {PERSON_LABELS.map((label) => {
          const on = labels.includes(label);
          return (
            <Pressable
              key={label}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => {
                toggleLabel(label);
              }}
              style={[
                styles.label,
                on
                  ? { borderColor: palette.accent, backgroundColor: palette.accentWash }
                  : { borderColor: palette.border },
              ]}
            >
              <Text style={[styles.labelText, { color: on ? palette.accent : palette.text }]}>
                {labelNames[label]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {name === '' ? (
        <PillButton
          label="Add a name"
          icon="plus"
          filled
          onPress={() => {
            setOpen('name');
          }}
        />
      ) : onSearch ? (
        <PillButton
          label={`Search ${name}’s photos`}
          icon="search"
          onPress={() => {
            onSearch(name);
          }}
        />
      ) : null}
    </View>
  );

  return (
    <View style={styles.fill}>
      {picking.header ?? (
        <PageTop onBack={onBack}>
          <RoundButton
            icon="more"
            label="Person options"
            onPress={() => {
              setOpen('menu');
            }}
          />
        </PageTop>
      )}
      {banner}
      {photos.length === 0 ? (
        <View style={styles.centre}>
          {summary}
          <Note>Their photos may have been deleted or moved.</Note>
        </View>
      ) : (
        <PhotoGrid
          rows={rows}
          thumbs={library.thumbs}
          requestThumbs={library.requestThumbs}
          {...picking.grid}
          header={summary}
        />
      )}
      {open === 'menu' ? (
        <PersonMenuSheet
          group={group}
          onName={() => {
            setOpen('name');
          }}
          onMe={() => {
            const me = person?.me === true;
            quick(() => people.setMe(group, !me), me ? 'No longer marked as you' : 'Marked as you');
          }}
          onLabels={() => {
            setOpen('labels');
          }}
          onMerge={() => {
            setOpen('merge');
          }}
          onHide={() => {
            const hidden = person?.hidden === true;
            quick(
              () => people.setHidden(group, !hidden),
              hidden ? 'Shown in People again' : 'Hidden from People',
            );
          }}
          onCancel={close}
        />
      ) : null}
      {open === 'name' ? (
        <PersonNameSheet
          group={group}
          onSave={(name) => change(people.name(group, name), `Named ${name}`)}
          onCancel={close}
        />
      ) : null}
      {open === 'labels' ? (
        <LabelsSheet
          group={group}
          onSave={(labels) => change(people.setLabels(group, labels), 'Labels saved')}
          onCancel={close}
        />
      ) : null}
      {open === 'merge' ? (
        <MergeSheet
          others={[...people.groups, ...people.hidden].filter((each) => each.id !== group.id)}
          photos={byId}
          thumbs={library.thumbs}
          requestThumbs={library.requestThumbs}
          onMerge={(into) => change(people.merge(group, into), `Merged with ${groupName(into)}`)}
          onCancel={close}
        />
      ) : null}
      {picking.sheet}
    </View>
  );
}

/** The face's size at the top of the page. */
const FACE = 108;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  summary: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, gap: 6 },
  ring: { padding: 4, borderWidth: 4, borderRadius: FACE, marginBottom: 6 },
  name: { fontFamily: fonts.display, fontSize: 30, letterSpacing: -0.8 },
  meta: { fontSize: 14 },
  labels: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 6 },
  label: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  labelText: { fontSize: 14, fontWeight: '600' },
});
