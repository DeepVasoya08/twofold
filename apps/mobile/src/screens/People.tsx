import { memo, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { aboutPerson, groupName } from '@arcafold/core/people/edits';
import type { Group } from '@arcafold/core/people/grouping';
import type { Photo } from '@arcafold/core/library/model';

import { photoCount } from '../library/album-text';
import type { Library } from '../library/use-library';
import { noPeopleText } from '../people/use-people';
import type { People as PeopleState } from '../people/use-people';
import { Button, Note } from '../ui/kit';
import { usePalette } from '../ui/theme';
import { AppHeader } from './AppHeader';
import { FaceThumb } from './FaceThumb';

const GUTTER = 16;
const GAP = 12;
const COLUMNS = 3;

const PersonCard = memo(function PersonCard({
  group,
  photo,
  imageId,
  width,
  requestThumbs,
  onOpen,
}: {
  group: Group;
  photo: Photo | undefined;
  imageId: string | null;
  width: number;
  requestThumbs: Library['requestThumbs'];
  onOpen: (groupId: string) => void;
}) {
  const palette = usePalette();
  const named = Boolean(group.person?.name);
  const about = aboutPerson(group, photoCount(group.photoIds.length));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${named ? groupName(group) : 'Someone without a name'}, ${about}`}
      onPress={() => {
        onOpen(group.id);
      }}
      style={[styles.card, { width }]}
    >
      <FaceThumb
        face={group.faces[0]}
        photo={photo}
        imageId={imageId}
        size={width - 8}
        requestThumbs={requestThumbs}
      />
      <Text
        style={[styles.name, { color: named ? palette.text : palette.accent }]}
        numberOfLines={1}
      >
        {groupName(group)}
      </Text>
      <Text style={[styles.meta, { color: palette.muted }]} numberOfLines={2}>
        {about}
      </Text>
    </Pressable>
  );
});

/** Everyone found in your photos: the People tab. */
export function People({
  people,
  library,
  initial,
  banner,
  onSettings,
  onOpen,
}: {
  people: PeopleState;
  library: Library;
  initial: string;
  banner: ReactNode;
  onSettings: () => void;
  onOpen: (groupId: string) => void;
}) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const cardWidth = Math.floor((width - GUTTER * 2 - GAP * (COLUMNS - 1)) / COLUMNS);
  const [showHidden, setShowHidden] = useState(false);
  const byId = useMemo(
    () => new Map(library.photos.map((photo) => [photo.id, photo])),
    [library.photos],
  );
  const shown = showHidden ? people.hidden : people.groups;
  const { thumbs, requestThumbs } = library;

  const header = <AppHeader title="People" initial={initial} onSettings={onSettings} />;

  if (people.status === 'failed') {
    return (
      <View style={styles.fill}>
        {header}
        {banner}
        <View style={styles.centre}>
          <Note error>Couldn’t load your people. Check your connection and try again.</Note>
          <Button label="Try again" onPress={people.reload} />
        </View>
      </View>
    );
  }
  if (people.status !== 'ready') {
    return (
      <View style={styles.fill}>
        {header}
        {banner}
        <View style={styles.centre}>
          <ActivityIndicator color={palette.accent} />
        </View>
      </View>
    );
  }

  const toggle =
    people.hidden.length > 0 || showHidden ? (
      <Button
        kind="link"
        label={showHidden ? 'Back to people' : `Hidden people (${String(people.hidden.length)})`}
        onPress={() => {
          setShowHidden(!showHidden);
        }}
      />
    ) : null;

  return (
    <View style={styles.fill}>
      {header}
      {banner}
      <FlatList
        data={shown}
        key={COLUMNS}
        numColumns={COLUMNS}
        keyExtractor={(group) => group.id}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        refreshing={false}
        onRefresh={people.reload}
        ListHeaderComponent={
          showHidden ? (
            <Text style={[styles.heading, { color: palette.muted }]}>Hidden from People</Text>
          ) : undefined
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Note>{noPeopleText(showHidden)}</Note>
          </View>
        }
        ListFooterComponent={toggle ?? undefined}
        renderItem={({ item }) => {
          const face = item.faces[0];
          return (
            <PersonCard
              group={item}
              photo={byId.get(face.photoId)}
              imageId={thumbs.get(face.photoId) ?? null}
              width={cardWidth}
              requestThumbs={requestThumbs}
              onOpen={onOpen}
            />
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  list: { paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 48, gap: 20 },
  row: { gap: GAP },
  heading: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  empty: { paddingTop: 24 },
  card: { alignItems: 'center', gap: 4 },
  name: { fontSize: 15, fontWeight: '700', marginTop: 6 },
  meta: { fontSize: 12, textAlign: 'center' },
});
