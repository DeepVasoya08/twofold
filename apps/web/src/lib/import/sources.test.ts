import { describe, expect, it } from 'vitest';

import { buildZip, zipEntry } from '../zip';
import { ZipError } from '../zip-reader';
import { collectSources } from './sources';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('collectSources', () => {
  it('opens zips and takes loose files, keeping only photos, videos, JSON and CSV', async () => {
    const zip = buildZip([
      zipEntry('Takeout/Google Photos/Photos from 2019/IMG_1.jpg', bytes('photo one'), new Date()),
      zipEntry('Takeout/Google Photos/Photos from 2019/IMG_1.jpg.json', bytes('{}'), new Date()),
      zipEntry('Takeout/archive_browser.html', bytes('<html>'), new Date()),
      zipEntry('Photos/Photo Details.csv', bytes('imgName'), new Date()),
    ]);
    const loose = new File([bytes('photo two')], 'IMG_2.png', { lastModified: 1_600_000_000_000 });
    const sources = await collectSources([
      new File([zip], 'takeout-001.zip'),
      loose,
      new File([bytes('notes')], 'notes.txt'),
    ]);
    expect(sources.map(({ path, size }) => [path, size])).toEqual([
      ['Takeout/Google Photos/Photos from 2019/IMG_1.jpg', 9],
      ['Takeout/Google Photos/Photos from 2019/IMG_1.jpg.json', 2],
      ['Photos/Photo Details.csv', 7],
      ['IMG_2.png', 9],
    ]);
    expect(await sources[0]?.read()).toEqual(bytes('photo one'));
    expect(await sources[3]?.read()).toEqual(bytes('photo two'));
    expect(sources[3]?.lastModified).toBe(1_600_000_000_000);
  });

  it('names the zip it couldn’t read', async () => {
    await expect(
      collectSources([new File([bytes('not a zip')], 'takeout-002.zip')]),
    ).rejects.toThrow(new ZipError('takeout-002.zip: This isn’t a zip file Twofold can read.'));
  });
});
