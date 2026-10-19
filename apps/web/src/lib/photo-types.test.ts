import { describe, expect, it } from 'vitest';

import { extensionOf, isPhotoType } from './photo-types';

describe('isPhotoType', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/HEIC', 'image/avif'])(
    'accepts %s',
    (type) => {
      expect(isPhotoType(type)).toBe(true);
    },
  );

  it.each(['image/svg+xml', 'text/html', 'image/', '', 'application/octet-stream'])(
    'refuses %s',
    (type) => {
      expect(isPhotoType(type)).toBe(false);
    },
  );
});

describe('extensionOf', () => {
  it('names each photo format', () => {
    expect(extensionOf('image/jpeg')).toBe('jpg');
    expect(extensionOf('image/png')).toBe('png');
    expect(extensionOf('image/HEIC')).toBe('heic');
  });

  it('never passes on anything else', () => {
    expect(extensionOf('image/svg+xml')).toBe('bin');
    expect(extensionOf('../../x')).toBe('bin');
  });
});
