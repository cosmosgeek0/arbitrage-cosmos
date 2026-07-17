import { ApiRequestError } from './http';

export interface SettledPollOptions<T> {
  intervalMs: number;
  timeoutMs?: number;
  request: (signal: AbortSignal, generation: number) => Promise<T>;
  onSuccess: (value: T, generation: number) => void;
  onError?: (error: unknown, generation: number) => void;
}
export interface SettledPoll {
  start: () => void;
  refresh: () => void;
  stop: () => void;
  running: () => boolean;
}

export interface DelayedResetRuntime {
  schedule: (task: () => void, delayMs: number) => number;
  cancel: (handle: number) => void;
}

export interface DelayedResetOwner {
  schedule: (delayMs: number, task: () => void) => void;
  cancel: () => void;
  pending: () => boolean;
}

/** Owns one delayed UI reset so an obsolete completion cannot clear newer work. */
export function createDelayedResetOwner(
  runtime: DelayedResetRuntime = {
    schedule: (task, delayMs) => window.setTimeout(task, delayMs),
    cancel: (handle) => window.clearTimeout(handle),
  },
): DelayedResetOwner {
  let handle: number | null = null;

  const cancel = () => {
    if (handle !== null) runtime.cancel(handle);
    handle = null;
  };

  return {
    schedule(delayMs, task) {
      cancel();
      handle = runtime.schedule(() => {
        handle = null;
        task();
      }, Math.max(0, delayMs));
    },
    cancel,
    pending: () => handle !== null,
  };
}

/**
 * Owns exactly one request generation. The next cadence is scheduled only
 * after settlement; manual refresh aborts the obsolete generation first.
 */
export function createSettledPoll<T>(options: SettledPollOptions<T>): SettledPoll {
  let stopped = false;
  let generation = 0;
  let timer: number | null = null;
  let active: AbortController | null = null;

  const clearTimer = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    clearTimer();
    if (stopped) return;
    timer = window.setTimeout(() => void run(), Math.max(250, options.intervalMs));
  };

  const run = async () => {
    if (stopped || active) return;
    clearTimer();
    const requestGeneration = ++generation;
    const controller = new AbortController();
    active = controller;
    let timedOut = false;
    const timeoutMs = Math.max(250, options.timeoutMs ?? 10_000);
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const value = await options.request(controller.signal, requestGeneration);
      if (!stopped && requestGeneration === generation) options.onSuccess(value, requestGeneration);
    } catch (error) {
      if (!stopped && requestGeneration === generation && (!controller.signal.aborted || timedOut)) {
        options.onError?.(
          timedOut
            ? new ApiRequestError({ status: 408, code: 'POLL_TIMEOUT', message: `Refresh timed out after ${timeoutMs}ms` })
            : error,
          requestGeneration,
        );
      }
    } finally {
      window.clearTimeout(timeout);
      if (active === controller) active = null;
      if (!stopped && requestGeneration === generation) schedule();
    }
  };

  return {
    start() {
      if (!stopped) void run();
    },
    refresh() {
      if (stopped) return;
      clearTimer();
      generation += 1;
      active?.abort();
      active = null;
      void run();
    },
    stop() {
      stopped = true;
      generation += 1;
      clearTimer();
      active?.abort();
      active = null;
    },
    running: () => active !== null,
  };
}
