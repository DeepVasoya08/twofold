import { describe, expect, it } from 'vitest';

import { scanText } from './scan-text';

const lookedAt = { done: 1234, total: 5000 };

describe('scanText', () => {
  it('says how far the phone has got', () => {
    expect(scanText({ state: 'scanning' }, lookedAt)).toBe(
      '1,234 of 5,000 photos looked at. Looking at photos while Arcafold is open.',
    );
    expect(scanText({ state: 'done' }, { done: 5000, total: 5000 })).toBe(
      'All 5,000 photos looked at.',
    );
  });

  it('says what it’s waiting for, and never mentions models', () => {
    expect(scanText({ state: 'waiting-for-wifi' }, lookedAt)).toContain('Waiting for Wi-Fi');
    expect(scanText({ state: 'downloading', received: 45, total: 100 }, lookedAt)).toBe(
      'Downloading resources (45%)…',
    );
    for (const state of ['off', 'loading', 'paused'] as const) {
      expect(scanText({ state }, lookedAt)).not.toMatch(/model/i);
    }
  });

  it('passes on why it stopped', () => {
    expect(scanText({ state: 'failed', message: 'No room.' }, lookedAt)).toBe('No room.');
  });
});
