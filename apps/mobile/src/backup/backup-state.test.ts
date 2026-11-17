import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({}));

const { encodeBackupState, parseBackupState } = await import('./backup-state');

const state = { token: 'tok', tokenId: 'tid', publicKey: 'pk', lastId: 42 };

describe('backup state', () => {
  it('round-trips', () => {
    expect(parseBackupState(encodeBackupState(state))).toEqual(state);
  });

  it('refuses anything malformed', () => {
    for (const bad of [
      null,
      '',
      'not json',
      '[]',
      JSON.stringify({ ...state, v: 2 }),
      JSON.stringify({ ...state, v: 1, token: '' }),
      JSON.stringify({ ...state, v: 1, lastId: -1 }),
      JSON.stringify({ ...state, v: 1, lastId: 1.5 }),
      JSON.stringify({ ...state, v: 1, publicKey: 7 }),
    ]) {
      expect(parseBackupState(bad)).toBeNull();
    }
  });
});
