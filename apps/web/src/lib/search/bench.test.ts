import { describe, expect, it } from 'vitest';

import { describeDevice, formatReport, timeRuns } from './bench';

describe('timeRuns', () => {
  it('times a warm-up run, then reports the middle of the rest', async () => {
    const clock = [0, 50, 50, 60, 60, 90, 90, 110];
    let tick = 0;
    const now = () => clock[tick++] ?? 0;
    const seen: number[] = [];
    const times = await timeRuns(
      () => Promise.resolve(),
      3,
      now,
      (done) => seen.push(done),
    );
    expect(times).toEqual({ firstMs: 50, medianMs: 20 });
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('describeDevice', () => {
  it('reads what the browser offers and leaves the rest unknown', () => {
    const nav = {
      userAgent: 'Phone',
      hardwareConcurrency: 8,
      deviceMemory: 4,
    } as unknown as Navigator;
    expect(describeDevice(nav)).toEqual({
      userAgent: 'Phone',
      cores: 8,
      memoryGb: 4,
      webGpu: false,
    });
    const bare = { userAgent: 'Other', hardwareConcurrency: 0, gpu: {} } as unknown as Navigator;
    expect(describeDevice(bare)).toEqual({
      userAgent: 'Other',
      cores: null,
      memoryGb: null,
      webGpu: true,
    });
  });
});

describe('formatReport', () => {
  it('writes one line per finished part, plus why it stopped', () => {
    const report = formatReport(
      { userAgent: 'Phone', cores: 8, memoryGb: null, webGpu: true },
      'fast',
      { photo: { downloadMs: 4000.4, loadMs: 1200, firstMs: 900, medianMs: 610.6 } },
      'The tab ran out of memory.',
    );
    expect(report).toBe(
      [
        'Arcafold speed test (fast)',
        'Device: Phone',
        'Cores: 8 · Memory: unknown · WebGPU: yes',
        'Photo: download 4000 ms, load 1200 ms, first 900 ms, then 611 ms each',
        'Stopped: The tab ran out of memory.',
      ].join('\n'),
    );
    expect(report).not.toMatch(/model/i);
  });
});
