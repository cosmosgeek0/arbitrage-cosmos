import type { RepeatingScheduler, ScheduledTask, UtcClock } from './types.js';

/** Explicit production adapter; constructing/importing it starts no timer. */
export function createNodeRepeatingScheduler(): RepeatingScheduler {
  return Object.freeze({
    scheduleEvery(intervalMs: number, task: () => void): ScheduledTask {
      const timer = setInterval(task, intervalMs);
      timer.unref?.();
      let active = true;
      return Object.freeze({
        cancel(): void {
          if (!active) return;
          active = false;
          clearInterval(timer);
        },
      });
    },
  });
}

/** Explicit production clock adapter; importing it reads no clock. */
export function createSystemUtcClock(): UtcClock {
  let lastObserved = 0;
  return Object.freeze({
    nowMs(): number {
      const observed = Date.now();
      // Foundation requires non-regressing UTC ms. Preserve the last truthful
      // observation across a backward system-clock adjustment.
      lastObserved = Math.max(lastObserved, observed);
      return lastObserved;
    },
  });
}
