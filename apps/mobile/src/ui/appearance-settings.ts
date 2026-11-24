import { PHOTO_VIEWS } from '../library/layout';
import type { PhotoView } from '../library/layout';

/** The theme chosen in Settings: follow the phone, or always light or dark. */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/** Albums two or three across. */
export type AlbumView = 'large' | 'small';
/** Files as a list, or a grid of previews. */
export type FileView = 'list' | 'grid';
/** People's faces three or four across. */
export type PeopleView = 'large' | 'small';

export const ALBUM_VIEWS: readonly AlbumView[] = ['large', 'small'];
export const FILE_VIEWS: readonly FileView[] = ['list', 'grid'];
export const PEOPLE_VIEWS: readonly PeopleView[] = ['large', 'small'];

/**
 * How this phone looks: settings of the phone, like the web's, nothing about the photos.
 * Each tab's View button sets its own layout.
 */
export interface AppearanceSettings {
  theme: ThemeChoice;
  photoView: PhotoView;
  albumView: AlbumView;
  fileView: FileView;
  peopleView: PeopleView;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'system',
  photoView: 'grid',
  albumView: 'large',
  fileView: 'list',
  peopleView: 'large',
};

function pick<T extends string>(choices: readonly T[], value: unknown, fallback: T): T {
  return choices.find((choice) => choice === value) ?? fallback;
}

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
  return {
    theme: pick(THEME_CHOICES, saved.theme, DEFAULT_APPEARANCE.theme),
    photoView: pick(PHOTO_VIEWS, saved.photoView, DEFAULT_APPEARANCE.photoView),
    albumView: pick(ALBUM_VIEWS, saved.albumView, DEFAULT_APPEARANCE.albumView),
    fileView: pick(FILE_VIEWS, saved.fileView, DEFAULT_APPEARANCE.fileView),
    peopleView: pick(PEOPLE_VIEWS, saved.peopleView, DEFAULT_APPEARANCE.peopleView),
  };
}

/** Which palette a theme choice gives, with the phone set to `system`. */
export function schemeFor(theme: ThemeChoice, system: string | null | undefined): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return system === 'light' ? 'light' : 'dark';
}
