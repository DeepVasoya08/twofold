import { describe, expect, it } from 'vitest';

import {
  HISTORY_FILE,
  KEEP_DAYS,
  filesToKeep,
  isAssetPath,
  keepOldAssets,
  parseHistory,
} from './asset-history';
import type { AssetHistory } from './asset-history';

const NOW = new Date('2026-11-04T06:00:00.000Z');
const IN_A_WEEK = new Date(NOW.getTime() + KEEP_DAYS * 86_400_000).toISOString();

function history(files: Record<string, string | null>): AssetHistory {
  return { version: 1, files };
}

describe('isAssetPath', () => {
  it('accepts built files and refuses anything that could leave assets/', () => {
    expect(isAssetPath('assets/encoder-worker-B8EdVaDH.js')).toBe(true);
    expect(isAssetPath('assets/../app.html')).toBe(false);
    expect(isAssetPath('assets/..')).toBe(false);
    expect(isAssetPath('assets/.hidden')).toBe(false);
    expect(isAssetPath('assets/nested/file.js')).toBe(false);
    expect(isAssetPath('app.html')).toBe(false);
    expect(isAssetPath('/assets/x.js')).toBe(false);
  });
});

describe('parseHistory', () => {
  it('keeps valid entries and drops the rest', () => {
    expect(
      parseHistory({
        version: 1,
        files: {
          'assets/a.js': null,
          'assets/b.js': '2026-11-10T00:00:00.000Z',
          'assets/c.js': 'not a date',
          'assets/d.js': 5,
          '../secret': null,
        },
      }),
    ).toEqual(history({ 'assets/a.js': null, 'assets/b.js': '2026-11-10T00:00:00.000Z' }));
  });

  it('reads anything unexpected as no history', () => {
    expect(parseHistory(null)).toBeNull();
    expect(parseHistory('x')).toBeNull();
    expect(parseHistory({ version: 2, files: {} })).toBeNull();
    expect(parseHistory({ version: 1 })).toBeNull();
  });
});

describe('filesToKeep', () => {
  it('keeps the last build’s files for a week and earlier ones until their date', () => {
    const keep = filesToKeep(
      history({
        'assets/old-build.js': null,
        'assets/still-built.js': null,
        'assets/kept.js': '2026-11-08T00:00:00.000Z',
        'assets/expired.js': '2026-11-04T05:59:59.000Z',
      }),
      ['assets/still-built.js', 'assets/new.js'],
      NOW,
    );
    expect(Object.fromEntries(keep)).toEqual({
      'assets/old-build.js': IN_A_WEEK,
      'assets/kept.js': '2026-11-08T00:00:00.000Z',
    });
  });

  it('keeps nothing without a history', () => {
    expect(filesToKeep(null, ['assets/a.js'], NOW).size).toBe(0);
  });
});

describe('keepOldAssets', () => {
  function liveSite(files: Record<string, string>) {
    const written = new Map<string, string>();
    const warnings: string[] = [];
    const encoder = new TextEncoder();
    return {
      written,
      warnings,
      io: {
        fetchLive: (path: string) => {
          const body = files[path];
          return Promise.resolve(body === undefined ? null : encoder.encode(body));
        },
        writeBuilt: (path: string, bytes: Uint8Array) => {
          written.set(path, new TextDecoder().decode(bytes));
          return Promise.resolve();
        },
        warn: (message: string) => {
          warnings.push(message);
        },
      },
    };
  }

  it('copies files old tabs still need into the build and lists them', async () => {
    const site = liveSite({
      [HISTORY_FILE]: JSON.stringify(
        history({
          'assets/encoder-worker-B8EdVaDH.js': null,
          'assets/index-A.js': null,
          'assets/gone.js': '2026-11-09T00:00:00.000Z',
        }),
      ),
      'assets/encoder-worker-B8EdVaDH.js': 'old worker',
      'assets/index-A.js': 'old entry',
    });

    const result = await keepOldAssets(
      ['assets/encoder-worker-CbxX7lY2.js', 'assets/index-B.js'],
      site.io,
      NOW,
    );

    expect(result.files).toEqual({
      'assets/encoder-worker-B8EdVaDH.js': IN_A_WEEK,
      'assets/encoder-worker-CbxX7lY2.js': null,
      'assets/index-A.js': IN_A_WEEK,
      'assets/index-B.js': null,
    });
    expect(site.written.get('assets/encoder-worker-B8EdVaDH.js')).toBe('old worker');
    expect(site.written.get('assets/index-A.js')).toBe('old entry');
    expect(JSON.parse(site.written.get(HISTORY_FILE) ?? '')).toEqual(result);
    expect(site.warnings).toEqual([
      'assets/gone.js is no longer on the live site; not keeping it.',
    ]);
  });

  it('starts a history when the live site has none', async () => {
    const site = liveSite({});
    const result = await keepOldAssets(['assets/a.js'], site.io, NOW);
    expect(result).toEqual(history({ 'assets/a.js': null }));
    expect(site.written.has(HISTORY_FILE)).toBe(true);
    expect(site.warnings).toHaveLength(1);
  });

  it('treats a broken history as none', async () => {
    const site = liveSite({ [HISTORY_FILE]: '{not json', 'assets/x.js': 'x' });
    const result = await keepOldAssets(['assets/a.js'], site.io, NOW);
    expect(result).toEqual(history({ 'assets/a.js': null }));
  });
});
