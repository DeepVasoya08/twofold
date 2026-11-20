import { describe, expect, it, vi } from 'vitest';

import { FACE_RESOURCES } from '@arcafold/core/people/resources';
import { SEARCH_RESOURCES } from '@arcafold/core/search/resources';

vi.mock('expo-file-system', () => ({ Directory: vi.fn(), File: vi.fn(), Paths: {} }));

const { faceDownload, searchDownload } = await import('./resources');

describe('downloads', () => {
  it('fetches search resources in chunks, and face models whole, from Arcafold', () => {
    const photo = searchDownload(SEARCH_RESOURCES.photo);
    expect(photo.urls).toHaveLength(4);
    expect(photo.urls[0]).toBe(
      `https://arcafold.com/resources/search/${SEARCH_RESOURCES.photo.name}.0.bin`,
    );
    expect(photo.size).toBe(SEARCH_RESOURCES.photo.size);
    const detector = faceDownload(FACE_RESOURCES.detector);
    expect(detector).toEqual({
      name: 'yunet-2023mar.onnx',
      size: FACE_RESOURCES.detector.size,
      sha256: FACE_RESOURCES.detector.sha256,
      urls: ['https://arcafold.com/resources/faces/yunet-2023mar.onnx'],
    });
  });
});
