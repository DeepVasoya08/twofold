/**
 * Web Worker entry: turns typed queries into search vectors (see query-encoder.ts). The
 * word list and the text half are downloaded, checked against their pinned SHA-256 and
 * loaded on the first request.
 */
import { answerQueryRequest } from './query-encoder';
import type { QueryEngine, QueryMessage } from './query-encoder';
import { SEARCH_RESOURCES, downloadResource } from './resources';
import { loadTextModel } from './text-model';
import { clipTokenizer } from './tokenizer';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: QueryMessage): void;
}

const scope = globalThis as unknown as WorkerScope;

let loaded: ReturnType<QueryEngine['load']> | null = null;
const engine: QueryEngine = {
  load: (onProgress) =>
    (loaded ??= (async () => {
      const { words, text } = SEARCH_RESOURCES;
      const total = words.size + text.size;
      const wordBytes = await downloadResource(words, (received) => {
        onProgress(received, total);
      });
      const tokenize = clipTokenizer(new TextDecoder().decode(wordBytes));
      const modelBytes = await downloadResource(text, (received) => {
        onProgress(words.size + received, total);
      });
      return { tokenize, model: await loadTextModel(modelBytes) };
    })()),
};

// One request at a time, in order: the model isn't built to run two at once.
let queue = Promise.resolve();
scope.addEventListener('message', (event) => {
  queue = queue.then(async () => {
    scope.postMessage(
      await answerQueryRequest(event.data, engine, (message) => {
        scope.postMessage(message);
      }),
    );
  });
});
