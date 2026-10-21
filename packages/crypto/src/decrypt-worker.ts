/**
 * Web Worker entry: decrypts photo files off the page's main thread. Bundled by the web app
 * as a worker (`?worker`); see file-worker.ts for the protocol.
 */
import { answerDecryptRequest } from './file-worker';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.addEventListener('message', (event) => {
  void answerDecryptRequest(event.data).then((reply) => {
    scope.postMessage(reply, reply.ok ? [reply.plain.buffer] : []);
  });
});
