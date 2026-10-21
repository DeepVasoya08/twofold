import { describe, expect, it } from 'vitest';

import { sha256, toBase64Url } from '@twofold/crypto/webcrypto';

import { ModelError, loadModelBytes } from './models';

const detector = new Uint8Array([1, 2, 3]);
const recognizer = new Uint8Array([4, 5, 6]);

async function files() {
  return {
    detector: { url: '/d.onnx', sha256: toBase64Url(await sha256(detector)) },
    recognizer: { url: '/r.onnx', sha256: toBase64Url(await sha256(recognizer)) },
  };
}

const serve = (bodies: Record<string, Uint8Array | null>): typeof fetch =>
  ((url: string) => {
    const body = bodies[url];
    return Promise.resolve(
      body ? new Response(new Uint8Array(body)) : new Response(null, { status: 404 }),
    );
  }) as typeof fetch;

describe('loadModelBytes', () => {
  it('returns both models when they match their pinned hashes', async () => {
    const loaded = await loadModelBytes(
      serve({ '/d.onnx': detector, '/r.onnx': recognizer }),
      await files(),
    );
    expect(loaded).toEqual({ detector, recognizer });
  });

  it('refuses a changed model file', async () => {
    const load = serve({ '/d.onnx': detector, '/r.onnx': new Uint8Array([4, 5, 7]) });
    await expect(loadModelBytes(load, await files())).rejects.toThrow(ModelError);
    await expect(loadModelBytes(load, await files())).rejects.toThrow('didn’t match');
  });

  it('fails when a file is missing or the network is down', async () => {
    await expect(
      loadModelBytes(serve({ '/d.onnx': detector, '/r.onnx': null }), await files()),
    ).rejects.toThrow(ModelError);
    const offline = (() => Promise.reject(new TypeError('offline'))) as typeof fetch;
    await expect(loadModelBytes(offline, await files())).rejects.toThrow(ModelError);
  });
});
