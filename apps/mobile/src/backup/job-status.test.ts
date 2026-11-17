import { describe, expect, it } from 'vitest';

import { jobStatusText } from './job-status';

const base = {
  on: true,
  onChangeWaiting: true,
  periodicWaiting: true,
  lastStart: 0,
  lastEnd: 0,
  note: '',
};

describe('jobStatusText', () => {
  it('says what is waiting and when a job last started', () => {
    expect(jobStatusText(null)).toBe('Background: not set up. Turn backup off and on again.');
    expect(jobStatusText(base)).toBe(
      'Background: waiting for new photos and every six hours. Never started yet.',
    );
    const started = new Date(2026, 10, 17, 9, 5).getTime();
    expect(
      jobStatusText({ ...base, onChangeWaiting: false, lastStart: started, note: 'Finished' }),
    ).toBe('Background: waiting for every six hours. Last started at 09:05. (Finished)');
    expect(jobStatusText({ ...base, onChangeWaiting: false, periodicWaiting: false })).toBe(
      'Background: no job is waiting with Android. Never started yet.',
    );
  });
});
