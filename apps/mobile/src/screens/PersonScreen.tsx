import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { aboutPerson, groupName, personTitle } from '@arcafold/core/people/edits';
import type { Group } from '@arcafold/core/people/grouping';

import { photoCount } from '../library/album-text';
import { gridRows } from '../library/timeline';
import type { Library } from '../library/use-library';
import { personPhotos } from '../people/use-people';
import type { People } from '../people/use-people';
import { Button, Note } from '../ui/kit';
import { useNotice } from '../ui/notice';
import { usePalette } from '../ui/theme';
import { AppHeader, HeaderButton } from './AppHeader';
import { FaceThumb } from './FaceThumb';
import { LabelsSheet, MergeSheet, PersonMenuSheet, PersonNameSheet } from './PeopleSheets';
import { PhotoGrid } from './PhotoGrid';

type Open = 'menu' | 'name' | 'labels' | 'merge' | null;

/** One person: their face, their photos, and naming, labels, merging and hiding. */
export function PersonScreen({
  group,
  people,
  library,
  initial,
  banner,
  onSettings,
  onBack,
  onOpen,
  onMoved,
}: {
  group: Group;
  people: People;
  library: Library;
  initial: string;
  banner: ReactNode;
  onSettings: () => void;
  onBack: () => void;
  onOpen: (photoId: string) => void;
  /** A change made a new person (a group got a name, say): show them from now on. */
  onMoved: (personId: string) => void;
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

  const summary = (
    <View style={styles.summary}>
      <FaceThumb
        face={cover}
        photo={byId.get(cover.photoId)}
        imageId={library.thumbs.get(cover.photoId) ?? null}
        size={112}
        requestThumbs={library.requestThumbs}
      />
      <Text style={[styles.meta, { color: palette.muted }]}>
        {aboutPerson(group, photoCount(photos.length))}
      </Text>
      {person?.name ? null : (
        <Button
          kind="secondary"
          label="Add a name"
          onPress={() => {
            setOpen('name');
          }}
        />
      )}
    </View>
  );

  return (
    <View style={styles.fill}>
      <AppHeader
        title={personTitle(group)}
        initial={initial}
        onSettings={onSettings}
        onBack={onBack}
      >
        <HeaderButton
          label="⋯"
          accessibilityLabel="Person options"
          onPress={() => {
            setOpen('menu');
          }}
        />
      </AppHeader>
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
          onPress={onOpen}
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
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  summary: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  meta: { fontSize: 14 },
});
