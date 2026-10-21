/**
 * Web Worker entry: makes upload previews off the page's main thread. The photo goes to it as
 * a Blob (no copy of its bytes) and the small JPEG comes back; see lib/thumbnailer.ts.
 */
import { answerThumbRequest } from './thumbnailer';
import { offscreenCanvas } from './thumbnail';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.addEventListener('message', (event) => {
  // Without OffscreenCanvas (older Safari) every request fails, and the page draws instead.
  const canvas = typeof OffscreenCanvas === 'undefined' ? null : offscreenCanvas;
  void answerThumbRequest(event.data, canvas).then((reply) => {
    scope.postMessage(reply, reply.ok ? [reply.thumb.bytes.buffer] : []);
  });
});
