import type { ReactNode } from 'react';

import { ThemeProvider } from './theme';
import { ToastProvider } from './toast';
import { VaultProvider } from './vault';
import type { VaultsState } from './vault';

/** App-wide state. The router is supplied separately so tests can use MemoryRouter. */
export function Providers({
  children,
  initialVault,
}: {
  children: ReactNode;
  initialVault?: VaultsState;
}) {
  return (
    <ThemeProvider>
      <ToastProvider>
        {initialVault ? (
          <VaultProvider initialState={initialVault}>{children}</VaultProvider>
        ) : (
          <VaultProvider>{children}</VaultProvider>
        )}
      </ToastProvider>
    </ThemeProvider>
  );
}
