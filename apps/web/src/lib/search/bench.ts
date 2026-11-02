/**
 * The hidden speed test (/lab/speed): how long this device takes to download, load and run
 * Smart search's two resources. Nothing here touches photos or keys; the inputs are made
 * up. It exists so the real thing can be tuned on real phones before it's built.
 */

/**
 * How the photo half is loaded. "fast" unpacks the 8-bit weights once at load (more
 * memory); "low-memory" keeps them packed and unpacks them on every run (slower). The text
 * half always loads the fast way.
 */
export type BenchMode = 'fast' | 'low-memory';

export const BENCH_MODES: readonly BenchMode[] = ['fast', 'low-memory'];

export interface StepTimes {
  downloadMs: number;
  loadMs: number;
  /** The first run, which includes warming up. */
  firstMs: number;
  /** The middle of the later runs. */
  medianMs: number;
}

export type BenchEvent =
  | {
      kind: 'progress';
      part: 'photo' | 'text';
      stage: 'download' | 'load' | 'run';
      done: number;
      total: number;
    }
  | { kind: 'result'; part: 'photo' | 'text'; times: StepTimes }
  | { kind: 'finished' }
  | { kind: 'failed'; message: string };

/** Runs `run` once to warm up, then `count` more times, and says how long they took. */
export async function timeRuns(
  run: () => Promise<unknown>,
  count: number,
  now: () => number = () => performance.now(),
  onRun: (done: number) => void = () => undefined,
): Promise<{ firstMs: number; medianMs: number }> {
  let start = now();
  await run();
  const firstMs = now() - start;
  const times: number[] = [];
  for (let index = 0; index < count; index += 1) {
    start = now();
    await run();
    times.push(now() - start);
    onRun(index + 1);
  }
  times.sort((a, b) => a - b);
  return { firstMs, medianMs: times[Math.floor(times.length / 2)] ?? firstMs };
}

export interface DeviceInfo {
  userAgent: string;
  cores: number | null;
  /** Rough RAM in GB, where the browser says (Chrome only). */
  memoryGb: number | null;
  webGpu: boolean;
}

export function describeDevice(nav: Navigator): DeviceInfo {
  const withMemory = nav as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent,
    cores: nav.hardwareConcurrency || null,
    memoryGb: withMemory.deviceMemory ?? null,
    webGpu: 'gpu' in nav,
  };
}

const ms = (value: number) => `${String(Math.round(value))} ms`;

/** The results as plain text, for pasting into a message. */
export function formatReport(
  device: DeviceInfo,
  mode: BenchMode,
  results: Partial<Record<'photo' | 'text', StepTimes>>,
  failure: string | null,
): string {
  const lines = [
    `Arcafold speed test (${mode})`,
    `Device: ${device.userAgent}`,
    `Cores: ${device.cores === null ? 'unknown' : String(device.cores)} · Memory: ${
      device.memoryGb === null ? 'unknown' : `${String(device.memoryGb)} GB`
    } · WebGPU: ${device.webGpu ? 'yes' : 'no'}`,
  ];
  for (const part of ['photo', 'text'] as const) {
    const times = results[part];
    if (!times) continue;
    const label = part === 'photo' ? 'Photo' : 'Search';
    lines.push(
      `${label}: download ${ms(times.downloadMs)}, load ${ms(times.loadMs)}, first ${ms(times.firstMs)}, then ${ms(times.medianMs)} each`,
    );
  }
  if (failure) lines.push(`Stopped: ${failure}`);
  return lines.join('\n');
}
