const MAX_UTC_MS = 8_640_000_000_000_000;

function validUtcMs(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_UTC_MS;
}

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer`);
  return value;
}

export class ManualClock {
  #nowMs;

  constructor(nowMs = 1_780_000_000_000) {
    if (!validUtcMs(nowMs)) throw new TypeError('ManualClock requires valid UTC milliseconds');
    this.#nowMs = nowMs;
    Object.seal(this);
  }

  nowMs() {
    return this.#nowMs;
  }

  set(nowMs) {
    if (!validUtcMs(nowMs)) throw new TypeError('ManualClock.set requires valid UTC milliseconds');
    if (nowMs < this.#nowMs) throw new RangeError('ManualClock cannot move backwards');
    this.#nowMs = nowMs;
    return this.#nowMs;
  }

  advance(deltaMs) {
    if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) {
      throw new TypeError('ManualClock.advance requires non-negative safe-integer milliseconds');
    }
    const next = this.#nowMs + deltaMs;
    if (!validUtcMs(next)) throw new RangeError('ManualClock advance exceeds supported UTC range');
    this.#nowMs = next;
    return this.#nowMs;
  }
}

export class ManualScheduler {
  #clock;
  #maximumTasks;
  #maximumExecutions;
  #lastNowMs;
  #nextTaskId = 1;
  #executionCount = 0;
  #tasks = new Map();

  constructor(clock, options = {}) {
    if (typeof clock?.nowMs !== 'function') throw new TypeError('ManualScheduler requires an injected clock');
    const nowMs = clock.nowMs();
    if (!validUtcMs(nowMs)) throw new TypeError('ManualScheduler clock must return valid UTC milliseconds');
    this.#clock = clock;
    this.#lastNowMs = nowMs;
    this.#maximumTasks = positiveSafeInteger(options.maximumTasks ?? 64, 'maximumTasks');
    this.#maximumExecutions = positiveSafeInteger(options.maximumExecutions ?? 10_000, 'maximumExecutions');
    Object.seal(this);
  }

  #now() {
    const nowMs = this.#clock.nowMs();
    if (!validUtcMs(nowMs)) throw new TypeError('ManualScheduler clock returned invalid UTC milliseconds');
    if (nowMs < this.#lastNowMs) throw new RangeError('ManualScheduler clock regressed');
    this.#lastNowMs = nowMs;
    return nowMs;
  }

  scheduleEvery(intervalMs, task) {
    positiveSafeInteger(intervalMs, 'intervalMs');
    if (typeof task !== 'function') throw new TypeError('scheduled task must be a function');
    if (this.#tasks.size >= this.#maximumTasks) throw new RangeError('ManualScheduler task capacity exceeded');
    const nowMs = this.#now();
    const firstDueAtMs = nowMs + intervalMs;
    if (!validUtcMs(firstDueAtMs)) throw new RangeError('scheduled task exceeds supported UTC range');
    const id = this.#nextTaskId++;
    const record = { id, intervalMs, task, nextDueAtMs: firstDueAtMs, cancelled: false, executions: 0 };
    this.#tasks.set(id, record);
    return Object.freeze({
      cancel: () => {
        if (record.cancelled) return;
        record.cancelled = true;
        this.#tasks.delete(id);
      },
    });
  }

  runDue() {
    const nowMs = this.#now();
    const due = [...this.#tasks.values()]
      .filter((record) => !record.cancelled && record.nextDueAtMs <= nowMs)
      .sort((left, right) => left.nextDueAtMs - right.nextDueAtMs || left.id - right.id);
    let ran = 0;
    for (const record of due) {
      while (!record.cancelled && record.nextDueAtMs <= nowMs) {
        if (this.#executionCount >= this.#maximumExecutions) {
          throw new RangeError('ManualScheduler execution capacity exceeded');
        }
        const result = record.task();
        if (result && typeof result.then === 'function') {
          throw new TypeError('ManualScheduler tasks must be synchronous');
        }
        record.executions += 1;
        this.#executionCount += 1;
        ran += 1;
        const next = record.nextDueAtMs + record.intervalMs;
        if (!validUtcMs(next)) throw new RangeError('scheduled recurrence exceeds supported UTC range');
        record.nextDueAtMs = next;
      }
    }
    return ran;
  }

  advanceAndRun(deltaMs) {
    this.#clock.advance(deltaMs);
    return this.runDue();
  }

  cancelAll() {
    const count = this.#tasks.size;
    for (const record of this.#tasks.values()) record.cancelled = true;
    this.#tasks.clear();
    return count;
  }

  snapshot() {
    return Object.freeze({
      activeTaskCount: this.#tasks.size,
      executionCount: this.#executionCount,
      tasks: Object.freeze([...this.#tasks.values()]
        .sort((left, right) => left.id - right.id)
        .map((record) => Object.freeze({
          id: record.id,
          intervalMs: record.intervalMs,
          nextDueAtMs: record.nextDueAtMs,
          executions: record.executions,
        }))),
    });
  }
}
