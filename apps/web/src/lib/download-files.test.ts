import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadFiles } from './download-files';

const files = [new File([new Uint8Array([1, 2])], 'twofold-1.png', { type: 'image/png' })];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
