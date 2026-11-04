import { describe, expect, it, vi } from 'vitest';

import { API_ORIGIN, apiConfig } from './config';

describe('apiConfig', () => {
  it('talks only to arcafold.com over HTTPS and keeps the session cookie in memory', () => {
    const fetch = vi.fn();
    const config = apiConfig(fetch);
    expect(config).toEqual({ origin: 'https://arcafold.com', fetch, cookies: 'memory' });
    expect(new URL(API_ORIGIN).protocol).toBe('https:');
  });
});
