import { describe, expect, it } from 'vitest';

import { addressBlock } from './proof';

describe('addressBlock', () => {
  it('keeps an IPv4 address as it is', () => {
    expect(addressBlock('203.0.113.9')).toBe('203.0.113.9');
  });

  it('cuts an IPv6 address to its first 64 bits, however it is written', () => {
    const block = '2001:db8:1:2::/64';
    expect(addressBlock('2001:db8:1:2::1')).toBe(block);
    expect(addressBlock('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe(block);
    expect(addressBlock('2001:0DB8:0001:0002:0000:0000:0000:0001')).toBe(block);
    expect(addressBlock('2001:db8:1:2:abcd::')).toBe(block);
    expect(addressBlock('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(addressBlock('::1')).toBe('0:0:0:0::/64');
  });

  it('tells IPv6 blocks apart', () => {
    expect(addressBlock('2001:db8:1:3::1')).not.toBe(addressBlock('2001:db8:1:2::1'));
  });

  it('reads an IPv4 address written as IPv6 as that IPv4 address', () => {
    expect(addressBlock('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(addressBlock('::ffff:c000:201')).toBe('192.0.2.1');
  });

  it('leaves anything that isn’t an address as it is', () => {
    expect(addressBlock('')).toBe('');
    expect(addressBlock('not:an:address')).toBe('not:an:address');
    expect(addressBlock('1::2::3')).toBe('1::2::3');
    expect(addressBlock('::1]@example.com/[::2')).toBe('::1]@example.com/[::2');
  });
});
