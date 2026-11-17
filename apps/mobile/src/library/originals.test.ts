import { describe, expect, it, vi } from 'vitest';

import type { NewPhoto } from '@arcafold/core/library/space-store';

import { Originals, deletedText, originalsText } from './originals';

const photo = (): NewPhoto => ({}) as NewPhoto;

describe('Originals', () => {
  it('counts a photo only once it is stored', () => {
    const originals = new Originals();
    const first = photo();
    originals.prepared(first, 'content://a');
    expect(originals.getCount()).toBe(0);
    originals.storedPhoto(first);
    expect(originals.getCount()).toBe(1);
  });

  it('never offers a photo that was prepared but not stored', () => {
    const originals = new Originals();
    const failed = photo();
    const stored = photo();
    originals.prepared(failed, 'content://failed');
    originals.prepared(stored, 'content://stored');
    originals.storedPhoto(stored);
    expect(originals.take()).toEqual(['content://stored']);
  });

  it('ignores a stored photo it never saw prepared', () => {
    const originals = new Originals();
    originals.storedPhoto(photo());
    expect(originals.getCount()).toBe(0);
  });

  it('lists the same gallery photo once', () => {
    const originals = new Originals();
    const first = photo();
    const again = photo();
    originals.prepared(first, 'content://a');
    originals.prepared(again, 'content://a');
    originals.storedPhoto(first);
    originals.storedPhoto(again);
    expect(originals.getCount()).toBe(1);
  });

  it('forgets what it handed over, and tells listeners', () => {
    const originals = new Originals();
    const listener = vi.fn();
    originals.subscribe(listener);
    const first = photo();
    originals.prepared(first, 'content://a');
    originals.storedPhoto(first);
    expect(originals.take()).toEqual(['content://a']);
    expect(originals.getCount()).toBe(0);
    expect(originals.take()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('Originals.giveBack', () => {
  it('puts photos back to wait once, without doubling any', () => {
    const originals = new Originals();
    const first = photo();
    originals.prepared(first, 'content://a');
    originals.storedPhoto(first);
    const taken = originals.take();
    originals.giveBack(taken);
    originals.giveBack(taken);
    expect(originals.take()).toEqual(['content://a']);
  });
});

describe('originalsText', () => {
  it('reads for one photo and for several', () => {
    expect(originalsText(1)).toContain('This photo is now in your private space');
    expect(originalsText(3)).toContain('These 3 photos are now in your private space');
  });
});

describe('deletedText', () => {
  it('says nothing when all were deleted', () => {
    expect(deletedText({ deleted: 2, kept: 0 })).toBeNull();
  });

  it('says when none were deleted', () => {
    expect(deletedText({ deleted: 0, kept: 2 })).toBe('Nothing was deleted from the gallery.');
  });

  it('says how many are left when some couldn’t be', () => {
    expect(deletedText({ deleted: 2, kept: 1 })).toBe(
      '2 photos deleted from the gallery. 1 couldn’t be, so delete it in your gallery app.',
    );
  });
});
