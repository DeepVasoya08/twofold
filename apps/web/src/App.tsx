import { useEffect } from 'react';

import { redirectFor } from './app/access';
import { useAccount } from './app/account';
import { useRouter } from './app/router';
import { matchRoute } from './app/routes';
import type { Route } from './app/routes';
import { AppShell } from './components/AppShell';
import { Album } from './screens/Album';
import { SmartAlbumView } from './screens/SmartAlbum';
import { Albums } from './screens/Albums';
import { Favorites } from './screens/Favorites';
import { Files } from './screens/Files';
import { Gallery } from './screens/Gallery';
import { Import } from './screens/Import';
import { JoinCode } from './screens/JoinCode';
import { JoinInvite } from './screens/JoinInvite';
import { LogIn } from './screens/LogIn';
import { NotFound } from './screens/NotFound';
import { People } from './screens/People';
import { Person } from './screens/Person';
import { PhotoViewer } from './screens/PhotoViewer';
import { Privacy } from './screens/Privacy';
import { RecentlyDeleted } from './screens/RecentlyDeleted';
import { Recover } from './screens/Recover';
import { RecoveryKey } from './screens/RecoveryKey';
import { Search } from './screens/Search';
import { Settings } from './screens/Settings';
import { Share } from './screens/Share';
import { SignUp } from './screens/SignUp';
import { SpeedTest } from './screens/SpeedTest';
import { Terms } from './screens/Terms';
import { Unlock } from './screens/Unlock';
import { Welcome } from './screens/Welcome';
import { isPublicRoute, publicPage } from './site/pages';

const titles: Record<Route['name'], string> = {
  welcome: publicPage('welcome').title,
  privacy: publicPage('privacy').title,
  terms: publicPage('terms').title,
  signup: 'Create your vault · Arcafold',
  'recovery-key': 'Recovery key · Arcafold',
  login: 'Log in · Arcafold',
  unlock: 'Unlock · Arcafold',
  recover: 'Recover your vault · Arcafold',
  gallery: 'Photos · Arcafold',
  albums: 'Albums · Arcafold',
  album: 'Album · Arcafold',
  'smart-album': 'Album · Arcafold',
  favorites: 'Favorites · Arcafold',
  files: 'Files · Arcafold',
  trash: 'Recently deleted · Arcafold',
  search: 'Search · Arcafold',
  people: 'People · Arcafold',
  person: 'People · Arcafold',
  photo: 'Photo · Arcafold',
  settings: 'Settings · Arcafold',
  import: 'Import photos · Arcafold',
  share: 'Share · Arcafold',
  join: 'Invite · Arcafold',
  'join-code': 'Enter an invite code · Arcafold',
  'speed-test': 'Speed test · Arcafold',
  'not-found': 'Not found · Arcafold',
};

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'welcome':
      return <Welcome />;
    case 'privacy':
      return <Privacy />;
    case 'terms':
      return <Terms />;
    case 'signup':
      return <SignUp />;
    case 'recovery-key':
      return <RecoveryKey />;
    case 'login':
      return <LogIn />;
    case 'unlock':
      return <Unlock />;
    case 'recover':
      return <Recover />;
    case 'photo':
      return <PhotoViewer photoId={route.photoId} />;
    case 'speed-test':
      return <SpeedTest />;
    case 'not-found':
      return <NotFound />;
    case 'gallery':
      return (
        <AppShell>
          <Gallery />
        </AppShell>
      );
    case 'albums':
      return (
        <AppShell>
          <Albums />
        </AppShell>
      );
    case 'album':
      return (
        <AppShell uploadAlbumId={route.albumId}>
          <Album albumId={route.albumId} />
        </AppShell>
      );
    case 'smart-album':
      return (
        <AppShell>
          <SmartAlbumView albumId={route.albumId} />
        </AppShell>
      );
    case 'favorites':
      return (
        <AppShell>
          <Favorites />
        </AppShell>
      );
    case 'files':
      return (
        <AppShell>
          <Files />
        </AppShell>
      );
    case 'trash':
      return (
        <AppShell>
          <RecentlyDeleted />
        </AppShell>
      );
    case 'search':
      return (
        <AppShell>
          <Search />
        </AppShell>
      );
    case 'people':
      return (
        <AppShell>
          <People />
        </AppShell>
      );
    case 'person':
      return (
        <AppShell>
          <Person groupId={route.groupId} />
        </AppShell>
      );
    case 'settings':
      return (
        <AppShell>
          <Settings />
        </AppShell>
      );
    case 'import':
      return (
        <AppShell>
          <Import />
        </AppShell>
      );
    case 'share':
      return (
        <AppShell>
          <Share />
        </AppShell>
      );
    case 'join':
      return (
        <AppShell>
          <JoinInvite token={route.token} />
        </AppShell>
      );
    case 'join-code':
      return (
        <AppShell>
          <JoinCode />
        </AppShell>
      );
  }
}

/** Sends the browser elsewhere after render, and shows nothing meanwhile. */
function Redirect({ to }: { to: string }) {
  const { navigate } = useRouter();
  useEffect(() => {
    navigate(to, { replace: true });
  }, [navigate, to]);
  return null;
}

/** Picks the screen for the current URL. Providers live in main.tsx (and in tests). */
export function App() {
  const { pathname, search } = useRouter();
  const route = matchRoute(pathname);
  const { state, space, pendingSignUp } = useAccount();

  // The private space re-tints the whole app (see styles/base.css).
  useEffect(() => {
    document.documentElement.dataset.space = space ?? 'main';
  }, [space]);

  useEffect(() => {
    document.title = titles[route.name];
  }, [route.name]);

  // Until the API says who is signed in, show nothing rather than the wrong screen. Public
  // pages show straight away, as they were prerendered; the landing page still sends an
  // unlocked account on to its photos once that's known.
  if (state.status === 'loading')
    return isPublicRoute(route.name) ? <Screen route={route} /> : null;
  const redirect = redirectFor(route, state, {
    space,
    signingUp: pendingSignUp !== null,
    search,
  });
  if (redirect) return <Redirect to={redirect} />;
  return <Screen route={route} />;
}
