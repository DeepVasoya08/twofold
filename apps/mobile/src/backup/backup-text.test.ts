import { describe, expect, it, vi } from 'vitest';

vi.mock('./use-backup', () => ({}));

const { backupStatusText } = await import('./backup-text');

describe('backupStatusText', () => {
  it('says what happened', () => {
    expect(backupStatusText({ kind: 'idle' })).toBeNull();
    expect(backupStatusText({ kind: 'running', done: 0 })).toBe('Looking for new photos…');
    expect(backupStatusText({ kind: 'running', done: 1 })).toBe('Backing up… 1 photo done');
    expect(backupStatusText({ kind: 'done', added: 0, skipped: 0 })).toBe(
      'Nothing new to back up.',
    );
    expect(backupStatusText({ kind: 'done', added: 3, skipped: 0 })).toBe('Backed up 3 photos.');
    expect(backupStatusText({ kind: 'done', added: 1, skipped: 2 })).toBe(
      'Backed up 1 photo. 2 photos couldn’t be backed up and were skipped.',
    );
    expect(backupStatusText({ kind: 'failed', message: 'Offline.' })).toBe('Offline.');
  });
});
