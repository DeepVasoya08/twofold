/**
 * HEIC and HEIF photos (what iPhones take) for browsers that can't decode them, which is all
 * of them but Safari. libheif, compiled to WebAssembly, turns the photo into pixels in memory;
 * nothing is written anywhere. Its 1.4 MB of WebAssembly is fetched the first time a HEIC
 * photo needs it, never before.
 */

/** Brands that mark a file as HEVC-coded HEIF. AVIF shares "mif1", so that one isn't enough. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs']);

/**
 * The largest photo decoded, in pixels: 50 megapixels covers every phone camera (48 MP iPhone
 * "HEIF Max") while keeping the decoded pixels, 4 bytes each, to 200 MB.
 */
export const HEIF_MAX_PIXELS = 50_000_000;

/** Whether the bytes are a HEIC/HEIF photo, by the brands in its "ftyp" box. */
export function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (brandAt(bytes, 4) !== 'ftyp') return false;
  const size = Math.min(view.getUint32(0), bytes.length);
  if (HEIF_BRANDS.has(brandAt(bytes, 8))) return true;
  // After the major brand and its version come the compatible brands.
  for (let at = 16; at + 4 <= size; at += 4) {
    if (HEIF_BRANDS.has(brandAt(bytes, at))) return true;
  }
  return false;
}

function brandAt(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + 4));
}

/** Decoded RGBA pixels, ready for an ImageData. */
export interface Pixels {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/** The parts of libheif's JavaScript API used here. */
export interface HeifImage {
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  display(target: Pixels, done: (result: Pixels | null) => void): void;
  free(): void;
}

export interface LibHeif {
  HeifDecoder: new () => { decoder: number | null; decode(bytes: Uint8Array): HeifImage[] };
  heif_context_free(context: number): void;
}

let libheif: Promise<LibHeif> | null = null;

/** Loads libheif once; a failed load is tried again next time. */
function loadLibHeif(): Promise<LibHeif> {
  libheif ??= Promise.all([
    import('libheif-js/libheif-wasm/libheif.js'),
    import('libheif-js/libheif-wasm/libheif.wasm?url'),
  ])
    .then(
      ([{ default: factory }, { default: wasmUrl }]) =>
        new Promise<LibHeif>((resolve, reject) => {
          const made = factory({
            locateFile: () => wasmUrl,
            // This can run before `factory` returns, so `made` is read a moment later.
            onRuntimeInitialized: () => {
              queueMicrotask(() => {
                resolve(made);
              });
            },
            onAbort: (reason: unknown) => {
              reject(new Error(`libheif failed to start: ${String(reason)}`));
            },
          }) as LibHeif;
        }),
    )
    .catch((error: unknown) => {
      libheif = null;
      throw error;
    });
  return libheif;
}

/**
 * Decodes the main picture of a HEIC/HEIF photo, turned the way it should be shown. Null when
 * it can't be read or is too big to decode safely.
 */
export async function decodeHeif(
  bytes: Uint8Array,
  load: () => Promise<LibHeif> = loadLibHeif,
): Promise<Pixels | null> {
  const lib = await load();
  const decoder = new lib.HeifDecoder();
  try {
    const images = decoder.decode(bytes);
    try {
      const image = images.find((candidate) => candidate.is_primary()) ?? images[0];
      if (!image) return null;
      const width = image.get_width();
      const height = image.get_height();
      if (width <= 0 || height <= 0 || width * height > HEIF_MAX_PIXELS) return null;
      const target: Pixels = { data: new Uint8ClampedArray(width * height * 4), width, height };
      return await new Promise<Pixels | null>((resolve) => {
        image.display(target, resolve);
      });
    } finally {
      for (const image of images) image.free();
    }
  } finally {
    if (decoder.decoder) lib.heif_context_free(decoder.decoder);
  }
}
