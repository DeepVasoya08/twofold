import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { HEIF_MAX_PIXELS, decodeHeif, isHeif } from './heif';
import type { HeifImage, LibHeif, Pixels } from './heif';
import { exifTakenAt } from '@arcafold/core/photo-date';

// A 96×64 HEIC made with libheif: left half red, right half blue, taken 9 March 2018 08:15
// at UTC−5 (fixtures are shared with the browser tests).
const SAMPLE = new Uint8Array(
  readFileSync(join(import.meta.dirname, '../../e2e/fixtures/sample.heic')),
);

/** The real libheif, given its WebAssembly directly as Node can't fetch it. */
function realLibHeif(): Promise<LibHeif> {
  const require = createRequire(import.meta.url);
  const factory = require('libheif-js/libheif-wasm/libheif.js') as (options: object) => LibHeif;
  const wasmBinary = readFileSync(require.resolve('libheif-js/libheif-wasm/libheif.wasm'));
  return Promise.resolve(factory({ wasmBinary }));
}

function ftyp(major: string, ...compatible: string[]): Uint8Array {
  const brands = [major, '\0\0\0\0', ...compatible].join('');
  const size = 8 + brands.length;
  return new Uint8Array([0, 0, 0, size, ...new TextEncoder().encode(`ftyp${brands}`)]);
}

describe('isHeif', () => {
  it('knows HEIC by its brands', () => {
    expect(isHeif(SAMPLE)).toBe(true);
    expect(isHeif(ftyp('heic', 'mif1', 'heic'))).toBe(true);
    expect(isHeif(ftyp('mif1', 'heic'))).toBe(true);
    expect(isHeif(ftyp('heix'))).toBe(true);
  });

  it('leaves AVIF, video and other files alone', () => {
    expect(isHeif(ftyp('avif', 'mif1', 'miaf'))).toBe(false);
    expect(isHeif(ftyp('mif1', 'avif'))).toBe(false);
    expect(isHeif(ftyp('isom', 'mp41'))).toBe(false);
    expect(isHeif(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array<number>(12).fill(0)]))).toBe(
      false,
    );
    expect(isHeif(new Uint8Array(3))).toBe(false);
  });
});

describe('decodeHeif', () => {
  it('decodes a real HEIC photo to RGBA pixels', async () => {
    const pixels = await decodeHeif(SAMPLE, realLibHeif);
    expect(pixels).not.toBeNull();
    if (!pixels) return;
    expect([pixels.width, pixels.height]).toEqual([96, 64]);
    const at = (x: number, y: number) => [
      ...pixels.data.subarray((y * 96 + x) * 4, (y * 96 + x) * 4 + 4),
    ];
    const [red, , blue] = at(10, 30);
    expect(red).toBeGreaterThan(180);
    expect(blue).toBeLessThan(80);
    const [red2, , blue2] = at(85, 30);
    expect(red2).toBeLessThan(80);
    expect(blue2).toBeGreaterThan(160);
  });

  it('reads the date a real HEIC photo was taken', () => {
    expect(exifTakenAt(SAMPLE)).toBe(Date.UTC(2018, 2, 9, 13, 15, 0));
  });

  it('gives up on files libheif cannot read', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await decodeHeif(SAMPLE.slice(0, 200), realLibHeif)).toBeNull();
    expect(await decodeHeif(ftyp('heic', 'mif1'), realLibHeif)).toBeNull();
    vi.restoreAllMocks();
  });

  function fakeImage(width: number, height: number, primary: boolean) {
    const free = vi.fn();
    const image: HeifImage = {
      get_width: () => width,
      get_height: () => height,
      is_primary: () => primary,
      display: (target: Pixels, done: (result: Pixels | null) => void) => {
        target.data.fill(7);
        done(target);
      },
      free,
    };
    return { image, free };
  }

  function fakeLib(images: HeifImage[]) {
    const freed = vi.fn();
    const lib: LibHeif = {
      HeifDecoder: class {
        decoder: number | null = 42;
        decode = () => images;
      },
      heif_context_free: freed,
    };
    return { load: () => Promise.resolve(lib), freed };
  }

  it('decodes the primary picture and frees everything', async () => {
    const thumb = fakeImage(4, 3, false);
    const main = fakeImage(8, 6, true);
    const { load, freed } = fakeLib([thumb.image, main.image]);
    const pixels = await decodeHeif(SAMPLE, load);
    expect([pixels?.width, pixels?.height]).toEqual([8, 6]);
    expect(thumb.free).toHaveBeenCalled();
    expect(main.free).toHaveBeenCalled();
    expect(freed).toHaveBeenCalledWith(42);
  });

  it('refuses pictures too big to decode safely', async () => {
    const huge = fakeImage(10_000, Math.ceil(HEIF_MAX_PIXELS / 10_000) + 1, true);
    const { load, freed } = fakeLib([huge.image]);
    expect(await decodeHeif(SAMPLE, load)).toBeNull();
    expect(huge.free).toHaveBeenCalled();
    expect(freed).toHaveBeenCalled();
  });

  it('returns null when there is no picture', async () => {
    const { load } = fakeLib([]);
    expect(await decodeHeif(SAMPLE, load)).toBeNull();
  });
});
