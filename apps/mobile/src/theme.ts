export interface Palette {
  background: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  onAccent: string;
  /** The logo's inner arch, and other soft touches of the accent. */
  accentSoft: string;
  error: string;
  errorSoft: string;
  warning: string;
  success: string;
  track: string;
  /** Whether this palette is dark, for the status bar and anything drawn over photos. */
  dark: boolean;
}

/**
 * The app's colours, the same as the web app's light and dark themes (styles/base.css): a
 * calm, near-colourless interface so photos carry the colour, with one cobalt accent kept for
 * the main action and the logo.
 */
export const colors: { dark: Palette; light: Palette } = {
  dark: {
    background: '#111214',
    surface: '#1b1c20',
    border: '#2c2d33',
    text: '#ececea',
    muted: '#a8abb2',
    accent: '#7d8fff',
    onAccent: '#0b0e24',
    accentSoft: '#2f4bf0',
    error: '#ff8a8a',
    errorSoft: '#3e1f1d',
    warning: '#d9902e',
    success: '#6fcf9a',
    track: '#232429',
    dark: true,
  },
  light: {
    background: '#f6f6f3',
    surface: '#ffffff',
    border: '#e0e0da',
    text: '#15171c',
    muted: '#565a63',
    accent: '#2f4bf0',
    onAccent: '#ffffff',
    accentSoft: '#7d8fff',
    error: '#b3261e',
    errorSoft: '#fbe4e1',
    warning: '#b86f12',
    success: '#2a7a52',
    track: '#e8e8e3',
    dark: false,
  },
};

/**
 * The private space is always "night", whatever the phone's light or dark setting: the same
 * layout in deep navy and lavender, so you always know where you are. Only shown once the
 * private space is open; the lock screen looks the same for both passwords.
 */
export const nightColors: Palette = {
  background: '#0c1130',
  surface: '#141b44',
  border: '#232c62',
  text: '#e9ebff',
  muted: '#a9afd8',
  accent: '#8c9cff',
  onAccent: '#0c1130',
  accentSoft: '#c9d0ff',
  error: '#ff8f8f',
  errorSoft: '#3a1a2a',
  warning: '#e0a85a',
  success: '#6fcf9a',
  track: '#1a2250',
  dark: true,
};

/**
 * The headings' typeface, bundled with the app (modules/brand-fonts). On Android a bundled
 * font is picked by its file name, so each weight is its own family; leave fontWeight unset.
 */
export const fonts = {
  display: 'BricolageGrotesque-Bold',
  displaySemi: 'BricolageGrotesque-SemiBold',
} as const;
