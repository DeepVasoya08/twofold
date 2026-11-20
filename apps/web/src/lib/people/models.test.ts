import { describe, expect, it } from 'vitest';

import { sha256, toBase64Url } from '@arcafold/crypto/webcrypto';

import { readFile } from 'node:fs/promises';

import { FACE_RESOURCES } from '@arcafold/core/people/resources';

import { MODEL_FILES, ModelError, loadModelBytes } from './models';

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

describe('MODEL_FILES', () => {
  it('serves the files in public/resources/faces, which match their pins', async () => {
    for (const resource of Object.values(FACE_RESOURCES)) {
      const bytes = await readFile(
        new URL(`../../../public/resources/faces/${resource.file}`, import.meta.url),
      );
      expect(bytes.length).toBe(resource.size);
      expect(toBase64Url(await sha256(new Uint8Array(bytes)))).toBe(resource.sha256);
    }
    expect(MODEL_FILES.detector.url).toBe('/resources/faces/yunet-2023mar.onnx');
  });
});
