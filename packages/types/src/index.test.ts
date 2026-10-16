import { describe, expect, expectTypeOf, it } from 'vitest';

import { KEY_SIZES, SLOT_COUNT } from './index';
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
