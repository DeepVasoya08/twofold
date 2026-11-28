import { describe, expect, it, vi } from 'vitest';

import {
  GOOGLE_REVOKE_URL,
  PICKED_PHOTO_SIZE_ESTIMATE,
  PickerError,
  parseDuration,
  pickedItems,
  pickerClient,
  waitForPicks,
} from './google-picker';
import type { PickerSession } from './google-picker';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const SESSION = {
  id: 'session-1',
  pickerUri: 'https://photos.google.com/picker/session-1',
  mediaItemsSet: false,
  pollingConfig: { pollInterval: '2s', timeoutIn: '1800s' },
};

const photo = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  createTime: '2019-07-14T13:00:00Z',
  type: 'PHOTO',
  mediaFile: {
    baseUrl: `https://lh3.googleusercontent.com/ppa/${id}`,
    mimeType: 'image/jpeg',
    filename: `${id}.jpg`,
  },
  ...extra,
});

describe('pickerClient', () => {
  it('starts a session with the access token, asking for up to 2,000 photos', async () => {
    const fetcher = vi.fn<Fetch>(() => Promise.resolve(json(SESSION)));
    const session = await pickerClient('token-1', fetcher).createSession();
    expect(session).toEqual({
      id: 'session-1',
      pickerUri: 'https://photos.google.com/picker/session-1',
      mediaItemsSet: false,
      pollIntervalMs: 2000,
      timeoutMs: 1_800_000,
    });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('https://photospicker.googleapis.com/v1/sessions');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer token-1' });
    expect(JSON.parse(init?.body as string)).toEqual({ pickingConfig: { maxItemCount: '2000' } });
  });

  it('keeps the picking link and timings when a finished session leaves them out', async () => {
    const client = pickerClient('t', () =>
      Promise.resolve(
        json({
          id: 'session-1',
          mediaItemsSet: true,
          expireTime: '2026-11-02T10:00:00Z',
          pickingConfig: { maxItemCount: '2000' },
        }),
      ),
    );
    const started = await pickerClient('t', () => Promise.resolve(json(SESSION))).createSession();
    expect(await client.getSession(started)).toEqual({ ...started, mediaItemsSet: true });
  });

  it('lists every page of picks, counting videos and leaving out what it can’t read', async () => {
    const pages = [
      json({ mediaItems: [photo('a'), { ...photo('v'), type: 'VIDEO' }], nextPageToken: 'p2' }),
      json({
        mediaItems: [
          photo('b', { createTime: 'not a date' }),
          { id: 'odd' },
          photo('c', { mediaFile: { baseUrl: 'http://insecure', mimeType: 'image/jpeg' } }),
        ],
      }),
    ];
    const fetcher = vi.fn<Fetch>(() => Promise.resolve(pages.shift() ?? json({})));
    const picked = await pickerClient('t', fetcher).listPicked('session-1');
    expect(picked.videos).toBe(1);
    expect(picked.photos).toEqual([
      {
        id: 'a',
        filename: 'a.jpg',
        mimeType: 'image/jpeg',
        createTime: Date.UTC(2019, 6, 14, 13),
        baseUrl: 'https://lh3.googleusercontent.com/ppa/a',
      },
      {
        id: 'b',
        filename: 'b.jpg',
        mimeType: 'image/jpeg',
        baseUrl: 'https://lh3.googleusercontent.com/ppa/b',
      },
    ]);
    expect(fetcher.mock.calls[1]?.[0]).toContain('pageToken=p2');
  });

  it('downloads the original straight from Google, with the token', async () => {
    const fetcher = vi.fn<Fetch>(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]))));
    const client = pickerClient('token-2', fetcher);
    const [picked] = (
      await pickerClient('t', () => Promise.resolve(json({ mediaItems: [photo('a')] }))).listPicked(
        's',
      )
    ).photos;
    if (!picked) throw new Error('missing');
    expect(await client.download(picked)).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://lh3.googleusercontent.com/ppa/a=d');
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: 'Bearer token-2' });
  });

  it('says when the sign-in has ended or Google can’t be reached', async () => {
    const signedOut = pickerClient('t', () => Promise.resolve(json({}, 401)));
    await expect(
      signedOut.getSession({ ...SESSION, pollIntervalMs: 2000, timeoutMs: 1 }),
    ).rejects.toThrow('Your Google sign-in has ended');
    const offline = pickerClient('t', () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(offline.createSession()).rejects.toThrow(PickerError);
    const broken = pickerClient('t', () => Promise.resolve(json({ id: 1 })));
    await expect(broken.createSession()).rejects.toThrow(PickerError);
    const notHttps = pickerClient('t', () =>
      Promise.resolve(json({ ...SESSION, pickerUri: 'javascript:alert(1)' })),
    );
    await expect(notHttps.createSession()).rejects.toThrow(PickerError);
  });

  it('signs out by ending the session, then revoking the token at Google', async () => {
    const fetcher = vi.fn<Fetch>(() => Promise.resolve(new Response(null, { status: 200 })));
    await pickerClient('token-3', fetcher).signOut('session-1');
    expect(fetcher.mock.calls.map(([url, init]) => [init?.method, url])).toEqual([
      ['DELETE', 'https://photospicker.googleapis.com/v1/sessions/session-1'],
      ['POST', GOOGLE_REVOKE_URL],
    ]);
    const revoke = fetcher.mock.calls[1]?.[1];
    expect(revoke?.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    // In the body, never the address, so it isn't kept in logs along the way.
    expect(revoke?.body).toBe('token=token-3');
    expect(GOOGLE_REVOKE_URL).toBe('https://oauth2.googleapis.com/revoke');
  });

  it('still revokes when the session can’t be ended, and never throws', async () => {
    const fetcher = vi.fn<Fetch>((url) =>
      url === GOOGLE_REVOKE_URL
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(json({}, 401)),
    );
    await expect(pickerClient('t', fetcher).signOut('session-1')).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toBe(GOOGLE_REVOKE_URL);
    // Without a session, only the token is revoked.
    const plain = vi.fn<Fetch>(() => Promise.resolve(new Response(null, { status: 200 })));
    await pickerClient('t', plain).signOut(null);
    expect(plain.mock.calls.map(([url]) => url)).toEqual([GOOGLE_REVOKE_URL]);
  });
});

