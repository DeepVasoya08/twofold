import { useState } from 'react';
import type { ReactNode } from 'react';

import { AccountProvider, useAccount } from './account';
import type { AccountState } from './account';
import { ThemeProvider } from './theme';
import { ToastProvider } from './toast';
import type { Session, Space } from './account-ops';
import { memoryStore, remoteStore } from './space-store';
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
      ? remoteStore(session.opened.space)
      : memoryStore((initialVault ?? emptyVaults).spaces[space]),
  );
  return (
    <VaultProvider
      space={space}
      store={store}
      otherKeys={session?.otherSpace}
      storeFor={remoteStore}
      initialState={initialVault?.spaces[space]}
    >
      {children}
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
        {initialAccount ? (
          <AccountProvider initialState={initialAccount}>
            <SessionVault initialVault={initialVault}>{children}</SessionVault>
          </AccountProvider>
        ) : (
          <AccountProvider>
            <SessionVault initialVault={initialVault}>{children}</SessionVault>
          </AccountProvider>
        )}
      </ToastProvider>
    </ThemeProvider>
  );
}
