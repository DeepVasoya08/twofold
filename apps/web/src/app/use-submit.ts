import { useCallback, useState } from 'react';

import { errorMessage } from './account-ops';

/** Busy and error state for a form whose submit runs an async account operation. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Runs the operation; resolves to true if it succeeded. */
  const run = useCallback(async (operation: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, setError, run };
}
