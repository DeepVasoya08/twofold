import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { RefreshControl } from 'react-native';
import type { RefreshControlProps } from 'react-native';

import { useNotice } from './notice';
import { usePalette } from './theme';

/**
 * Pull to refresh for a list: pulling down lists the library again now, as the app does by
 * itself every so often, and says so when it can't.
 */
export function usePullToRefresh(refresh: () => Promise<void>): ReactElement<RefreshControlProps> {
  const palette = usePalette();
  const notice = useNotice();
  const [pulling, setPulling] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const onRefresh = useCallback(() => {
    setPulling(true);
    refresh()
      .catch(() => {
        notice('Couldn’t check for changes. Check your connection.');
      })
      .finally(() => {
        if (mounted.current) setPulling(false);
      });
  }, [refresh, notice]);
  return (
    <RefreshControl
      refreshing={pulling}
      onRefresh={onRefresh}
      tintColor={palette.accent}
      colors={[palette.accent]}
    />
  );
}
