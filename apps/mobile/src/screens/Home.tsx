import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Keyboard,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Session } from '@arcafold/core/account';
import { errorMessage } from '@arcafold/core/errors';
import { albumPhotos } from '@arcafold/core/library/albums';
import { aspectOf } from '@arcafold/core/library/aspect';
import type { Album } from '@arcafold/core/library/model';
import { shownPhotos } from '@arcafold/core/search/answer';
import { MAX_SMART_TITLE, suggestTitle } from '@arcafold/core/search/smart-album';
import { MAX_WORD_NAME } from '@arcafold/core/search/taught';
import { leaveJoined } from '@arcafold/core/sharing';

import { PhotoPicker } from '../../modules/memory-image';
import { bottomInset } from '../../modules/system-bars';
import { lastRun } from '../backup/last-run';
import { albumChangeText } from '../library/album-text';
import { deletedText } from '../library/originals';
import {
  favoritePhotos,
  gridRows,
  timelineOrder,
  timelinePhotos,
  timelineRows,
} from '../library/timeline';
import { useLibrary } from '../library/use-library';
import type { Library } from '../library/use-library';
import { useSaveToPhone } from '../library/use-save-to-phone';
import { personPhotos, usePeople } from '../people/use-people';
import { useSmartSettings } from '../ai/smart-settings';
import { useFind } from '../search/use-find';
import { useSearchIndex } from '../search/use-search-index';
import { useSmartAlbum } from '../search/use-smart-album';
import { searchToSave, smartTitleCheck, teachCountProblem, wordCheck } from '../search/smart-text';
import { useAccount } from '../session/account';
import { ProfileProvider } from '../session/profile';
import { InvitesProvider } from '../sharing/invites';
import type { ShareTarget } from '../sharing/sharing-text';
import { PhotoAspects } from '../ui/appearance';
import { FloatSpace } from '../ui/float-space';
import { Icon } from '../ui/icons';
import type { IconName } from '../ui/icons';
import { Banner, Button } from '../ui/kit';
import { Sheet } from '../ui/sheet';
import { NoticeProvider, useNotice } from '../ui/notice';
import { usePalette } from '../ui/theme';
import type { Palette } from '../ui/theme';
import { AlbumScreen } from './AlbumScreen';
import { OpenSearch } from './AppHeader';
import { NameSheet, ShareThroughSheet } from './AlbumSheets';
import { SmartAlbumScreen } from './SmartAlbumScreen';
import { Albums } from './Albums';
import { People } from './People';
import { PersonScreen } from './PersonScreen';
import { RecentlyDeleted } from './RecentlyDeleted';
import { SearchScreen } from './SearchScreen';
import { BiometricSheet } from './BiometricSheet';
import { Files } from './Files';
import { ChoosePhotos } from './ChoosePhotos';
import { InviteRequests } from './InviteCards';
import { JoinScreen } from './JoinScreen';
import { FavoritesScreen } from './FavoritesScreen';
import { Settings } from './Settings';
import { ShareScreen } from './ShareScreen';
import { Timeline } from './Timeline';
import { SaveCard } from './SaveCard';
import { UploadCard } from './UploadCard';
import { Viewer } from './Viewer';

type Tab = 'photos' | 'albums' | 'files' | 'people';

/** The floating tab bar: its height, and how far it floats above the navigation bar. */
const TAB_BAR = 62;
const TAB_LIFT = 14;
const FAB = 58;
const EDGE = 16;
/** Room the floating bar takes at the bottom of a tab, above the navigation bar. */
const FLOATING = TAB_BAR + TAB_LIFT + 12;
/** The Add button floats this far above the bar's top, at the right edge. */
const FAB_GAP = 12;

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

