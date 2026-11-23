import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { contrastRatio } from '@arcafold/core/contrast';

const css = readFileSync(new URL('./base.css', import.meta.url), 'utf8');

/** The colour tokens set in the first block that opens with `selector {`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No ${selector} block`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,6});/gi)].map(([, name, value]) => [name, value]),
  ) as Record<string, string>;
}

const light = tokens(':root');
const dark = tokens(":root[data-theme='dark']");
const night = tokens(":root[data-space='private']");
const color = (palette: Record<string, string>, name: string): string => {
  const value = palette[name];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
};

describe.each([
  ['light', light],
  ['dark', dark],
  ['night (private space)', night],
])('the %s theme', (_, palette) => {
  const c = (name: string) => color(palette, name);

  it('keeps text readable on the page, cards and tinted panels', () => {
    for (const ground of ['bg', 'surface', 'surface-2']) {
      expect(contrastRatio(c('text'), c(ground))).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(c('text-2'), c(ground))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps links and the main button readable', () => {
    expect(contrastRatio(c('accent-text'), c('bg'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c('on-accent'), c('accent'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c('on-accent'), c('accent-hover'))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps errors readable', () => {
    expect(contrastRatio(c('danger'), c('bg'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the themes', () => {
  it('use the same dark colours whether dark comes from the system or the setting', () => {
    expect(tokens(":root:not([data-theme='light'])")).toEqual(dark);
  });

  it('give the private space its own night colours, whatever the setting', () => {
    expect(night.bg).not.toBe(light.bg);
    expect(night.bg).not.toBe(dark.bg);
    expect(night.accent).not.toBe(dark.accent);
  });

  it('load the headings typeface from this site, never a font service', () => {
    expect(css).toContain("url('/fonts/bricolage-grotesque.woff2')");
    expect(css).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });
});
