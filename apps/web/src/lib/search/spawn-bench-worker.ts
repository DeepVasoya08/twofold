import BenchWorker from './bench-worker?worker';

/** Starts the Web Worker that runs the hidden speed test. */
export function spawnBenchWorker(): Worker {
  return new BenchWorker({ name: 'speed-test' });
}
