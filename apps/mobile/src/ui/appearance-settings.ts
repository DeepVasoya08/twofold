import { PHOTO_VIEWS } from '../library/layout';
import type { PhotoView } from '../library/layout';

/** The theme chosen in Settings: follow the phone, or always light or dark. */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/** How this phone looks: settings of the phone, like the web's, nothing about the photos. */
export interface AppearanceSettings {
  theme: ThemeChoice;
  photoView: PhotoView;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = { theme: 'system', photoView: 'grid' };

/** A saved file's settings, or the defaults for anything missing or unreadable. */
export function cleanAppearance(text: string | null): AppearanceSettings {
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    return DEFAULT_APPEARANCE;
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_APPEARANCE;
  const saved = parsed as Record<string, unknown>;
  const theme = THEME_CHOICES.find((choice) => choice === saved.theme);
  const photoView = PHOTO_VIEWS.find((choice) => choice === saved.photoView);
  return {
    theme: theme ?? DEFAULT_APPEARANCE.theme,
    photoView: photoView ?? DEFAULT_APPEARANCE.photoView,
  };
}

/** Which palette a theme choice gives, with the phone set to `system`. */
export function schemeFor(theme: ThemeChoice, system: string | null | undefined): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return system === 'light' ? 'light' : 'dark';
}
