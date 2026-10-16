import type { ReactNode } from 'react';

import { AccountProvider, useAccount } from './account';
import type { AccountState } from './account';
import { ThemeProvider } from './theme';
import { ToastProvider } from './toast';
import { VaultProvider } from './vault';
import type { VaultsState } from './vault';

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
  const { generation, space } = useAccount();
  const open = space ?? 'main';
  return initialVault ? (
    <VaultProvider key={generation} space={open} initialState={initialVault}>
      {children}
    </VaultProvider>
  ) : (
    <VaultProvider key={generation} space={open}>
      {children}
    </VaultProvider>
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
