import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Session } from '@arcafold/core/account';
import { albumPhotos } from '@arcafold/core/library/albums';
import { leaveJoined } from '@arcafold/core/sharing';

import { PhotoPicker } from '../../modules/memory-image';
import { bottomInset } from '../../modules/system-bars';
import { lastRun } from '../backup/last-run';
import { deletedText } from '../library/originals';
import { timelineOrder, timelinePhotos, timelineRows } from '../library/timeline';
import { useLibrary } from '../library/use-library';
import { personPhotos, usePeople } from '../people/use-people';
import { useSmartSettings } from '../ai/smart-settings';
import { useFind } from '../search/use-find';
import { useSearchIndex } from '../search/use-search-index';
import { useAccount } from '../session/account';
import { InvitesProvider } from '../sharing/invites';
import { Banner } from '../ui/kit';
import { NoticeProvider, useNotice } from '../ui/notice';
import { usePalette } from '../ui/theme';
import type { Palette } from '../ui/theme';
import { AlbumScreen } from './AlbumScreen';
import { OpenSearch } from './AppHeader';
import { NameSheet } from './AlbumSheets';
import { Albums } from './Albums';
import { People } from './People';
import { PersonScreen } from './PersonScreen';
import { RecentlyDeleted } from './RecentlyDeleted';
import { SearchScreen } from './SearchScreen';
import { BiometricSheet } from './BiometricSheet';
import { ChoosePhotos } from './ChoosePhotos';
import { InviteRequests } from './InviteCards';
import { JoinScreen } from './JoinScreen';
import { Settings } from './Settings';
import { ShareScreen } from './ShareScreen';
import { Timeline } from './Timeline';
import { UploadCard } from './UploadCard';
import { Viewer } from './Viewer';

type Tab = 'photos' | 'albums' | 'people';

/** Height of the tab bar above the navigation bar. */
const TAB_BAR = 58;

/**
 * Asks (from Android 13, where it's needed) to post the notification that says when photos
 * finished uploading in the background. Saying no only means no notification.
 */
async function askToNotify(): Promise<void> {
  if (Platform.OS !== 'android' || Platform.Version < 33) return;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(permission)) return;
  await PermissionsAndroid.request(permission).catch(() => undefined);
}

