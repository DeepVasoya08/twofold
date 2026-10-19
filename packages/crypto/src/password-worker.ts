/**
 * Web Worker entry: runs Argon2id off the page's main thread. Bundled by the web app as a
 * worker (`?worker`); see hash-worker.ts for the protocol.
 */
import { answerHashRequest } from './hash-worker';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.addEventListener('message', (event) => {
  void answerHashRequest(event.data).then((reply) => {
    scope.postMessage(reply, reply.ok ? [reply.master.buffer] : []);
  });
});
