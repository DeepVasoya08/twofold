import { describe, expect, expectTypeOf, it } from 'vitest';

import { KEY_SIZES, SLOT_COUNT, readThumbBatch } from './index';
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
