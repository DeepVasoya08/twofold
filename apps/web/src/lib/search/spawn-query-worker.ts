import QueryWorker from './query-worker?worker';

/** Starts the Web Worker that turns typed queries into search vectors. */
export function spawnQueryWorker(): Worker {
  return new QueryWorker({ name: 'search-query' });
}
