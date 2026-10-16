import { describe, expect, it } from 'vitest';

import { landscapeDataUri, landscapeSvg, paletteNames } from './art';
import { initialAlbums, initialPhotos } from './data';

describe('landscapeSvg', () => {
  it('is deterministic for a seed', () => {
    const options = { seed: 42, palette: 'dusk' as const, width: 1200, height: 800 };
    expect(landscapeSvg(options)).toBe(landscapeSvg(options));
    expect(landscapeSvg({ ...options, seed: 43 })).not.toBe(landscapeSvg(options));
  });

  it('draws every palette as a complete SVG', () => {
    for (const palette of paletteNames) {
      const svg = landscapeSvg({ seed: 1, palette, width: 800, height: 1200 });
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).not.toContain('NaN');
    }
  });

  it('encodes as a data URI the CSP allows', () => {
    expect(landscapeDataUri({ seed: 1, palette: 'dawn', width: 10, height: 10 })).toMatch(
      /^data:image\/svg\+xml;/,
    );
  });
});

describe('mock data', () => {
  it('has unique photo ids and only references known albums', () => {
    const ids = initialPhotos.map((photo) => photo.id);
    expect(new Set(ids).size).toBe(ids.length);
    const albumIds = new Set(initialAlbums.map((album) => album.id));
    for (const photo of initialPhotos) {
      for (const id of photo.albumIds) expect(albumIds.has(id)).toBe(true);
    }
  });
});
