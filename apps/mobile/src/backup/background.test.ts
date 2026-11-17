import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ AppState: { currentState: 'background' } }));
vi.mock('../../modules/backup-job', () => ({}));
vi.mock('../../modules/upload-service', () => ({}));
vi.mock('../session/kept-session', () => ({}));
vi.mock('./backup-runner', () => ({}));
vi.mock('./backup-state', () => ({}));
vi.mock('./photo-permission', () => ({}));
vi.mock('./last-run', () => ({}));

const { backedUpText } = await import('./background');

describe('backedUpText', () => {
  it('counts the photos', () => {
    expect(backedUpText(1)).toBe('1 new photo was backed up to your library.');
    expect(backedUpText(4)).toBe('4 new photos were backed up to your library.');
  });
});
