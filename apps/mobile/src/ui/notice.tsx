import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { usePalette } from './theme';

/** How long a notice stays up. */
const SHOWN_MS = 3500;

const NoticeContext = createContext<(text: string) => void>(() => undefined);

/** Says something short that just happened ("Album deleted"), over the bottom of the screen. */
export function useNotice(): (text: string) => void {
  return useContext(NoticeContext);
}

/** Shows notices for everything inside it, one at a time, `bottom` points above the edge. */
export function NoticeProvider({ bottom, children }: { bottom: number; children: ReactNode }) {
  const palette = usePalette();
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  const show = useCallback((text: string) => {
    setNotice({ text, at: Date.now() });
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setNotice(null);
    }, SHOWN_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [notice]);
  const value = useMemo(() => show, [show]);
  return (
    <NoticeContext.Provider value={value}>
      {children}
      {notice ? (
        <View pointerEvents="none" style={[styles.wrap, { bottom }]}>
          <View style={[styles.notice, { backgroundColor: palette.text }]}>
            <Text
              style={[styles.text, { color: palette.background }]}
              accessibilityLiveRegion="polite"
            >
              {notice.text}
            </Text>
          </View>
        </View>
      ) : null}
    </NoticeContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  notice: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, elevation: 8 },
  text: { fontSize: 14, fontWeight: '600' },
});
