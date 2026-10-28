import { describe, expect, it } from 'vitest';

import { SEARCH_MODEL, VECTOR_LENGTH } from './segment';
import {
  MAX_SMART_TITLE,
  parseSmartAlbum,
  smartAlbumFits,
  smartMeta,
  suggestTitle,
} from './smart-album';
import type { SmartAlbum } from './smart-album';

const axis = (n: number) => {
  const out = new Float32Array(VECTOR_LENGTH);
  out[n] = 1;
  return out;
};

const album: SmartAlbum = {
  id: 's1',
  title: 'Beach days',
  text: 'Estrella on the beach last year',
  ignore: ['when'],
  like: null,
  savedAt: '2026-10-28T10:00:00.000Z',
  what: 'beach',
  vector: axis(4),
};

describe('smart album records', () => {
  it('round-trip, with the words’ vector', () => {
    const back = parseSmartAlbum('s1', JSON.parse(JSON.stringify(smartMeta(album))));
    expect({ ...back, vector: null }).toEqual({ ...album, vector: null });
    expect(back?.vector?.[4]).toBeCloseTo(1, 5);
  });

  it('drop a vector another model made, so the album asks to be saved again', () => {
    const older = { ...smartMeta(album), model: SEARCH_MODEL + 1 };
    expect(parseSmartAlbum('s1', older)?.vector).toBeNull();
    expect(parseSmartAlbum('s1', smartMeta({ ...album, vector: null }))?.vector).toBeNull();
  });

  it('refuse anything that isn’t one', () => {
    const meta = smartMeta(album);
    for (const bad of [
      null,
      { ...meta, v: 2 },
      { ...meta, title: 3 },
      { ...meta, ignore: [1] },
      { ...meta, like: 5 },
      { ...meta, savedAt: 'whenever' },
      { ...meta, what: null },
    ]) {
      expect(parseSmartAlbum('s1', bad)).toBeNull();
    }
  });

  it('fit in a record, unless the search is very long', () => {
    expect(smartAlbumFits(album)).toBe(true);
    expect(smartAlbumFits({ ...album, text: '日本語'.repeat(100) })).toBe(false);
  });
});

describe('suggestTitle', () => {
  it('names an album after what the search looked for', () => {
    expect(suggestTitle([{ label: 'Estrella' }, { label: 'Last year' }, { label: 'beach' }])).toBe(
      'Estrella · Last year · beach',
    );
    expect(suggestTitle([{ label: 'dogs' }])).toBe('Dogs');
    expect(suggestTitle([{ label: 'x'.repeat(200) }])).toHaveLength(MAX_SMART_TITLE);
  });
});
