import { describe, expect, it } from 'vitest';

import { centerSquare } from './profile-image';

describe('centerSquare', () => {
  it('crops the middle of a wide, a tall and a square image', () => {
    expect(centerSquare(400, 300)).toEqual({ x: 50, y: 0, side: 300 });
    expect(centerSquare(300, 401)).toEqual({ x: 0, y: 50, side: 300 });
    expect(centerSquare(256, 256)).toEqual({ x: 0, y: 0, side: 256 });
  });
});
