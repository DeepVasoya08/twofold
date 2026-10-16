import { describe, expect, it } from 'vitest';

import { ready } from './index';

describe('ready', () => {
  it('initialises libsodium', async () => {
    await expect(ready()).resolves.toBeUndefined();
  });
});