function TabBar({
  tab,
  inset,
  palette,
  onChange,
}: {
  tab: Tab;
  inset: number;
  palette: Palette;
  onChange: (tab: Tab) => void;
}) {
  const tabs: readonly { id: Tab; label: string; glyph: string }[] = [
    { id: 'photos', label: 'Photos', glyph: '▦' },
    { id: 'albums', label: 'Albums', glyph: '❐' },
    { id: 'people', label: 'People', glyph: '☺' },
  ];
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.tabBar,
        {
          height: TAB_BAR + inset,
          paddingBottom: inset,
          backgroundColor: palette.surface,
          borderColor: palette.border,
        },
      ]}
    >
      {tabs.map((each) => {
        const selected = each.id === tab;
        const colour = selected ? palette.accent : palette.muted;
        return (
          <Pressable
            key={each.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={each.label}
            onPress={() => {
              onChange(each.id);
            }}
            style={styles.tab}
          >
            <Text style={[styles.tabGlyph, { color: colour }]}>{each.glyph}</Text>
            <Text style={[styles.tabLabel, { color: colour }]}>{each.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** What the viewer is swiping through. */
interface Viewing {
  from: 'timeline' | 'album' | 'person' | 'search';
  start: number;
}

/**
 * The open space: Photos and Albums tabs, an album when one is open, and what shows over
 * them (the viewer, choosing photos, Settings). The library stays open across all of them.
 */
export function Home({ session }: { session: Session }) {
  const inset = bottomInset();
  return (
    <NoticeProvider bottom={TAB_BAR + inset + 16}>
      <HomeScreens session={session} inset={inset} />
    </NoticeProvider>
  );
}

function HomeScreens({ session, inset }: { session: Session; inset: number }) {
  const { space, onSystemScreen } = useAccount();
  const palette = usePalette();
  const notice = useNotice();
  const library = useLibrary(session);
  const [tab, setTab] = useState<Tab>('photos');
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [naming, setNaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The sharing screen: for one album (by id), or for the whole library. */
  const [sharing, setSharing] = useState<{ albumId: string | null } | null>(null);
  const [joining, setJoining] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const closeTrash = useCallback(() => {
    setTrashOpen(false);
  }, []);
  const [pickError, setPickError] = useState<string | null>(null);
  const album = library.albums.find((each) => each.id === albumId);
  // People are found in the photos the timeline shows: not files, nor Recently deleted.
  const peoplePhotos = useMemo(() => timelinePhotos(library.photos), [library.photos]);
  const [searching, setSearching] = useState(false);
  const smart = useSmartSettings(session.account.smartFeatures);
  const ready = smart.loaded && library.status === 'ready';
  // Search needs people's names, so opening it loads them too. Faces are found first, then
  // what photos show, and neither while photos upload.
  const people = usePeople({
    keys: session.opened.space,
    photos: peoplePhotos,
    on: ready && smart.faces,
    wanted: tab === 'people' || searching,
    busy: library.uploading,
    previews: library.previews,
  });
  const index = useSearchIndex({
    keys: session.opened.space,
    photos: peoplePhotos,
    on: ready && smart.search,
    wanted: searching,
    busy: library.uploading || people.active,
    previews: library.previews,
  });
  const allGroups = useMemo(
    () => [...people.groups, ...people.hidden],
    [people.groups, people.hidden],
  );
  const find = useFind({ index, people: people.people, groups: allGroups });
  const person =
    personId === null
      ? undefined
      : [...people.groups, ...people.hidden].find((each) => each.id === personId);
  const initial = (session.account.name.trim().at(0) ?? '?').toUpperCase();

  // Photos backed up in the background since the library loaded show when you come back.
  const { status: libraryStatus, retry } = library;
  const loadedAt = useRef(0);
  useEffect(() => {
    if (libraryStatus === 'ready') loadedAt.current = Date.now();
  }, [libraryStatus]);
  useEffect(() => {
    if (space !== 'main') return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void lastRun().then((run) => {
        if (run && run.added > 0 && run.at > loadedAt.current) retry();
      });
    });
    return () => {
      subscription.remove();
    };
  }, [space, retry]);

  // Back leaves an album, then goes from Albums to Photos. Registered once, first, so
  // whatever opens over the screens (the viewer, a sheet, Settings) handles back before it.
  // An album deleted (here or elsewhere) is closed: there's nothing to show.
  const albumOpen = album !== undefined;
  const personOpen = person !== undefined;
  const place = useRef({ albumOpen, personOpen, tab });
  useEffect(() => {
    place.current = { albumOpen, personOpen, tab };
  }, [albumOpen, personOpen, tab]);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (place.current.albumOpen) {
        setAlbumId(null);
        return true;
      }
      if (place.current.personOpen) {
        setPersonId(null);
        return true;
      }
      if (place.current.tab !== 'photos') {
        setTab('photos');
        return true;
      }
      return false;
    });
    return () => {
      back.remove();
    };
  }, []);

  const { addPhotos } = library;
  const pickPhotos = useCallback(
    (into?: string) => {
      setPickError(null);
      onSystemScreen(() => PhotoPicker.pickAsync()).then(
        (picked) => {
          addPhotos(picked, into);
          if (picked.length > 0) void askToNotify();
        },
        () => {
          setPickError('The photo picker couldn’t open. Try again.');
        },
      );
    },
    [onSystemScreen, addPhotos],
  );
  const { deleteOriginals, hideUploads } = library;
  const removeOriginals = useCallback(() => {
    setPickError(null);
    onSystemScreen(() => deleteOriginals((uris) => PhotoPicker.deleteAsync(uris))).then(
      (result) => {
        setPickError(deletedText(result));
        hideUploads();
      },
      () => {
        setPickError(
          'The photos couldn’t be deleted from the gallery. Delete them in your gallery app.',
        );
      },
    );
  }, [onSystemScreen, deleteOriginals, hideUploads]);

  // The viewer swipes through the timeline, or the open album, as they are now: a photo
  // moved away or taken out of the album drops out.
  const timeline = useMemo(() => {
    const rows = timelineRows(library.photos);
    return timelineOrder(library.photos, rows);
  }, [library.photos]);
  const inAlbum = useMemo(
    () => (albumId ? albumPhotos(library.photos, albumId) : []),
    [library.photos, albumId],
  );
  const ofPerson = useMemo(
    () =>
      person ? personPhotos(person, new Map(library.photos.map((each) => [each.id, each]))) : [],
    [library.photos, person],
  );
  const found = useMemo(() => {
    const byId = new Map(library.photos.map((each) => [each.id, each]));
    return find.shownIds.flatMap((id) => {
      const photo = byId.get(id);
      return photo ? [photo] : [];
    });
  }, [library.photos, find.shownIds]);
  const lists = useMemo(
    () => ({ timeline, album: inAlbum, person: ofPerson, search: found }),
    [timeline, inAlbum, ofPerson, found],
  );
  const viewed = lists[viewing?.from ?? 'timeline'];
  const latest = useRef(lists);
  useEffect(() => {
    latest.current = lists;
  }, [lists]);
  const openFrom = useCallback(
    (from: Viewing['from']) => (photoId: string) => {
      const list = latest.current[from];
      const start = list.findIndex((photo) => photo.id === photoId);
      if (start >= 0) setViewing({ from, start });
    },
    [],
  );
  const openInTimeline = useMemo(() => openFrom('timeline'), [openFrom]);
  const openInAlbum = useMemo(() => openFrom('album'), [openFrom]);
  const openOfPerson = useMemo(() => openFrom('person'), [openFrom]);
  const openFound = useMemo(() => openFrom('search'), [openFrom]);
  const openSearch = useCallback(() => {
    setSearching(true);
  }, []);
  const { clear: clearSearch, searchLike } = find;
  const closeSearch = useCallback(() => {
    setSearching(false);
    clearSearch();
  }, [clearSearch]);
  const closePerson = useCallback(() => {
    setPersonId(null);
  }, []);
  const closeViewer = useCallback(() => {
    setViewing(null);
  }, []);

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);
  const closeAlbum = useCallback(() => {
    setAlbumId(null);
  }, []);
  const openJoin = useCallback(() => {
    setJoining(true);
  }, []);
  const closeJoin = useCallback(() => {
    setJoining(false);
  }, []);
  const closeShare = useCallback(() => {
    setSharing(null);
  }, []);
  const keys = session.opened.space;
  const { retry: reload } = library;
  const leaveAlbum = useCallback(
    async (joinedId: string | undefined) => {
      if (!joinedId) throw new Error('That album isn’t one you joined.');
      await leaveJoined(keys, joinedId);
      // Its photos leave the open space too.
      reload();
    },
    [keys, reload],
  );
  const changeTab = useCallback((next: Tab) => {
    setAlbumId(null);
    setPersonId(null);
    setTab(next);
  }, []);

  const banner = pickError ? (
    <View style={styles.bannerWrap}>
      <Banner>{pickError}</Banner>
    </View>
  ) : null;

  // An album or person page covers the tab bar, like a page opened from it; back returns.
  const showTabs = album === undefined && person === undefined;
  const bottom = showTabs ? TAB_BAR + inset : inset;

  let screen;
  if (album) {
    screen = (
      <AlbumScreen
        album={album}
        library={library}
        initial={initial}
        banner={banner}
        onSettings={openSettings}
        onBack={closeAlbum}
        onOpen={openInAlbum}
        onChoose={() => {
          setChoosing(true);
        }}
        onUpload={() => {
          pickPhotos(album.id);
        }}
        onShare={() => {
          setSharing({ albumId: album.id });
        }}
        onLeave={() => leaveAlbum(album.joinedId)}
      />
    );
  } else if (person) {
    screen = (
      <PersonScreen
        group={person}
        people={people}
        library={library}
        initial={initial}
        banner={banner}
        onSettings={openSettings}
        onBack={closePerson}
        onOpen={openOfPerson}
        onMoved={setPersonId}
      />
    );
  } else if (tab === 'people') {
    screen = (
      <People
        people={people}
        library={library}
        initial={initial}
        banner={banner}
        onSettings={openSettings}
        onOpen={setPersonId}
      />
    );
  } else if (tab === 'albums') {
    screen = (
      <Albums
        library={library}
        initial={initial}
        banner={banner}
        onSettings={openSettings}
        onNew={() => {
          setNaming(true);
        }}
        onOpen={setAlbumId}
        onJoin={openJoin}
        onTrash={() => {
          setTrashOpen(true);
        }}
      />
    );
  } else {
    screen = (
      <Timeline
        library={library}
        initial={initial}
        banner={banner}
        onSettings={openSettings}
        onAdd={() => {
          pickPhotos();
        }}
        onOpen={openInTimeline}
      />
    );
  }

  return (
    <InvitesProvider keys={keys} myName={session.account.name} library={library}>
      <OpenSearch value={openSearch}>
        <View style={[styles.fill, { backgroundColor: palette.background }]}>
          <View style={[styles.fill, { paddingBottom: showTabs ? 0 : inset }]}>{screen}</View>
          {showTabs ? (
            <TabBar tab={tab} inset={inset} palette={palette} onChange={changeTab} />
          ) : null}
          <UploadCard
            library={library}
            palette={palette}
            bottom={bottom + 12}
            onDeleteOriginals={removeOriginals}
          />
          {naming ? (
            <NameSheet
              title="New album"
              action="Create album"
              onSave={async (name) => {
                const made = await library.createAlbum(name);
                setNaming(false);
                notice(`“${name}” created`);
                setAlbumId(made.id);
              }}
              onCancel={() => {
                setNaming(false);
              }}
            />
          ) : null}
          {searching ? (
            <SearchScreen find={find} library={library} onOpen={openFound} onClose={closeSearch} />
          ) : null}
          {trashOpen ? (
            <RecentlyDeleted
              library={library}
              initial={initial}
              onSettings={openSettings}
              onClose={closeTrash}
            />
          ) : null}
          {/* Once everything it was showing has gone (moved away, say), it closes itself. */}
          {viewing ? (
            <Viewer
              photos={viewed}
              start={Math.max(0, Math.min(viewing.start, viewed.length - 1))}
              library={library}
              {...(viewing.from === 'album' && album ? { album } : {})}
              {...(viewing.from === 'person' && person
                ? {
                    notThis: {
                      label: person.person?.name ? `Not ${person.person.name}` : 'Not this person',
                      run: async (photoId: string) =>
                        (await people.removePhotos(person, [photoId])).done.length > 0,
                    },
                  }
                : {})}
              onLike={(photoId) => {
                setViewing(null);
                setSearching(true);
                searchLike(photoId);
              }}
              onClose={closeViewer}
            />
          ) : null}
          {choosing && album ? (
            <ChoosePhotos
              album={album}
              library={library}
              onClose={() => {
                setChoosing(false);
              }}
            />
          ) : null}
          {settingsOpen ? (
            <Settings
              session={session}
              smart={{ settings: smart, people, index }}
              onClose={closeSettings}
              onBackedUp={library.retry}
              onShare={() => {
                setSharing({ albumId: null });
              }}
              onJoin={openJoin}
            />
          ) : null}
          {sharing ? (
            <ShareScreen
              album={
                sharing.albumId === null
                  ? null
                  : (library.albums.find((each) => each.id === sharing.albumId) ?? null)
              }
              keys={keys}
              onSharedWith={library.setSharedWith}
              onStopSharing={library.stopSharingAlbum}
              onClose={closeShare}
            />
          ) : null}
          {joining ? <JoinScreen onClose={closeJoin} /> : null}
          <InviteRequests albums={library.albums} showJoins={!joining} />
          <BiometricSheet />
        </View>
      </OpenSearch>
    </InvitesProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bannerWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabGlyph: { fontSize: 20 },
  tabLabel: { fontSize: 12, fontWeight: '600' },
});
