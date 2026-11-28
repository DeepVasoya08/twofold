import { describe, expect, it } from 'vitest';

import { summarizeUploads } from '@arcafold/core/upload/progress';
import type { UploadItem } from '@arcafold/core/upload/uploader';

import { firstFailure, uploadHeadline, uploadNote, uploadNoun } from './upload-text';

describe('uploadHeadline', () => {
  it('counts up while photos are on their way', () => {
    expect(uploadHeadline(summarizeUploads(['done', 'uploading', 'waiting']))).toBe(
      'Adding 3 photos… 1 done',
    );
  });

  it('says how it went at the end', () => {
    expect(uploadHeadline(summarizeUploads(['done']))).toBe('1 photo added');
    expect(uploadHeadline(summarizeUploads(['failed', 'failed']))).toBe(
      '2 photos couldn’t be added',
    );
    expect(uploadHeadline(summarizeUploads(['done', 'done', 'failed']))).toBe(
      '2 photos added, 1 couldn’t be',
    );
  });
});

describe('uploadNote', () => {
  it('says the main library’s uploads carry on away from the app', () => {
    expect(uploadNote(false)).toBe(
      'You can leave Arcafold: they keep going, and a notification says when they’re in.',
    );
  });

  it('says the private space’s stop if the app locks first, and promises no notification', () => {
    const note = uploadNote(true);
    expect(note).toContain('If it locks first');
    expect(note).not.toContain('notification');
  });
});

describe('firstFailure', () => {
  const item = (status: UploadItem['status'], error?: string): UploadItem => ({
    id: 1,
    name: 'IMG_1.heic',
    url: '',
    status,
    ...(error === undefined ? {} : { error }),
  });

  it('names the photo and why', () => {
    expect(firstFailure([item('done'), item('failed', 'Storage is full.')])).toBe(
      'IMG_1.heic: Storage is full.',
    );
  });

  it('is null when nothing failed', () => {
    expect(firstFailure([item('done')])).toBeNull();
  });
});

describe('uploadNoun', () => {
  it('says photos, files, or items for some of each', () => {
    expect(uploadNoun([{ name: 'IMG_1.heic' }, { name: 'a.jpg' }])).toBe('photo');
    expect(uploadNoun([{ name: 'Lease.pdf' }])).toBe('file');
    expect(uploadNoun([{ name: 'Lease.pdf' }, { name: 'a.jpg' }])).toBe('item');
  });

  it('words the headline to match', () => {
    expect(uploadHeadline(summarizeUploads(['done', 'done']), 'file')).toBe('2 files added');
    expect(uploadHeadline(summarizeUploads(['done']), 'item')).toBe('1 item added');
  });
});
