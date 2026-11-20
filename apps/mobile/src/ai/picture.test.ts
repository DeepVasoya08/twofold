import { describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  put: vi.fn(() => 'memory:1'),
  release: vi.fn(),
  sizeAsync: vi.fn(() => Promise.resolve({ width: 640, height: 480 })),
  drawAsync: vi.fn((_id: string, size: number) =>
    Promise.resolve(new ArrayBuffer(size * size * 4)),
  ),
}));
vi.mock('../../modules/memory-image', () => ({ MemoryImages: native }));

const { withPicture } = await import('./picture');

describe('withPicture', () => {
  it('hands the preview to native memory, wipes this copy, and releases it after', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const drawn = await withPicture(bytes, async (picture) => {
      expect([picture.width, picture.height]).toEqual([640, 480]);
      return (await picture.draw(2, [1, 0, 0, 1, 0, 0], true)).length;
    });
    expect(drawn).toBe(16);
    expect(native.put).toHaveBeenCalledWith(bytes);
    expect([...bytes]).toEqual([0, 0, 0]);
    expect(native.drawAsync).toHaveBeenCalledWith('memory:1', 2, [1, 0, 0, 1, 0, 0], true);
    expect(native.release).toHaveBeenCalledWith('memory:1');
  });

  it('gives null for bytes that aren’t a picture, and still releases them', async () => {
    native.sizeAsync.mockImplementationOnce(() => Promise.reject(new Error('bad')));
    native.release.mockClear();
    const look = vi.fn();
    expect(await withPicture(new Uint8Array([9]), look)).toBeNull();
    expect(look).not.toHaveBeenCalled();
    expect(native.release).toHaveBeenCalled();
  });

  it('gives null when drawing fails, so that photo is passed over', async () => {
    native.drawAsync.mockImplementationOnce(() => Promise.reject(new Error('bad')));
    expect(
      await withPicture(new Uint8Array([9]), async (picture) =>
        picture.draw(4, [1, 0, 0, 1, 0, 0]),
      ),
    ).toBeNull();
  });
});
