import { afterEach, describe, expect, it, vi } from 'vitest';

import { canShareFiles, downloadFiles, shareFiles } from './share-files';

const files = [new File([new Uint8Array([1, 2])], 'twofold-1.png', { type: 'image/png' })];

const fakeNavigator = (overrides: Partial<Navigator>) => overrides as Navigator;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('canShareFiles', () => {
  it('needs a share sheet that takes files', () => {
    expect(canShareFiles(files, fakeNavigator({}))).toBe(false);
    const share = () => Promise.resolve();
    expect(canShareFiles(files, fakeNavigator({ share, canShare: () => false }))).toBe(false);
    expect(canShareFiles(files, fakeNavigator({ share, canShare: () => true }))).toBe(true);
    const throws = () => {
      throw new TypeError('no');
    };
    expect(canShareFiles(files, fakeNavigator({ share, canShare: throws }))).toBe(false);
  });
});

describe('shareFiles', () => {
  it('shares the files, and treats closing the sheet as not shared', async () => {
    const share = vi.fn(() => Promise.resolve());
    expect(await shareFiles(files, fakeNavigator({ share }))).toBe(true);
    expect(share).toHaveBeenCalledWith({ files });
    const cancel = () => Promise.reject(new DOMException('closed', 'AbortError'));
    expect(await shareFiles(files, fakeNavigator({ share: cancel }))).toBe(false);
    const broken = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    await expect(shareFiles(files, fakeNavigator({ share: broken }))).rejects.toThrow('blocked');
  });
});

describe('downloadFiles', () => {
  it('clicks a temporary link per file and revokes it afterwards', () => {
    vi.useFakeTimers();
    const clicked: { href: string; download: string }[] = [];
    const link = {
      href: '',
      download: '',
      rel: '',
      click() {
        clicked.push({ href: this.href, download: this.download });
      },
      remove: vi.fn(),
    };
    const doc = {
      createElement: () => link,
      body: { append: vi.fn() },
    } as unknown as Document;
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:copy');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    downloadFiles(files, doc);
    expect(create).toHaveBeenCalledWith(files[0]);
    expect(clicked).toEqual([{ href: 'blob:copy', download: 'twofold-1.png' }]);
    expect(link.remove).toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:copy');
  });
});
