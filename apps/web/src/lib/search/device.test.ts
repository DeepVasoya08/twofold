import { describe, expect, it } from 'vitest';

import { connection, isPhone } from './device';

const android = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/155 Mobile Safari';
const firefoxPhone = 'Mozilla/5.0 (Android 17; Mobile; rv:158.0) Gecko/158.0 Firefox/158.0';
const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:159.0) Gecko/20100101 Firefox/159.0';

describe('isPhone', () => {
  it('trusts the browser when it says, and the user agent otherwise', () => {
    expect(isPhone({ userAgent: windows, userAgentData: { mobile: true } })).toBe(true);
    expect(isPhone({ userAgent: android, userAgentData: { mobile: false } })).toBe(false);
    expect(isPhone({ userAgent: android })).toBe(true);
    expect(isPhone({ userAgent: firefoxPhone })).toBe(true);
    expect(isPhone({ userAgent: windows })).toBe(false);
  });
});

describe('connection', () => {
  it('reads Wi-Fi, phone networks and data saver, and is unknown otherwise', () => {
    expect(connection({ userAgent: android, connection: { type: 'wifi' } })).toBe('wifi');
    expect(connection({ userAgent: android, connection: { type: 'ethernet' } })).toBe('wifi');
    expect(connection({ userAgent: android, connection: { type: 'cellular' } })).toBe('metered');
    expect(connection({ userAgent: android, connection: { type: 'wifi', saveData: true } })).toBe(
      'metered',
    );
    expect(connection({ userAgent: android, connection: {} })).toBe('unknown');
    expect(connection({ userAgent: firefoxPhone })).toBe('unknown');
  });
});
