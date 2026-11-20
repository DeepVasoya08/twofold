import { useCallback, useEffect, useState } from 'react';
import { File, Paths } from 'expo-file-system';

import type { SmartFeaturesChoice } from '@arcafold/types';

/**
 * Whether this phone looks at photos for Smart search and finds faces for People: settings
 * of the phone, as on the web, kept in the app's private storage. Each applies to whichever
 * space is open, so the main library can't show what runs in another space.
 */
export interface SmartSettings {
  /** On unless turned off on this phone. */
  search: boolean;
  /** This phone's choice, or null to follow the account's answer to the smart features question. */
  faces: 'on' | 'off' | null;
}

export const DEFAULT_SMART_SETTINGS: SmartSettings = { search: true, faces: null };

/** A saved file's settings, or the defaults for anything missing or unreadable. */
export function cleanSmartSettings(text: string | null): SmartSettings {
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    return DEFAULT_SMART_SETTINGS;
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SMART_SETTINGS;
  const saved = parsed as Record<string, unknown>;
  return {
    search: saved.search !== 'off',
    faces: saved.faces === 'on' || saved.faces === 'off' ? saved.faces : null,
  };
}

/** Whether faces are found: this phone's choice if it made one, otherwise the account's. */
export function facesOn(settings: SmartSettings, account: SmartFeaturesChoice | null): boolean {
  if (settings.faces !== null) return settings.faces === 'on';
  return account?.choice === 'on';
}

const file = () => new File(Paths.document, 'smart-features.json');

async function saved(): Promise<SmartSettings> {
  try {
    const stored = file();
    return stored.exists ? cleanSmartSettings(await stored.text()) : DEFAULT_SMART_SETTINGS;
  } catch {
    return DEFAULT_SMART_SETTINGS;
  }
}

async function save(settings: SmartSettings): Promise<void> {
  try {
    await file().write(
      JSON.stringify({ search: settings.search ? 'on' : 'off', faces: settings.faces }),
    );
  } catch {
    // Not saved: the next start uses the defaults; this one uses the choice.
  }
}

/**
 * This phone's smart features settings: null until read, so nothing starts before then.
 * `account` is the account's answer to the smart features question.
 */
export function useSmartSettings(account: SmartFeaturesChoice | null): {
  loaded: boolean;
  search: boolean;
  faces: boolean;
  setSearch: (on: boolean) => void;
  setFaces: (on: boolean) => void;
} {
  const [settings, setSettings] = useState<SmartSettings | null>(null);
  useEffect(() => {
    let live = true;
    void saved().then((read) => {
      if (live) setSettings(read);
    });
    return () => {
      live = false;
    };
  }, []);
  const change = useCallback(
    (update: Partial<SmartSettings>) => {
      const next = { ...(settings ?? DEFAULT_SMART_SETTINGS), ...update };
      setSettings(next);
      void save(next);
    },
    [settings],
  );
  const setSearch = useCallback(
    (on: boolean) => {
      change({ search: on });
    },
    [change],
  );
  const setFaces = useCallback(
    (on: boolean) => {
      change({ faces: on ? 'on' : 'off' });
    },
    [change],
  );
  return {
    loaded: settings !== null,
    search: settings?.search ?? false,
    faces: settings ? facesOn(settings, account) : false,
    setSearch,
    setFaces,
  };
}
