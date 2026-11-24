import { useState } from 'react';
import type { ReactNode } from 'react';

import { AccountProvider, useAccount } from './account';
import { AutoLockProvider, IdleLock } from './auto-lock';
import type { AccountState } from './account';
import { DownloadsProvider } from './downloads';
import { ThemeProvider } from './theme';
import { ToastProvider } from './toast';
import type { Session, Space } from '@arcafold/core/account';
import { PendingInvitesProvider } from './invites';
import { ProfileProvider } from './profile';
import { memoryProfilePhoto, remoteProfilePhoto } from '@arcafold/core/profile-photo';
import { sessionStore } from '@arcafold/core/sharing';
import { StorageProvider } from './storage';
import { UploadsProvider } from './uploads';
import { ImportsProvider } from './imports';
import { PeopleProvider } from './people';
import { memoryPeopleStore, remotePeopleStore } from '@arcafold/core/people/store';
import { workerFaceFinder } from '../lib/people/face-finder';
import type { FaceFinder, FaceWorker } from '../lib/people/face-finder';
import { workerPhotoEncoder } from '../lib/search/photo-encoder';
import type { EncoderWorker, PhotoEncoder } from '../lib/search/photo-encoder';
import { workerQueryEncoder } from '../lib/search/query-encoder';
import type { QueryEncoder } from '../lib/search/query-encoder';
import { FindProvider } from './find';
import { SearchProvider } from './search';
import { memorySearchStore, remoteSearchStore } from '@arcafold/core/search/store';
import { VaultProvider, emptyVaults } from './vault';
import type { VaultsState } from './vault';
import { memoryStore } from './memory-store';
import { remoteStore } from '@arcafold/core/library/space-store';

/** A worker whose module loads on first use; messages sent before then wait for it. */
function lazyWorker(load: () => Promise<Worker>): FaceWorker & EncoderWorker {
  const ready = load();
  return {
    postMessage: (message) => {
      void ready.then((started) => {
        started.postMessage(message);
      });
    },
    addEventListener: (type, listener) => {
      void ready.then((started) => {
        started.addEventListener(type, listener);
      });
    },
    terminate: () => {
      void ready.then((started) => {
        started.terminate();
      });
    },
  };
}

/**
 * Finds faces in a Web Worker, loaded only once face grouping runs. Without Web Workers or
 * OffscreenCanvas (older browsers), every request fails and People says so.
 */
function startFaceFinder(): FaceFinder {
  return workerFaceFinder(() =>
    lazyWorker(() =>
      import('../lib/people/spawn-face-worker').then(({ spawnFaceWorker }) => spawnFaceWorker()),
    ),
  );
}

/** Works out search vectors in a Web Worker, loaded only once there's a photo to look at. */
function startEncoder(onProgress: (received: number, total: number) => void): PhotoEncoder {
  return workerPhotoEncoder(
    () =>
      lazyWorker(() =>
        import('../lib/search/spawn-encoder-worker').then(({ spawnEncoderWorker }) =>
          spawnEncoderWorker(),
        ),
      ),
    onProgress,
  );
}

/** Turns typed queries into search vectors in a Web Worker, loaded on the first search. */
function startQueryEncoder(onProgress: (received: number, total: number) => void): QueryEncoder {
  return workerQueryEncoder(
    () =>
      lazyWorker(() =>
        import('../lib/search/spawn-query-worker').then(({ spawnQueryWorker }) =>
          spawnQueryWorker(),
        ),
      ),
    onProgress,
  );
}

/** The open space's vault, with a store made once from the keys it was mounted with. */
function OpenVault({
  children,
  space,
  session,
  initialVault,
}: {
  children: ReactNode;
  space: Space;
  session: Session | null;
  initialVault: VaultsState | undefined;
}) {
  const [store] = useState(() =>
    session && !initialVault
      ? sessionStore(session.opened.space, session.account.name)
      : memoryStore((initialVault ?? emptyVaults).spaces[space]),
  );
  const [profileStore] = useState(() =>
    session && !initialVault ? remoteProfilePhoto(session.opened.space) : memoryProfilePhoto(),
  );
  const [peopleStore] = useState(() =>
    session && !initialVault ? remotePeopleStore(session.opened.space) : memoryPeopleStore(),
  );
  const [searchStore] = useState(() =>
    session && !initialVault ? remoteSearchStore(session.opened.space) : memorySearchStore(),
  );
  return (
    <VaultProvider
      space={space}
      store={store}
      otherKeys={session?.otherSpace}
      storeFor={remoteStore}
      initialState={initialVault?.spaces[space]}
    >
      <PendingInvitesProvider
        keys={session && !initialVault ? session.opened.space : null}
        myName={session?.account.name ?? ''}
      >
        <ProfileProvider store={profileStore}>
          <StorageProvider remote={session !== null && !initialVault}>
            <UploadsProvider>
              <ImportsProvider>
                <PeopleProvider
                  store={peopleStore}
                  makeFinder={session && !initialVault ? startFaceFinder : null}
                >
                  <SearchProvider
                    store={searchStore}
                    makeEncoder={session && !initialVault ? startEncoder : null}
                  >
                    <FindProvider
                      makeQueryEncoder={session && !initialVault ? startQueryEncoder : null}
                    >
                      <DownloadsProvider>
                        <IdleLock />
                        {children}
                      </DownloadsProvider>
                    </FindProvider>
                  </SearchProvider>
                </PeopleProvider>
              </ImportsProvider>
            </UploadsProvider>
          </StorageProvider>
        </ProfileProvider>
      </PendingInvitesProvider>
    </VaultProvider>
  );
}

/**
 * Decrypted photos for the unlocked session. Remounted whenever the account drops or
 * replaces its keys, so nothing decrypted survives a lock or sign-out.
 */
function SessionVault({
  children,
  initialVault,
}: {
  children: ReactNode;
  initialVault?: VaultsState | undefined;
}) {
  const { generation, space, state } = useAccount();
  return (
    <OpenVault
      key={generation}
      space={space ?? 'main'}
      session={state.status === 'unlocked' ? state.session : null}
      initialVault={initialVault}
    >
      {children}
    </OpenVault>
  );
}

/** App-wide state. The router is supplied separately so tests can use MemoryRouter. */
export function Providers({
  children,
  initialAccount,
  initialVault,
}: {
  children: ReactNode;
  initialAccount?: AccountState;
  initialVault?: VaultsState;
}) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AutoLockProvider>
          {initialAccount ? (
            <AccountProvider initialState={initialAccount}>
              <SessionVault initialVault={initialVault}>{children}</SessionVault>
            </AccountProvider>
          ) : (
            <AccountProvider>
              <SessionVault initialVault={initialVault}>{children}</SessionVault>
            </AccountProvider>
          )}
        </AutoLockProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
