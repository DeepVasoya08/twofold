/**
 * Calls back once after a stretch with no activity. Activity only records a time, so it is
 * cheap enough to call on every pointer move; the timer re-arms itself for whatever is left.
 * Background tabs may run timers late, so `check` also runs when the tab is shown again.
 */

export interface IdleTimerDeps {
  now: () => number;
  /** Runs `run` after `ms` and returns a function that cancels it. */
  schedule: (run: () => void, ms: number) => () => void;
}

export const browserTimers: IdleTimerDeps = {
  now: () => Date.now(),
  schedule: (run, ms) => {
    const id = setTimeout(run, ms);
    return () => {
      clearTimeout(id);
    };
  },
};

export class IdleTimer {
  private last: number;
  private cancel: (() => void) | null = null;
  private stopped = false;

  constructor(
    private readonly timeoutMs: number,
    private readonly onIdle: () => void,
    private readonly deps: IdleTimerDeps = browserTimers,
  ) {
    this.last = deps.now();
    this.arm(timeoutMs);
  }

  /** Someone used the page. */
  touch(): void {
    this.last = this.deps.now();
  }

  /** Fires `onIdle` if the timeout has passed since the last activity; otherwise waits on. */
  check(): void {
    if (this.stopped) return;
    const idle = this.deps.now() - this.last;
    if (idle >= this.timeoutMs) {
      this.stop();
      this.onIdle();
    } else {
      this.arm(this.timeoutMs - idle);
    }
  }

  stop(): void {
    this.stopped = true;
    this.cancel?.();
    this.cancel = null;
  }

  private arm(ms: number): void {
    this.cancel?.();
    this.cancel = this.deps.schedule(() => {
      this.check();
    }, ms);
  }
}
