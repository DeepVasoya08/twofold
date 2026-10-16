import { describe, expect, it } from 'vitest';

import { isPhotoType } from './photo-types';

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
