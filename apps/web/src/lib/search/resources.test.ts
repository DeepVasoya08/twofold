import { describe, expect, it } from 'vitest';

import { sha256, toBase64Url } from '@twofold/crypto/webcrypto';

import {
  CHUNK_BYTES,
  ResourceError,
  SEARCH_RESOURCES,
  chunkUrls,
  downloadResource,
  resourceCached,
} from './resources';
import type { SearchResource } from './resources';

const serve = (bodies: Record<string, Uint8Array | null>): typeof fetch =>
  ((url: string) => {
    const body = bodies[url];
    return Promise.resolve(
      body ? new Response(new Uint8Array(body)) : new Response(null, { status: 404 }),
    );
  }) as typeof fetch;

/** A resource of `size` bytes, as one or more chunks. */
async function fake(size: number): Promise<{ resource: SearchResource; whole: Uint8Array }> {
  const whole = Uint8Array.from({ length: size }, (_, index) => index % 251);
  return {
    whole,
    resource: { name: 'fake', size, sha256: toBase64Url(await sha256(whole)) },
  };
}

/** Small chunks keep the tests light; the real size is checked separately. */
const SMALL = 64;

function chunked(resource: SearchResource, whole: Uint8Array): Record<string, Uint8Array> {
  return Object.fromEntries(
    chunkUrls(resource, SMALL).map((url, index) => [
      url,
      whole.subarray(index * SMALL, (index + 1) * SMALL),
    ]),
  );
}

const from = (bodies: Record<string, Uint8Array | null>) => ({
  load: serve(bodies),
  chunkBytes: SMALL,
});

describe('chunkUrls', () => {
  it('names one chunk per 24 MiB, each under the 25 MiB asset limit', () => {
    expect(chunkUrls(SEARCH_RESOURCES.photo)).toHaveLength(4);
    expect(chunkUrls(SEARCH_RESOURCES.text)).toHaveLength(3);
    expect(chunkUrls(SEARCH_RESOURCES.text)[2]).toBe('/resources/search/text-a5136c3569a8.2.bin');
    expect(CHUNK_BYTES).toBeLessThan(25 * 1024 * 1024);
  });
});

describe('downloadResource', () => {
  it('joins the chunks and reports progress', async () => {
    const { resource, whole } = await fake(SMALL * 3 + 10);
    const progress: number[] = [];
    const bytes = await downloadResource(
      resource,
      (received) => progress.push(received),
      from(chunked(resource, whole)),
    );
    expect(bytes).toEqual(whole);
    expect(progress).toEqual([SMALL, SMALL * 2, SMALL * 3, SMALL * 3 + 10]);
  });

  it('refuses a changed chunk', async () => {
    const { resource, whole } = await fake(1000);
    const tampered = whole.slice();
    tampered[10] = (tampered[10] ?? 0) ^ 1;
    await expect(
      downloadResource(resource, undefined, from(chunked(resource, tampered))),
    ).rejects.toThrow('didn’t match');
  });

  it('refuses a file that is too short or too long', async () => {
    const { resource, whole } = await fake(1000);
    await expect(
      downloadResource(resource, undefined, from(chunked(resource, whole.subarray(0, 999)))),
    ).rejects.toThrow(ResourceError);
    const longer = new Uint8Array(1001);
    longer.set(whole);
    await expect(
      downloadResource(resource, undefined, from(chunked(resource, longer))),
    ).rejects.toThrow('didn’t match');
  });

  it('fails when a chunk is missing or the network is down', async () => {
    const { resource, whole } = await fake(SMALL * 2);
    const last = chunkUrls(resource, SMALL)[1];
    const missingLast = Object.fromEntries(
      Object.entries(chunked(resource, whole)).filter(([url]) => url !== last),
    );
    await expect(downloadResource(resource, undefined, from(missingLast))).rejects.toThrow(
      ResourceError,
    );
    const offline = (() => Promise.reject(new TypeError('offline'))) as typeof fetch;
    await expect(
      downloadResource(resource, undefined, { load: offline, chunkBytes: SMALL }),
    ).rejects.toThrow(ResourceError);
  });

  it('lets go of a response it refuses, so the request doesn’t stay open', async () => {
    const { resource, whole } = await fake(1000);
    let cancelled = 0;
    const answer =
      (status: number, body: Uint8Array): typeof fetch =>
      () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(body);
          },
          cancel() {
            cancelled++;
          },
        });
        return Promise.resolve(new Response(stream, { status }));
      };
    const once = { chunkBytes: 4096 };
    await expect(
      downloadResource(resource, undefined, { ...once, load: answer(404, whole) }),
    ).rejects.toThrow(ResourceError);
    const longer = new Uint8Array(1001);
    longer.set(whole);
    await expect(
      downloadResource(resource, undefined, { ...once, load: answer(200, longer) }),
    ).rejects.toThrow('didn’t match');
    expect(cancelled).toBe(2);
  });
});

describe('resourceCached', () => {
  it('asks the HTTP cache only, and says yes only when every chunk is there', async () => {
    const resource: SearchResource = { name: 'fake', size: 150, sha256: 'x' };
    const asked: (RequestInit | undefined)[] = [];
    const cache = (cached: string[]): typeof fetch =>
      ((url: string, init?: RequestInit) => {
        asked.push(init);
        return Promise.resolve(
          cached.includes(url)
            ? new Response(new Uint8Array(1))
            : new Response(null, { status: 504 }),
        );
      }) as typeof fetch;
    const urls = chunkUrls(resource, 64);
    expect(await resourceCached(resource, { load: cache(urls), chunkBytes: 64 })).toBe(true);
    expect(asked[0]).toEqual({ cache: 'only-if-cached', mode: 'same-origin' });
    expect(await resourceCached(resource, { load: cache(urls.slice(0, 2)), chunkBytes: 64 })).toBe(
      false,
    );
    const refusing = (() => Promise.reject(new TypeError('unsupported'))) as typeof fetch;
    expect(await resourceCached(resource, { load: refusing, chunkBytes: 64 })).toBe(false);
  });
});
