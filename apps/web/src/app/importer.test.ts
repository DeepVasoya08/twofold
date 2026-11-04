import { describe, expect, it, vi } from 'vitest';

import type { ImportItem } from '../lib/import/takeout';
import { Importer, SHOW_EVERY } from './importer';
import type { ImportJob, ImporterDeps } from './importer';
import type { Album, Photo } from '@arcafold/core/library/model';
import { FormError } from '@arcafold/core/errors';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A photo in an export whose bytes are its name, so equal names are the same photo. */
const album = (id: string): Album => ({ id, title: id });

function job(name: string, albumIds: string[] = [], size = 1000): ImportJob {
  const item: ImportItem = {
    name,
    size,
    type: 'image/jpeg',
    year: 2019,
    albums: [],
    source: {
      path: name,
      size,
      read: () => Promise.resolve(new TextEncoder().encode(name.replace(/^copy of /, ''))),
    },
  };
  return { item, albums: albumIds.map(album) };
}

const stored = (id: string): Photo => ({
  id,
  src: '',
  width: 1,
  height: 1,
  takenAt: '2019-01-01T00:00:00.000Z',
  addedBy: 'me',
  favorite: false,
  albumIds: [],
});

function setup(overrides: Partial<ImporterDeps> = {}, known = new Map<string, string>()) {
  const uploaded: { name: string; albumIds: string[] }[] = [];
  const shown: Photo[][] = [];
  const addToAlbums = vi.fn(() => Promise.resolve());
  const importer = new Importer({
    fingerprint: (original) => Promise.resolve(`fp:${new TextDecoder().decode(original)}`),
    known: () => known,
    prepare: (item, original) =>
      Promise.resolve({
        thumb: new Uint8Array(1),
        full: original,
        type: item.type,
        width: 1,
        height: 1,
        takenAt: item.name,
      }),
    upload: (photo, albumIds) => {
      uploaded.push({ name: photo.takenAt, albumIds });
      return Promise.resolve(stored(`id-${photo.takenAt}`));
    },
    addToAlbums,
    onStored: (photos) => {
      shown.push(photos);
    },
    ...overrides,
  });
  return { importer, uploaded, shown, addToAlbums };
}

async function finish(importer: Importer): Promise<void> {
  for (let tries = 0; tries < 50 && importer.running; tries++) await settle();
}

describe('Importer', () => {
  it('imports every photo into its albums and shows them at the end', async () => {
    const { importer, uploaded, shown } = setup();
    const onDone = vi.fn();
    importer.start(
      [job('a.jpg', ['trip']), job('b.jpg'), job('c.jpg', ['trip', 'family'])],
      onDone,
    );
    expect(importer.getState()).toMatchObject({ phase: 'running', total: 3 });
    await finish(importer);
    expect(uploaded).toEqual([
      { name: 'a.jpg', albumIds: ['trip'] },
      { name: 'b.jpg', albumIds: [] },
      { name: 'c.jpg', albumIds: ['trip', 'family'] },
    ]);
    expect(shown.map((batch) => batch.map((photo) => photo.id))).toEqual([
      ['id-a.jpg', 'id-b.jpg', 'id-c.jpg'],
    ]);
    expect(importer.getState()).toMatchObject({ phase: 'done', imported: 3, already: 0 });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('skips photos the space already has, adding them to the albums', async () => {
    const known = new Map([['fp:a.jpg', 'existing-a']]);
    const { importer, uploaded, addToAlbums } = setup({}, known);
    importer.start([job('a.jpg', ['trip']), job('b.jpg'), job('copy of b.jpg')]);
    await finish(importer);
    expect(uploaded.map((photo) => photo.name)).toEqual(['b.jpg']);
    expect(addToAlbums).toHaveBeenCalledWith('existing-a', [album('trip')]);
    expect(importer.getState()).toMatchObject({ imported: 1, already: 2 });
  });

  it('shows photos in batches as it goes', async () => {
    const { importer, shown } = setup();
    importer.start(
      Array.from({ length: SHOW_EVERY + 5 }, (_, index) => job(`${String(index)}.jpg`)),
    );
    await finish(importer);
    expect(shown.map((batch) => batch.length)).toEqual([SHOW_EVERY, 5]);
  });

  it('lists photos it couldn’t import and carries on', async () => {
    const { importer } = setup({
      prepare: (item) => Promise.reject(new FormError(`Arcafold can’t read ${item.name}.`)),
    });
    importer.start([job('broken.jpg'), job('also.jpg')]);
    await finish(importer);
    expect(importer.getState()).toMatchObject({
      phase: 'done',
      imported: 0,
      failures: [
        { name: 'broken.jpg', error: 'Arcafold can’t read broken.jpg.' },
        { name: 'also.jpg', error: 'Arcafold can’t read also.jpg.' },
      ],
    });
  });

  it('stops taking new photos when stopped', async () => {
    let release: () => void = () => undefined;
    const { importer, uploaded } = setup({
      upload: (photo) =>
        new Promise((resolve) => {
          uploaded.push({ name: photo.takenAt, albumIds: [] });
          release = () => {
            resolve(stored(photo.takenAt));
          };
        }),
    });
    importer.start([job('a.jpg', [], 40_000_000), job('b.jpg', [], 40_000_000)]);
    await settle();
    importer.stop();
    release();
    await finish(importer);
    expect(uploaded.map((photo) => photo.name)).toEqual(['a.jpg']);
    expect(importer.getState()).toMatchObject({ phase: 'done', imported: 1, stopped: true });
  });

  it('drops everything when the vault locks', async () => {
    const { importer, shown } = setup();
    const onDone = vi.fn();
    importer.start([job('a.jpg')], onDone);
    importer.dispose();
    await settle();
    await settle();
    expect(importer.getState().phase).toBe('idle');
    expect(shown).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();
  });
});
