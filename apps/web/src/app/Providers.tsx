import { useState } from 'react';
import type { ReactNode } from 'react';

import { AccountProvider, useAccount } from './account';
import { AutoLockProvider, IdleLock } from './auto-lock';
import type { AccountState } from './account';
import { ThemeProvider } from './theme';
import { ToastProvider } from './toast';
import type { Session, Space } from './account-ops';
import { PendingInvitesProvider } from './invites';
import { ProfileProvider } from './profile';
import { memoryProfilePhoto, remoteProfilePhoto } from './profile-photo';
import { sessionStore } from './sharing';
import { memoryStore, remoteStore } from './space-store';
import { UploadsProvider } from './uploads';
import { VaultProvider, emptyVaults } from './vault';
import type { VaultsState } from './vault';

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
          <UploadsProvider>
            <IdleLock />
            {children}
          </UploadsProvider>
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