/**
 * The tab bar, floating over the screen as a rounded island across its whole width: the open
 * tab is an accent pill with its name, the others just their icons. The tab's Add button
 * floats above its right end.
 */
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
  const tabs: readonly { id: Tab; label: string }[] = [
    { id: 'photos', label: 'Photos' },
    { id: 'albums', label: 'Albums' },
    { id: 'files', label: 'Files' },
    { id: 'people', label: 'People' },
  ];
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.tabBar,
        {
          bottom: inset + TAB_LIFT,
          backgroundColor: palette.surface,
          borderColor: palette.border,
        },
      ]}
    >
      {tabs.map((each) => {
        const selected = each.id === tab;
        return (
          <Pressable
            key={each.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={each.label}
            onPress={() => {
              onChange(each.id);
            }}
            style={[styles.tab, selected ? { flex: 2.4, backgroundColor: palette.accent } : null]}
          >
            <Icon name={each.id} size={21} color={selected ? palette.onAccent : palette.muted} />
            {selected ? (
              <Text style={[styles.tabLabel, { color: palette.onAccent }]} numberOfLines={1}>
                {each.label}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The floating Add button above the tab bar's right end: uploads photos or files, or starts a
 * new album, where a thumb reaches it, so the header keeps room for the title.
 */
function AddButton({
  icon,
  label,
  inset,
  palette,
  onPress,
}: {
  icon: IconName;
  label: string;
  inset: number;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        {
          bottom: inset + TAB_LIFT + TAB_BAR + FAB_GAP,
          backgroundColor: palette.accent,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        },
      ]}
    >
      <Icon name={icon} size={24} color={palette.onAccent} />
    </Pressable>
  );
}

/** What the viewer is swiping through. */
interface Viewing {
  from: 'timeline' | 'album' | 'person' | 'search' | 'smart' | 'favorites';
  start: number;
}

/**
 * The open space: Photos and Albums tabs, an album when one is open, and what shows over
 * them (the viewer, choosing photos, Settings). The library stays open across all of them.
 */

/** What the sharing screen is for, from what's open now (so a rename shows), or null. */
function shareTarget(
  sharing: { albumId: string | null; kind?: 'folder' | 'file' },
  library: Pick<Library, 'albums' | 'folders' | 'photos'>,
): ShareTarget | null {
  const id = sharing.albumId;
  if (id === null) return null;
  if (sharing.kind === 'folder') {
    const folder = library.folders.find((each) => each.id === id);
    return folder ? { id, title: folder.name, kind: 'folder' } : null;
  }
  if (sharing.kind === 'file') {
    const file = library.photos.find((each) => each.shareId === id);
    return file?.file ? { id, title: file.file.name, kind: 'file' } : null;
  }
  const album = library.albums.find((each) => each.id === id);
  return album ? { id, title: album.title, kind: 'album' } : null;
}

export function Home({ session }: { session: Session }) {
  const inset = bottomInset();
  return (
    <NoticeProvider bottom={inset + FLOATING + FAB + FAB_GAP + 4}>
      <ProfileProvider session={session}>
        <HomeScreens session={session} inset={inset} />
      </ProfileProvider>
    </NoticeProvider>
  );
}

function HomeScreens({ session, inset }: { session: Session; inset: number }) {
  const { space, onSystemScreen } = useAccount();
  const palette = usePalette();
  const notice = useNotice();
  const library = useLibrary(session);
  // Each photo's shape, for the uncropped view.
  const photoAspect = useMemo(() => {
    const shapes = new Map(
      library.photos.map((photo) => [photo.id, aspectOf(photo.width, photo.height)]),
    );
    return (photoId: string) => shapes.get(photoId) ?? 1;
  }, [library.photos]);
  const saving = useSaveToPhone(library, notice);
  const onSave = saving.available ? saving.save : undefined;
  const [tab, setTab] = useState<Tab>('photos');
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [filesFolder, setFilesFolder] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * The sharing screen: for one album (by id), a folder or file in Files (by the row it's
   * shared through), or the whole library.
   */
  const [sharing, setSharing] = useState<{
    albumId: string | null;
    kind?: 'folder' | 'file';
  } | null>(null);
  const [joining, setJoining] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [smartId, setSmartId] = useState<string | null>(null);
  const [smartMore, setSmartMore] = useState(false);
  /** Photos picked to teach search a word from, while that sheet is open. */
  const [teaching, setTeaching] = useState<readonly string[] | null>(null);
  const [savingSearch, setSavingSearch] = useState(false);
  const closeTrash = useCallback(() => {
    setTrashOpen(false);
  }, []);
  const [pickError, setPickError] = useState<string | null>(null);
  /** Whether the open tab is selecting or has a sheet open: the floating controls step aside. */
  const [tabPicking, setTabPicking] = useState(false);
  // They step aside for the keyboard too, while a tab's search field is being typed in.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      setTyping(true);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      setTyping(false);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
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
  // Smart albums and teaching words come with Smart search, as on the web.
  const searchOn = ready && smart.search;
  const smartAlbum =
    smartId === null ? undefined : index.smartAlbums.find((each) => each.id === smartId);
  const smartAnswer = useSmartAlbum({
    album: smartAlbum,
    index,
    people: people.people,
    groups: allGroups,
  });
  const smartIds = useMemo(
    () => shownPhotos(smartAnswer?.found ?? null, smartMore),
    [smartAnswer, smartMore],
  );
  const onTeach = searchOn
    ? (photoIds: readonly string[]) => {
        setTeaching(photoIds);
      }
    : undefined;
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
  const place = useRef({ albumOpen, personOpen, favoritesOpen, tab });
  useEffect(() => {
    place.current = { albumOpen, personOpen, favoritesOpen, tab };
  }, [albumOpen, personOpen, favoritesOpen, tab]);
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
      if (place.current.favoritesOpen) {
        setFavoritesOpen(false);
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
  const pickFiles = useCallback(() => {
    setPickError(null);
    onSystemScreen(() => PhotoPicker.pickFilesAsync()).then(
      (picked) => {
        addPhotos(picked, filesFolder ?? undefined);
        if (picked.length > 0) void askToNotify();
      },
      () => {
        setPickError('The file picker couldn’t open. Try again.');
      },
    );
  }, [onSystemScreen, addPhotos, filesFolder]);
  /** One file from the phone, for a new version of a file in Files. */
  const pickOneFile = useCallback(
    () => onSystemScreen(() => PhotoPicker.pickFilesAsync()).then((picked) => picked[0] ?? null),
    [onSystemScreen],
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
  const inSmart = useMemo(() => {
    const byId = new Map(library.photos.map((each) => [each.id, each]));
    return smartIds.flatMap((id) => {
      const photo = byId.get(id);
      return photo ? [photo] : [];
    });
  }, [library.photos, smartIds]);
  const favorites = useMemo(() => {
    const rows = gridRows(favoritePhotos(library.photos));
    return timelineOrder(library.photos, rows);
  }, [library.photos]);
  const lists = useMemo(
    () => ({
      timeline,
      album: inAlbum,
      person: ofPerson,
      search: found,
      smart: inSmart,
      favorites,
    }),
    [timeline, inAlbum, ofPerson, found, inSmart, favorites],
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
  const openInSmart = useMemo(() => openFrom('smart'), [openFrom]);
  const openFavorite = useMemo(() => openFrom('favorites'), [openFrom]);
  const closeSmart = useCallback(() => {
    setSmartId(null);
    setSmartMore(false);
  }, []);
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

  // Sharing photos goes through an album, as on the web: pick one of yours (or name a new
  // one), the photos go in, and that album's invite opens.
  const [shareFor, setShareFor] = useState<{
    photoIds: readonly string[];
    naming: boolean;
  } | null>(null);
  const sharePhotos = useCallback((photoIds: readonly string[]) => {
    setShareFor({ photoIds, naming: false });
  }, []);
  const { setInAlbum, createAlbum } = library;
  const shareThrough = useCallback(
    async (target: Album, photoIds: readonly string[]) => {
      const result = await setInAlbum(photoIds, target, true);
      if (result.failed.length > 0) {
        notice(albumChangeText(result, target.title, true));
        return;
      }
      setShareFor(null);
      setSharing({ albumId: target.id });
    },
    [setInAlbum, notice],
  );
  const keys = session.opened.space;
  const { retry: reload } = library;
  const leaveAlbum = useCallback(
    async (joinedId: string | undefined) => {
      if (!joinedId) throw new Error('That isn’t something shared with you.');
      await leaveJoined(keys, joinedId);
      // Its photos leave the open space too.
      reload();
    },
    [keys, reload],
  );
  const changeTab = useCallback((next: Tab) => {
    setAlbumId(null);
    setSmartId(null);
    setPersonId(null);
    setTab(next);
  }, []);

  const banner = pickError ? (
    <View style={styles.bannerWrap}>
      <Banner>{pickError}</Banner>
    </View>
  ) : null;

  // An album or person page covers the tab bar, like a page opened from it; back returns.
  const showTabs =
    album === undefined && person === undefined && smartAlbum === undefined && !favoritesOpen;
  const floating = showTabs && !tabPicking && !typing;
  const floatSpace = showTabs ? inset + FLOATING : 0;

  let screen;
  /** The open tab's Add button, if it has one: People are found, not added. */
  let add: { icon: IconName; label: string; onPress: () => void } | null = null;
  if (smartAlbum && smartAnswer) {
    screen = (
      <SmartAlbumScreen
        album={smartAlbum}
        answer={smartAnswer}
        shownIds={smartIds}
        showMore={smartMore}
        setShowMore={setSmartMore}
        lookedAt={index.lookedAt}
        searchOn={searchOn}
        library={library}
        initial={initial}
        banner={banner}
        onSettings={openSettings}
        onBack={closeSmart}
        onOpen={openInSmart}
        onSave={async (changed) => {
          await index.saveSmartAlbum(changed);
        }}
        onDelete={async () => {
          await index.deleteSmartAlbum(smartAlbum.id);
          closeSmart();
        }}
      />
    );
  } else if (album) {
    screen = (
      <AlbumScreen
        {...(onSave ? { onSave } : {})}
        {...(onTeach ? { onTeach } : {})}
        album={album}
        library={library}
        banner={banner}
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
        onShare={sharePhotos}
        {...(onSave ? { onSave } : {})}
        {...(onTeach ? { onTeach } : {})}
        group={person}
        people={people}
        library={library}
        banner={banner}
        onBack={closePerson}
        onOpen={openOfPerson}
        onMoved={setPersonId}
        onSearch={(name) => {
          find.searchFor(name);
          setSearching(true);
        }}
      />
    );
  } else if (favoritesOpen) {
    screen = (
      <FavoritesScreen
        onShare={sharePhotos}
        {...(onSave ? { onSave } : {})}
        {...(onTeach ? { onTeach } : {})}
        library={library}
        banner={banner}
        onBack={() => {
          setFavoritesOpen(false);
        }}
        onOpen={openFavorite}
      />
    );
  } else if (tab === 'people') {
    screen = (
      <People
        onPicking={setTabPicking}
        people={people}
        library={library}
        initial={initial}
        banner={banner}
        onSettings={openSettings}
        onOpen={setPersonId}
      />
    );
  } else if (tab === 'files') {
    add = {
      icon: 'upload',
      label: filesFolder ? 'Upload here' : 'Add files',
      onPress: pickFiles,
    };
    screen = (
      <Files
        onPicking={setTabPicking}
        folderId={filesFolder}
        onFolder={setFilesFolder}
        library={library}
        initial={initial}
        banner={banner}
        onSettings={openSettings}
        onAdd={pickFiles}
        {...(onSave ? { onSave } : {})}
        onShare={setSharing}
        onLeaveFile={leaveAlbum}
        pickFile={pickOneFile}
      />
    );
  } else if (tab === 'albums') {
    add = {
      icon: 'plus',
      label: 'New album',
      onPress: () => {
        setNaming(true);
      },
    };
    screen = (
      <Albums
        onPicking={setTabPicking}
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
        onFavorites={() => {
          setFavoritesOpen(true);
        }}
        {...(searchOn ? { smartAlbums: index.smartAlbums, onOpenSmart: setSmartId } : {})}
      />
    );
  } else {
    add = {
      icon: 'upload',
      label: 'Add photos',
      onPress: () => {
        pickPhotos();
      },
    };
    screen = (
      <Timeline
        onShare={sharePhotos}
        onPicking={setTabPicking}
        {...(onSave ? { onSave } : {})}
        {...(onTeach ? { onTeach } : {})}
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
      <PhotoAspects value={photoAspect}>
        <OpenSearch value={openSearch}>
          <View style={[styles.fill, { backgroundColor: palette.background }]}>
            <View style={[styles.fill, { paddingBottom: showTabs ? 0 : inset }]}>
              <FloatSpace value={showTabs && add ? floatSpace + FAB + FAB_GAP : floatSpace}>
                {screen}
              </FloatSpace>
            </View>
            {floating ? (
              <TabBar tab={tab} inset={inset} palette={palette} onChange={changeTab} />
            ) : null}
            {floating && add && library.status === 'ready' ? (
              <AddButton
                icon={add.icon}
                label={add.label}
                inset={inset}
                palette={palette}
                onPress={add.onPress}
              />
            ) : null}
            <View
              pointerEvents="box-none"
              style={[
                styles.cards,
                {
                  bottom: (floating ? floatSpace + (add ? FAB + FAB_GAP : 0) : inset) + 4,
                },
              ]}
            >
              <SaveCard saving={saving} palette={palette} />
              <UploadCard library={library} palette={palette} onDeleteOriginals={removeOriginals} />
            </View>
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
            {teaching ? (
              teachCountProblem(teaching.length) === null ? (
                <NameSheet
                  title="Teach search a word"
                  action="Teach"
                  label="Word"
                  placeholder="Biscuit, the cabin…"
                  note="Name what these photos show, like a pet’s name or a favorite place. Then search for it by name."
                  maxLength={MAX_WORD_NAME}
                  check={wordCheck({
                    people: people.people.map((each) => each.name),
                    words: index.words.map((word) => word.name),
                  })}
                  onSave={async (name) => {
                    const word = await index.teach(name, teaching);
                    setTeaching(null);
                    notice(`Search learned “${word.name}”`);
                  }}
                  onCancel={() => {
                    setTeaching(null);
                  }}
                />
              ) : (
                <Sheet
                  title="Teach search a word"
                  body={teachCountProblem(teaching.length) ?? ''}
                  onCancel={() => {
                    setTeaching(null);
                  }}
                >
                  <Button
                    label="OK"
                    onPress={() => {
                      setTeaching(null);
                    }}
                  />
                </Sheet>
              )
            ) : null}
            {searching ? (
              <SearchScreen
                find={find}
                library={library}
                onOpen={openFound}
                onClose={closeSearch}
                groups={people.groups}
                wordsOn={searchOn}
                {...(searchOn
                  ? {
                      smartAlbums: index.smartAlbums,
                      onOpenSmart: (id: string) => {
                        closeSearch();
                        setSmartId(id);
                      },
                    }
                  : {})}
                {...(searchOn
                  ? {
                      onSaveAlbum: () => {
                        setSavingSearch(true);
                      },
                    }
                  : {})}
              />
            ) : null}
            {trashOpen ? (
              <RecentlyDeleted
                library={library}
                initial={initial}
                onSettings={openSettings}
                onClose={closeTrash}
              />
            ) : null}
            {savingSearch && find.query ? (
              <NameSheet
                title="Save as album"
                action="Save album"
                initial={suggestTitle(find.query.chips)}
                note="It fills itself with photos that match, as they’re added. Only you see it."
                maxLength={MAX_SMART_TITLE}
                check={smartTitleCheck(searchToSave(find))}
                onSave={async (title) => {
                  const stored = await index.saveSmartAlbum({ ...searchToSave(find), title });
                  setSavingSearch(false);
                  notice(`“${stored.title}” saved to Albums`);
                  closeSearch();
                  setAlbumId(null);
                  setPersonId(null);
                  setSmartMore(false);
                  setSmartId(stored.id);
                }}
                onCancel={() => {
                  setSavingSearch(false);
                }}
              />
            ) : null}
            {/* Once everything it was showing has gone (moved away, say), it closes itself. */}
            {viewing ? (
              <Viewer
                photos={viewed}
                start={Math.max(0, Math.min(viewing.start, viewed.length - 1))}
                library={library}
                {...(onSave
                  ? {
                      onSave: (photoId: string) => {
                        onSave([photoId]);
                      },
                    }
                  : {})}
                {...(viewing.from === 'album' && album ? { album } : {})}
                {...(viewing.from === 'person' && person
                  ? {
                      notThis: {
                        label: person.person?.name
                          ? `Not ${person.person.name}`
                          : 'Not this person',
                        run: async (photoId: string) =>
                          (await people.removePhotos(person, [photoId])).done.length > 0,
                      },
                    }
                  : {})}
                onShare={(photoId) => {
                  // In your own album, the photo is already in it: share that album.
                  if (
                    viewing.from === 'album' &&
                    album &&
                    album.library === undefined &&
                    album.sharedAlbum !== true
                  ) {
                    setSharing({ albumId: album.id });
                  } else {
                    sharePhotos([photoId]);
                  }
                }}
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
                album={shareTarget(sharing, library)}
                keys={keys}
                onSharedWith={library.setSharedWith}
                onStopSharing={library.stopSharingAlbum}
                onClose={closeShare}
              />
            ) : null}
            {shareFor && !shareFor.naming ? (
              <ShareThroughSheet
                photos={library.photos.filter((each) => shareFor.photoIds.includes(each.id))}
                albums={library.albums}
                onPick={(target) => {
                  shareThrough(target, shareFor.photoIds).catch((error: unknown) => {
                    notice(errorMessage(error));
                  });
                }}
                onNew={() => {
                  setShareFor({ ...shareFor, naming: true });
                }}
                onCancel={() => {
                  setShareFor(null);
                }}
              />
            ) : null}
            {shareFor?.naming ? (
              <NameSheet
                title="New shared album"
                action="Create and share"
                onSave={async (name) => {
                  const made = await createAlbum(name);
                  await shareThrough(made, shareFor.photoIds);
                }}
                onCancel={() => {
                  setShareFor(null);
                }}
              />
            ) : null}
            {joining ? <JoinScreen onClose={closeJoin} /> : null}
            <InviteRequests albums={library.albums} showJoins={!joining} />
            <BiometricSheet />
          </View>
        </OpenSearch>
      </PhotoAspects>
    </InvitesProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  cards: { position: 'absolute', left: 12, right: 12, gap: 8 },
  fab: {
    position: 'absolute',
    right: EDGE,
    width: FAB,
    height: FAB,
    borderRadius: FAB / 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#0b0e24',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  bannerWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  tabBar: {
    position: 'absolute',
    left: EDGE,
    right: EDGE,
    height: TAB_BAR,
    borderRadius: TAB_BAR / 2,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    padding: 6,
    gap: 2,
    elevation: 8,
    shadowColor: '#0b0e24',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: (TAB_BAR - 12) / 2,
  },
  tabLabel: { fontSize: 14, fontWeight: '700' },
});
