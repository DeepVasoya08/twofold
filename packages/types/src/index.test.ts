import { describe, expect, expectTypeOf, it } from 'vitest';

import { KEY_SIZES, SLOT_COUNT, ThumbBatchParser, readThumbBatch } from './index';
import type { HealthResponse, Keyring } from './index';

describe('HealthResponse', () => {
  it('only allows the "ok" status', () => {
    expectTypeOf<HealthResponse['status']>().toEqualTypeOf<'ok'>();
  });
});

describe('key sizes', () => {
  it('has one verifier per slot', () => {
    expectTypeOf<Keyring['verifiers']>().toEqualTypeOf<Keyring['slots']>();
    expect(SLOT_COUNT).toBe(3);
  });

  it('sizes a slot as nonce + MAC + space key + space id', () => {
    expect(KEY_SIZES.slot).toBe(24 + 16 + 32 + 16);
  });
});

describe('readThumbBatch', () => {
  const entry = (bytes: number[]) => [0, 0, 0, bytes.length, ...bytes];

  it('splits a batch in order, with null for missing thumbnails', () => {
    const batch = new Uint8Array([...entry([1, 2]), ...entry([]), ...entry([3])]);
    expect(readThumbBatch(batch, 3)).toEqual([new Uint8Array([1, 2]), null, new Uint8Array([3])]);
  });

  it('refuses a cut-off, overlong or padded batch', () => {
    expect(readThumbBatch(new Uint8Array([0, 0, 0, 5, 1]), 1)).toBeNull();
    expect(readThumbBatch(new Uint8Array([0, 0]), 1)).toBeNull();
    expect(readThumbBatch(new Uint8Array([...entry([1]), 9]), 1)).toBeNull();
    expect(readThumbBatch(new Uint8Array(entry([1])), 2)).toBeNull();
  });
});

describe('ThumbBatchParser', () => {
  const entry = (bytes: number[]) => [0, 0, 0, bytes.length, ...bytes];

  it('hands over each thumbnail as soon as its bytes are in', () => {
    const batch = [...entry([1, 2, 3]), ...entry([]), ...entry([4])];
    const parser = new ThumbBatchParser(3);
    const seen: (Uint8Array | null)[] = [];
    for (const byte of batch) seen.push(...(parser.push(new Uint8Array([byte])) ?? []));
    expect(seen).toEqual([new Uint8Array([1, 2, 3]), null, new Uint8Array([4])]);
    expect(parser.finished).toBe(true);
  });

  it('is not finished while thumbnails are missing', () => {
    const parser = new ThumbBatchParser(2);
    expect(parser.push(new Uint8Array(entry([1])))).toEqual([new Uint8Array([1])]);
    expect(parser.finished).toBe(false);
  });

  it('refuses extra bytes and lengths larger than any thumbnail', () => {
    const extra = new ThumbBatchParser(1);
    expect(extra.push(new Uint8Array([...entry([1]), 0, 0, 0, 0]))).toBeNull();
    expect(extra.push(new Uint8Array([1]))).toBeNull();
    expect(extra.finished).toBe(false);
    const huge = new ThumbBatchParser(1);
    expect(huge.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toBeNull();
  });
});
