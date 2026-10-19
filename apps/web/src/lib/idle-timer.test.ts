import { describe, expect, it } from 'vitest';

import { IdleTimer } from './idle-timer';
import type { IdleTimerDeps } from './idle-timer';

/** A clock and timers the test moves by hand. */
function fakeTimers() {
  let time = 0;
  let pending: { at: number; run: () => void }[] = [];
  const deps: IdleTimerDeps = {
    now: () => time,
    schedule: (run, ms) => {
      const entry = { at: time + ms, run };
      pending.push(entry);
      return () => {
        pending = pending.filter((other) => other !== entry);
      };
    },
  };
  /** Moves the clock on and runs the timers that come due. */
  const advance = (ms: number) => {
    time += ms;
    for (;;) {
      const due = pending.filter((entry) => entry.at <= time).sort((a, b) => a.at - b.at)[0];
      if (!due) return;
      pending = pending.filter((entry) => entry !== due);
      due.run();
    }
  };
  return { deps, advance, pendingCount: () => pending.length };
}

const MINUTE = 60_000;

describe('IdleTimer', () => {
  it('fires once the timeout passes with no activity', () => {
    const timers = fakeTimers();
    let idle = 0;
    new IdleTimer(MINUTE, () => (idle += 1), timers.deps);
    timers.advance(MINUTE - 1);
    expect(idle).toBe(0);
    timers.advance(1);
    expect(idle).toBe(1);
    timers.advance(10 * MINUTE);
    expect(idle).toBe(1);
  });

  it('waits a full timeout after the latest activity', () => {
    const timers = fakeTimers();
    let idle = 0;
    const timer = new IdleTimer(MINUTE, () => (idle += 1), timers.deps);
    timers.advance(50_000);
    timer.touch();
    timers.advance(50_000);
    expect(idle).toBe(0);
    timers.advance(10_000);
    expect(idle).toBe(1);
  });

  it('fires on check when the timer ran late, as in a background tab', () => {
    const timers = fakeTimers();
    let idle = 0;
    const timer = new IdleTimer(MINUTE, () => (idle += 1), timers.deps);
    timers.deps.now = () => 2 * MINUTE;
    timer.check();
    expect(idle).toBe(1);
  });

  it('a check before the timeout does not fire and keeps one timer', () => {
    const timers = fakeTimers();
    let idle = 0;
    const timer = new IdleTimer(MINUTE, () => (idle += 1), timers.deps);
    timers.advance(30_000);
    timer.check();
    expect(idle).toBe(0);
    expect(timers.pendingCount()).toBe(1);
    timers.advance(30_000);
    expect(idle).toBe(1);
  });

  it('never fires after stop', () => {
    const timers = fakeTimers();
    let idle = 0;
    const timer = new IdleTimer(MINUTE, () => (idle += 1), timers.deps);
    timer.stop();
    timers.advance(2 * MINUTE);
    timer.check();
    expect(idle).toBe(0);
    expect(timers.pendingCount()).toBe(0);
  });
});
