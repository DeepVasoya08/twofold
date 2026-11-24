import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { File, Paths } from 'expo-file-system';

import type { PhotoView } from '../library/layout';
import { DEFAULT_APPEARANCE, cleanAppearance } from './appearance-settings';
import type { AppearanceSettings, ThemeChoice } from './appearance-settings';

interface AppearanceValue extends AppearanceSettings {
  setTheme: (theme: ThemeChoice) => void;
  setPhotoView: (view: PhotoView) => void;
}

const Appearance = createContext<AppearanceValue>({
  ...DEFAULT_APPEARANCE,
  setTheme: () => undefined,
  setPhotoView: () => undefined,
});

const file = () => new File(Paths.document, 'appearance.json');

async function saved(): Promise<AppearanceSettings> {
  try {
    const stored = file();
    return stored.exists ? cleanAppearance(await stored.text()) : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/**
 * The theme and photo view chosen in Settings, kept in the app's private storage. Until the
 * file is read the defaults show, which is how the app looks before anything is chosen.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppearanceSettings>(DEFAULT_APPEARANCE);
  useEffect(() => {
    let live = true;
    void saved().then((read) => {
      if (live) setSettings(read);
    });
    return () => {
      live = false;
    };
  }, []);
  const change = useCallback((next: Partial<AppearanceSettings>) => {
    setSettings((now) => {
      const updated = { ...now, ...next };
      void Promise.resolve()
        .then(() => file().write(JSON.stringify(updated)))
        .catch(() => undefined);
      return updated;
    });
  }, []);
  const value = useMemo(
    () => ({
      ...settings,
      setTheme: (theme: ThemeChoice) => {
        change({ theme });
      },
      setPhotoView: (photoView: PhotoView) => {
        change({ photoView });
      },
    }),
    [settings, change],
  );
  return <Appearance value={value}>{children}</Appearance>;
}

export function useAppearance(): AppearanceValue {
  return useContext(Appearance);
}

/** Each photo's width over its height, for the uncropped view (1 when unknown). */
export const PhotoAspects = createContext<(photoId: string) => number>(() => 1);
