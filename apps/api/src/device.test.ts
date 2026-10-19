import { describe, expect, it } from 'vitest';

import { describeDevice } from './device';

describe('describeDevice', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      { name: 'Chrome on macOS', kind: 'computer' },
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
      { name: 'Safari on iPhone', kind: 'phone' },
    ],
    [
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      { name: 'Chrome on Android', kind: 'phone' },
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Safari/537.36',
      { name: 'Samsung Internet on Android', kind: 'tablet' },
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      { name: 'Edge on Windows', kind: 'computer' },
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
      { name: 'Firefox on Linux', kind: 'computer' },
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
      { name: 'Chrome on iPad', kind: 'tablet' },
    ],
  ])('labels %s', (userAgent, expected) => {
    expect(describeDevice(userAgent)).toEqual(expected);
  });

  it('gives an empty name when nothing is recognised', () => {
    expect(describeDevice(undefined)).toEqual({ name: '', kind: 'computer' });
    expect(describeDevice('curl/8.5.0')).toEqual({ name: '', kind: 'computer' });
  });
});