describe('parseDuration', () => {
  it('reads Google’s durations', () => {
    expect(parseDuration('5s', 0)).toBe(5000);
    expect(parseDuration('1.5s', 0)).toBe(1500);
    expect(parseDuration('soon', 7)).toBe(7);
    expect(parseDuration(undefined, 7)).toBe(7);
  });
});

describe('waitForPicks', () => {
  const session: PickerSession = {
    id: 's',
    pickerUri: 'https://photos.google.com/picker/s',
    mediaItemsSet: false,
    pollIntervalMs: 1000,
    timeoutMs: 3000,
  };
  const sleep = () => Promise.resolve();

  it('asks until the picking is done', async () => {
    const answers = [false, false, true];
    const getSession = vi.fn(() =>
      Promise.resolve({ ...session, mediaItemsSet: answers.shift() ?? true }),
    );
    const done = await waitForPicks({ getSession }, session, new AbortController().signal, sleep);
    expect(done?.mediaItemsSet).toBe(true);
    expect(getSession).toHaveBeenCalledTimes(3);
  });

  it('gives up when the session runs out, and stops when cancelled', async () => {
    const getSession = () => Promise.resolve(session);
    await expect(
      waitForPicks({ getSession }, session, new AbortController().signal, sleep),
    ).rejects.toThrow('Picking took too long');
    const controller = new AbortController();
    controller.abort();
    expect(await waitForPicks({ getSession }, session, controller.signal, sleep)).toBeNull();
  });
});

describe('pickedItems', () => {
  it('turns picks into import items read from Google when needed', async () => {
    const download = vi.fn(() => Promise.resolve(new Uint8Array([9])));
    const [item, undated] = pickedItems(
      [
        {
          id: 'a',
          filename: 'IMG_1.HEIC',
          mimeType: 'image/heif',
          createTime: Date.UTC(2018, 2, 9),
          baseUrl: 'https://lh3.googleusercontent.com/ppa/a',
        },
        { id: 'b', filename: 'b.jpg', mimeType: 'image/jpeg', baseUrl: 'https://x/b' },
      ],
      download,
    );
    expect(item).toMatchObject({
      name: 'IMG_1.HEIC',
      type: 'image/heic',
      year: 2018,
      albums: [],
      size: PICKED_PHOTO_SIZE_ESTIMATE,
      takenAt: Date.UTC(2018, 2, 9),
    });
    expect(undated).toMatchObject({ year: null });
    expect(undated?.takenAt).toBeUndefined();
    expect(download).not.toHaveBeenCalled();
    expect(await item?.source.read()).toEqual(new Uint8Array([9]));
  });
});
