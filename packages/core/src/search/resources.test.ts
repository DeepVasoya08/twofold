import { describe, expect, it } from 'vitest';

import { CHUNK_BYTES, SEARCH_RESOURCES, chunkNames, sha256Hex } from './resources';

describe('chunkNames', () => {
  it('names each chunk of a resource, in order', () => {
    expect(chunkNames(SEARCH_RESOURCES.text)).toEqual([
      'text-a5136c3569a8.0.bin',
      'text-a5136c3569a8.1.bin',
      'text-a5136c3569a8.2.bin',
    ]);
    expect(chunkNames(SEARCH_RESOURCES.words)).toHaveLength(1);
    expect(chunkNames({ name: 'x', size: CHUNK_BYTES, sha256: '' })).toEqual(['x.0.bin']);
  });
});

describe('sha256Hex', () => {
  it('turns a pinned digest into the hex a phone reports', () => {
    // The photo half's digest, as the phone spike pinned it in hex.
    expect(sha256Hex(SEARCH_RESOURCES.photo.sha256)).toBe(
      'eea088f1c6f18bd3e8dfffa1471a0713e972760341e048cfcec1b4f81f713c71',
    );
  });
});
