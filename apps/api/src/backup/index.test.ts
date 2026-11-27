import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from './index';
import * as sync from './sync';

const result: sync.SyncResult = {
  copied: 0,
  pending: 0,
  marked: 0,
  unmarked: 0,
  removed: 0,
  failed: 0,
  guarded: false,
  behindMs: 0,
};

const HOUR = 60 * 60 * 1000;

function scheduled() {
  const env = { SOURCE: {} as R2Bucket, BACKUP: {} as R2Bucket };
  const controller = { scheduledTime: Date.parse('2026-11-01T00:17:00Z') } as ScheduledController;
  return worker.scheduled(controller, env);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('backup Worker', () => {
  it('runs a sync at the scheduled time', async () => {
    const run = vi.spyOn(sync, 'syncBackup').mockResolvedValue({ ...result, copied: 3 });
    await scheduled();
    expect(run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      new Date('2026-11-01T00:17:00Z'),
    );
  });

  it('fails the run when something failed or the photo bucket listed empty', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(sync, 'syncBackup').mockResolvedValue({ ...result, failed: 2 });
    await expect(scheduled()).rejects.toThrow('incomplete');
    vi.spyOn(sync, 'syncBackup').mockResolvedValue({ ...result, guarded: true });
    await expect(scheduled()).rejects.toThrow('incomplete');
    // Counts only, never file names.
    for (const [message] of error.mock.calls) expect(String(message)).not.toMatch(/photos\//);
  });

  it('fails the run when the backup has fallen hours behind', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(sync, 'syncBackup').mockResolvedValue({ ...result, pending: 9, behindMs: HOUR });
    await scheduled();
    expect(error).not.toHaveBeenCalled();
    vi.spyOn(sync, 'syncBackup').mockResolvedValue({ ...result, pending: 9, behindMs: 7 * HOUR });
    await expect(scheduled()).rejects.toThrow('incomplete');
    expect(String(error.mock.calls[0]?.[0])).toMatch(/9 files.*7 hours/);
  });
});
