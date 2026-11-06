import { describe, expect, it } from 'vitest';

import { decodeSecret, encodeSecret } from './biometric-secret';

const secret = {
  wrapKey: new Uint8Array(32).fill(7),
  loginKey: new Uint8Array(32).fill(9),
};

describe('the kept secret', () => {
  it('comes back as it went in', () => {
    const back = decodeSecret(encodeSecret(secret));
    expect(back && Array.from(back.wrapKey)).toEqual(Array.from(secret.wrapKey));
    expect(back && Array.from(back.loginKey)).toEqual(Array.from(secret.loginKey));
  });

  it('is dropped when it’s missing, damaged or the wrong size', () => {
    expect(decodeSecret(null)).toBeNull();
    expect(decodeSecret('not json')).toBeNull();
    expect(decodeSecret('{"v":2,"wrapKey":"","loginKey":""}')).toBeNull();
    const short = encodeSecret({ ...secret, wrapKey: new Uint8Array(16) });
    expect(decodeSecret(short)).toBeNull();
    expect(decodeSecret('{"v":1,"wrapKey":"$$$","loginKey":"$$$"}')).toBeNull();
  });
});
