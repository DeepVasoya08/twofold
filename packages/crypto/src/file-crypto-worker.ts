/**
 * Web Worker entry: encrypts and decrypts photo files off the page's main thread. Bundled by
 * the web app as a worker (`?worker`); see file-worker.ts for the protocol.
 */
import { answerFileRequest } from './file-worker';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.addEventListener('message', (event) => {
  void answerFileRequest(event.data).then((reply) => {
    scope.postMessage(reply, reply.ok ? [reply.out.buffer] : []);
  });
});
