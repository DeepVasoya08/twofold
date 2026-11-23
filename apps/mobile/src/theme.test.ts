import { describe, expect, it } from 'vitest';

import { contrastRatio } from '@arcafold/core/contrast';

import { colors, nightColors } from './theme';
import type { Palette } from './theme';

const palettes: [string, Palette][] = [
  ['light', colors.light],
  ['dark', colors.dark],
  ['night (private space)', nightColors],
];

describe.each(palettes)('the %s palette', (_, palette) => {
  it('keeps text readable on the background and on cards', () => {
    expect(contrastRatio(palette.text, palette.background)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(palette.text, palette.surface)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(palette.muted, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.muted, palette.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the main button readable', () => {
    expect(contrastRatio(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('shows the accent and errors against the background', () => {
    expect(contrastRatio(palette.accent, palette.background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(palette.error, palette.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('says whether it is dark, for the status bar', () => {
    expect(palette.dark).toBe(contrastRatio(palette.background, '#000000') < 2);
  });
});

describe('the private space', () => {
  it('is night whatever the phone is set to, so it never looks like the library', () => {
    expect(nightColors.background).not.toBe(colors.light.background);
    expect(nightColors.background).not.toBe(colors.dark.background);
    expect(nightColors.accent).not.toBe(colors.dark.accent);
  });
});
