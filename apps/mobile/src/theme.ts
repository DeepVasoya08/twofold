/** The app's colours, the same as the web app's light and dark themes (styles/base.css). */
export const colors = {
  dark: {
    background: '#161117',
    surface: '#1c151e',
    border: '#3a2f3d',
    text: '#f6eee8',
    muted: '#c0b2c2',
    accent: '#ef7d88',
    onAccent: '#161117',
    error: '#ff8a8a',
    errorSoft: '#3e1f1d',
    /** How strongly the sign-in screens' glow shows. */
    glow: 0.9,
    warning: '#d9902e',
    success: '#6fcf9a',
    track: '#2a222c',
  },
  light: {
    background: '#fbf7f2',
    surface: '#f5ede4',
    border: '#d9cdd3',
    text: '#2b2030',
    muted: '#6b5c6f',
    accent: '#d9586a',
    onAccent: '#ffffff',
    error: '#b3261e',
    errorSoft: '#fbe4e1',
    glow: 0.35,
    warning: '#b86f12',
    success: '#2f8a5b',
    track: '#e8ddd6',
  },
} as const;
