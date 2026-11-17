import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-file-system', () => ({ File: vi.fn(), Paths: {} }));

const { lastRunText, parseLastRun } = await import('./last-run');

const now = new Date(2026, 10, 17, 11, 0).getTime();
const run = {
  at: new Date(2026, 10, 17, 10, 51).getTime(),
  by: 'background' as const,
  added: 1,
  skipped: 0,
  problem: null,
};

describe('last backup run', () => {
  it('round-trips and refuses anything malformed', () => {
    expect(parseLastRun(JSON.stringify(run))).toEqual(run);
    for (const bad of [null, '', 'x', '{}', JSON.stringify({ ...run, by: 'someone' })]) {
      expect(parseLastRun(bad)).toBeNull();
    }
    expect(parseLastRun(JSON.stringify({ ...run, added: -1 }))).toBeNull();
  });

  it('says when and what', () => {
    expect(lastRunText(null, now)).toBe('Last backup: not yet.');
    expect(lastRunText(run, now)).toBe(
      'Last backup: Today at 10:51, in the background. 1 photo backed up.',
    );
    expect(lastRunText({ ...run, by: 'you', added: 0 }, now)).toBe(
      'Last backup: Today at 10:51, when you asked. Nothing new.',
    );
    const yesterday = { ...run, at: new Date(2026, 10, 16, 22, 5).getTime(), added: 3 };
    expect(lastRunText(yesterday, now)).toBe(
      'Last backup: Yesterday at 22:05, in the background. 3 photos backed up.',
    );
    const older = { ...run, at: new Date(2026, 10, 15, 8, 0).getTime(), problem: 'Not on Wi-Fi.' };
    expect(lastRunText(older, now)).toBe(
      'Last backup: Nov 15 at 08:00, in the background. Not on Wi-Fi.',
    );
  });
});
