import { useEffect } from 'react';

import { useRouter } from './app/router';
import { matchRoute } from './app/routes';
import type { Route } from './app/routes';
import { AppShell } from './components/AppShell';
import { Album } from './screens/Album';
import { Albums } from './screens/Albums';
import { Favorites } from './screens/Favorites';
import { Gallery } from './screens/Gallery';
import { LogIn } from './screens/LogIn';
import { NotFound } from './screens/NotFound';
import { Pair } from './screens/Pair';
import { PhotoViewer } from './screens/PhotoViewer';
import { Recover } from './screens/Recover';
import { RecoveryKey } from './screens/RecoveryKey';
import { Settings } from './screens/Settings';
import { SignUp } from './screens/SignUp';
import { Unlock } from './screens/Unlock';
import { Welcome } from './screens/Welcome';

const titles: Record<Route['name'], string> = {
  welcome: 'Twofold',
  signup: 'Create your vault · Twofold',
  'recovery-key': 'Recovery key · Twofold',
  login: 'Log in · Twofold',
  unlock: 'Unlock · Twofold',
  recover: 'Recover your vault · Twofold',
  pair: 'Invite your partner · Twofold',
  gallery: 'Photos · Twofold',
  albums: 'Albums · Twofold',
  album: 'Album · Twofold',
  favorites: 'Favorites · Twofold',
  photo: 'Photo · Twofold',
  settings: 'Settings · Twofold',
  'not-found': 'Not found · Twofold',
};

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'welcome':
      return <Welcome />;
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
    case 'pair':
      return <Pair />;
    case 'photo':
      return <PhotoViewer photoId={route.photoId} />;
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
    case 'favorites':
      return (
        <AppShell>
          <Favorites />
        </AppShell>
      );
    case 'settings':
      return (
        <AppShell>
          <Settings />
        </AppShell>
      );
  }
}

/** Picks the screen for the current URL. Providers live in main.tsx (and in tests). */
export function App() {
  const { pathname } = useRouter();
  const route = matchRoute(pathname);

  useEffect(() => {
    document.title = titles[route.name];
  }, [route.name]);

  return <Screen route={route} />;
}
