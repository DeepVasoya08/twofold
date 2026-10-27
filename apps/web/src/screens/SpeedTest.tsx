import { useEffect, useRef, useState } from 'react';

import { Logo } from '../components/Brand';
import { BENCH_MODES, describeDevice, formatReport } from '../lib/search/bench';
import type { BenchEvent, BenchMode, StepTimes } from '../lib/search/bench';
import { SEARCH_RESOURCES } from '../lib/search/resources';

import './speed-test.css';

type Part = 'photo' | 'text';

const TOTAL_MB = Math.round(
  (SEARCH_RESOURCES.photo.size + SEARCH_RESOURCES.text.size) / (1024 * 1024),
);

const modeLabels: Record<BenchMode, string> = {
  fast: 'Fast',
  'low-memory': 'Low memory',
};

const partLabels: Record<Part, string> = { photo: 'Photo', text: 'Search' };

function describeProgress(event: Extract<BenchEvent, { kind: 'progress' }>): string {
  const part = partLabels[event.part];
  if (event.stage === 'download') {
    const percent = Math.floor((event.done / event.total) * 100);
    return `${part}: downloading resources (${String(percent)}%)`;
  }
  if (event.stage === 'load') return `${part}: getting ready`;
  return `${part}: run ${String(event.done)} of ${String(event.total)}`;
}

/**
 * A hidden page (/lab/speed, not linked anywhere) that measures how fast this device runs
 * Smart search, so it can be tuned on real phones. It uses made-up inputs, never photos.
 */
export function SpeedTest() {
  const [mode, setMode] = useState<BenchMode>('fast');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [results, setResults] = useState<Partial<Record<Part, StepTimes>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const worker = useRef<Worker | null>(null);
  const device = describeDevice(navigator);

  useEffect(
    () => () => {
      worker.current?.terminate();
    },
    [],
  );

  const start = () => {
    setRunning(true);
    setResults({});
    setFailure(null);
    setCopied(false);
    setStatus('Starting');
    void import('../lib/search/spawn-bench-worker').then(({ spawnBenchWorker }) => {
      const started = spawnBenchWorker();
      worker.current = started;
      const finish = () => {
        started.terminate();
        worker.current = null;
        setRunning(false);
      };
      started.addEventListener('message', (message: MessageEvent<BenchEvent>) => {
        const event = message.data;
        if (event.kind === 'progress') setStatus(describeProgress(event));
        if (event.kind === 'result')
          setResults((current) => ({ ...current, [event.part]: event.times }));
        if (event.kind === 'finished') {
          setStatus('Done');
          finish();
        }
        if (event.kind === 'failed') {
          setStatus(null);
          setFailure(event.message);
          finish();
        }
      });
      started.addEventListener('error', () => {
        setStatus(null);
        setFailure('The test stopped. The tab may have run out of memory.');
        finish();
      });
      started.postMessage(mode);
    });
  };

  const report = formatReport(device, mode, results, failure);
  const finished = !running && (results.text !== undefined || failure !== null);

  return (
    <main className="speed-test">
      <Logo />
      <h1 className="speed-test__title">Speed test</h1>
      <p className="speed-test__text">
        Measures how long this device takes to get Smart search ready and run it. Nothing from your
        library is used. The first run downloads about {TOTAL_MB} MB of resources.
      </p>

      <fieldset className="speed-test__modes" disabled={running}>
        <legend>Mode</legend>
        {BENCH_MODES.map((each) => (
          <label key={each} className="speed-test__mode">
            <input
              type="radio"
              name="mode"
              value={each}
              checked={mode === each}
              onChange={() => {
                setMode(each);
              }}
            />
            {modeLabels[each]}
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        className="btn btn--primary"
        disabled={running}
        aria-busy={running}
        onClick={start}
      >
        {running ? 'Testing…' : 'Start test'}
      </button>

      {status && (
        <p className="speed-test__status" role="status">
          {status}
        </p>
      )}

      {finished && (
        <section className="speed-test__results" aria-label="Results">
          <pre className="speed-test__report">{report}</pre>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              void navigator.clipboard.writeText(report).then(() => {
                setCopied(true);
              });
            }}
          >
            {copied ? 'Copied' : 'Copy results'}
          </button>
        </section>
      )}
    </main>
  );
}
