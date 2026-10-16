import { describe, expect, it } from 'vitest';

import {
  FITTED,
  MAX_SCALE,
  clampView,
  containedSize,
  isZoomed,
  panBy,
  wheelFactor,
  zoomAt,
} from './zoom';

describe('wheelFactor', () => {
  it('zooms in when scrolling up and out when scrolling down', () => {
    expect(wheelFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0)).toBeLessThan(1);
    expect(wheelFactor(0, 0)).toBe(1);
  });

  it('treats line and page deltas as larger steps than pixels', () => {
    expect(wheelFactor(-3, 1)).toBeCloseTo(wheelFactor(-48, 0));
    expect(wheelFactor(-1, 2)).toBeCloseTo(wheelFactor(-800, 0));
  });
});

describe('containedSize', () => {
  it('fits a wide image to the box width and a tall one to its height', () => {
    const box = { width: 800, height: 600 };
    expect(containedSize({ width: 1600, height: 900 }, box)).toEqual({ width: 800, height: 450 });
    expect(containedSize({ width: 600, height: 1200 }, box)).toEqual({ width: 300, height: 600 });
  });

  it('falls back to the box before the image has loaded', () => {
    const box = { width: 800, height: 600 };
    expect(containedSize({ width: 0, height: 0 }, box)).toEqual(box);
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor in place', () => {
    const at = { x: 100, y: -50 };
    const view = zoomAt(FITTED, 2, at);
    expect(view.scale).toBe(2);
    // The image point that was under the cursor: (at - offset) / scale.
    expect((at.x - view.x) / view.scale).toBeCloseTo(at.x);
    expect((at.y - view.y) / view.scale).toBeCloseTo(at.y);
  });

  it('stays between fitted and the maximum scale', () => {
    expect(zoomAt(FITTED, 0.5, { x: 0, y: 0 }).scale).toBe(1);
    expect(zoomAt({ scale: 4, x: 0, y: 0 }, 10, { x: 0, y: 0 }).scale).toBe(MAX_SCALE);
  });
});

describe('clampView', () => {
  const box = { width: 800, height: 600 };
  const drawn = { width: 800, height: 450 };

  it('snaps back to fitted at scale 1', () => {
    expect(clampView({ scale: 1, x: 40, y: 40 }, drawn, box)).toEqual(FITTED);
    expect(clampView({ scale: 0.4, x: 0, y: 0 }, drawn, box)).toEqual(FITTED);
  });

  it('stops the image from being dragged away from the edges', () => {
    // At 2x the image is 1600 x 900 in an 800 x 600 box: 400px and 150px of slack.
    const view = clampView(panBy({ scale: 2, x: 0, y: 0 }, 1000, -1000), drawn, box);
    expect(view).toEqual({ scale: 2, x: 400, y: -150 });
  });

  it('keeps an axis centred while the image is smaller than the box on it', () => {
    // At 1.2x the image is 540px tall in a 600px box.
    expect(clampView({ scale: 1.2, x: 0, y: 80 }, drawn, box).y).toBe(0);
  });
});

describe('isZoomed', () => {
  it('is true only above the fitted scale', () => {
    expect(isZoomed(FITTED)).toBe(false);
    expect(isZoomed({ scale: 1.1, x: 0, y: 0 })).toBe(true);
  });
});
