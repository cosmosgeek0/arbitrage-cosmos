import type { VolumeRuntimeForwardDetectorCut } from './forwardMeasurementRunner.js';

export const VOLUME_FORWARD_MEASUREMENT_ACTIVATION_SCHEMA =
  'volume.forward.capture-activation.v1' as const;

export const VOLUME_FORWARD_MEASUREMENT_DEFAULT_ACTIVATION = Object.freeze({
  schemaVersion: VOLUME_FORWARD_MEASUREMENT_ACTIVATION_SCHEMA,
  captureEnabled: false as const,
});

export type VolumeForwardMeasurementActivationConfig =
  | Readonly<{
      readonly schemaVersion:
        typeof VOLUME_FORWARD_MEASUREMENT_ACTIVATION_SCHEMA;
      readonly captureEnabled: false;
    }>
  | Readonly<{
      readonly schemaVersion:
        typeof VOLUME_FORWARD_MEASUREMENT_ACTIVATION_SCHEMA;
      readonly captureEnabled: true;
      readonly activationId: string;
      readonly runtimeGeneration: number;
      readonly resume: boolean;
      readonly warmupStartMs: number;
      readonly maturityAtMs: number;
      readonly detectorCadenceMs: 2_000;
    }>;

export interface VolumeForwardMeasurementTimerHandle {
  unref?: () => unknown;
}

export interface VolumeForwardMeasurementTimerPort {
  readonly setTimeout: (
    callback: () => void,
    delayMs: number,
  ) => VolumeForwardMeasurementTimerHandle;
  readonly clearTimeout: (
    handle: VolumeForwardMeasurementTimerHandle,
  ) => void;
}

export interface VolumeForwardMeasurementCapturePort {
  observe(cut: Readonly<VolumeRuntimeForwardDetectorCut>): unknown;
  advanceTime(nowMs: number): unknown;
  snapshot(): unknown;
  close(): unknown;
}

export type VolumeForwardMeasurementSchedulerState =
  | 'OFF'
  | 'WAITING'
  | 'WARMING'
  | 'CAPTURING'
  | 'READY'
  | 'FAILED'
  | 'STOPPED';

export interface VolumeForwardMeasurementSchedulerSnapshot {
  readonly schemaVersion: typeof VOLUME_FORWARD_MEASUREMENT_ACTIVATION_SCHEMA;
  readonly state: VolumeForwardMeasurementSchedulerState;
  readonly captureEnabled: boolean;
  readonly activationId: string | null;
  readonly runtimeGeneration: number | null;
  readonly resume: boolean;
  readonly warmupStartMs: number | null;
  readonly maturityAtMs: number | null;
  readonly detectorCadenceMs: number | null;
  readonly running: boolean;
  readonly disposed: boolean;
  readonly timerPending: boolean;
  readonly tickInFlight: boolean;
  readonly nextDeadlineMs: number | null;
  readonly nextCaptureCutIndex: number;
  readonly expectedCaptureCutCount: number;
  readonly forwardedCutCount: number;
  readonly overlapPreventedCount: number;
  readonly failureCount: number;
  readonly closeCount: number;
  readonly runnerState: string | null;
  readonly reasonCodes: readonly string[];
  readonly consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED';
  readonly profitabilityClaim: false;
}

const MAX_UTC_MS = 4_102_444_800_000;
const NODE_MAX_TIMEOUT_MS = 2_147_483_647;
const ACTIVATION_ID = /^ve2_activation_[a-f0-9]{64}$/;
const RUNNER_STATES = new Set([
  'SCHEDULED',
  'WARMING',
  'CAPTURING',
  'READY_TO_TERMINALIZE',
  'FAILED',
]);

function plainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  return JSON.stringify(Object.keys(value).sort())
    === JSON.stringify([...keys].sort());
}

function safeUtcMs(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_UTC_MS
    && !Object.is(value, -0);
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1
    && !Object.is(value, -0);
}

function synchronous(result: unknown): boolean {
  return !(
    result !== null
    && (
      typeof result === 'object'
      || typeof result === 'function'
    )
    && typeof (result as PromiseLike<unknown>).then === 'function'
  );
}

export function validateVolumeForwardMeasurementActivation(
  value: unknown,
): Readonly<VolumeForwardMeasurementActivationConfig> {
  if (value === undefined) {
    return VOLUME_FORWARD_MEASUREMENT_DEFAULT_ACTIVATION;
  }
  if (
    !plainRecord(value)
    || value.schemaVersion
      !== VOLUME_FORWARD_MEASUREMENT_ACTIVATION_SCHEMA
    || typeof value.captureEnabled !== 'boolean'
  ) {
    throw new TypeError('VOLUME_FORWARD_MEASUREMENT_ACTIVATION_INVALID');
  }
  if (value.captureEnabled === false) {
    if (!exactKeys(value, ['captureEnabled', 'schemaVersion'])) {
      throw new TypeError('VOLUME_FORWARD_MEASUREMENT_ACTIVATION_INVALID');
    }
    return VOLUME_FORWARD_MEASUREMENT_DEFAULT_ACTIVATION;
  }
  if (
    !exactKeys(value, [
      'activationId',
      'captureEnabled',
      'detectorCadenceMs',
      'maturityAtMs',
      'resume',
      'runtimeGeneration',
      'schemaVersion',
      'warmupStartMs',
    ])
    || typeof value.activationId !== 'string'
    || !ACTIVATION_ID.test(value.activationId)
    || !positiveSafeInteger(value.runtimeGeneration)
    || typeof value.resume !== 'boolean'
    || !safeUtcMs(value.warmupStartMs)
    || !safeUtcMs(value.maturityAtMs)
    || value.maturityAtMs <= value.warmupStartMs
    || value.detectorCadenceMs !== 2_000
    || (value.maturityAtMs - value.warmupStartMs)
      % value.detectorCadenceMs !== 0
  ) {
    throw new TypeError('VOLUME_FORWARD_MEASUREMENT_ACTIVATION_INVALID');
  }
  return Object.freeze({
    schemaVersion: VOLUME_FORWARD_MEASUREMENT_ACTIVATION_SCHEMA,
    captureEnabled: true,
    activationId: value.activationId,
    runtimeGeneration: value.runtimeGeneration,
    resume: value.resume,
    warmupStartMs: value.warmupStartMs,
    maturityAtMs: value.maturityAtMs,
    detectorCadenceMs: 2_000,
  });
}

interface RunnerSnapshot {
  readonly state: string;
  readonly activationId: string;
  readonly recordedWarmupCutCount: number;
  readonly expectedWarmupCutCount: number;
  readonly recordedDetectorCutCount: number;
  readonly expectedDetectorCutCount: number;
  readonly runtimeGeneration: number | null;
}

function runnerSnapshot(value: unknown): Readonly<RunnerSnapshot> {
  if (
    !plainRecord(value)
    || typeof value.state !== 'string'
    || !RUNNER_STATES.has(value.state)
    || typeof value.activationId !== 'string'
    || !ACTIVATION_ID.test(value.activationId)
    || !Number.isSafeInteger(value.recordedWarmupCutCount)
    || (value.recordedWarmupCutCount as number) < 0
    || !Number.isSafeInteger(value.expectedWarmupCutCount)
    || (value.expectedWarmupCutCount as number) < 1
    || (value.recordedWarmupCutCount as number)
      > (value.expectedWarmupCutCount as number)
    || !Number.isSafeInteger(value.recordedDetectorCutCount)
    || (value.recordedDetectorCutCount as number) < 0
    || !Number.isSafeInteger(value.expectedDetectorCutCount)
    || (value.expectedDetectorCutCount as number) < 1
    || (value.recordedDetectorCutCount as number)
      > (value.expectedDetectorCutCount as number)
    || (
      value.runtimeGeneration !== null
      && !positiveSafeInteger(value.runtimeGeneration)
    )
  ) {
    throw new TypeError('VOLUME_FORWARD_MEASUREMENT_RUNNER_SNAPSHOT_INVALID');
  }
  return Object.freeze({
    state: value.state,
    activationId: value.activationId,
    recordedWarmupCutCount: value.recordedWarmupCutCount as number,
    expectedWarmupCutCount: value.expectedWarmupCutCount as number,
    recordedDetectorCutCount: value.recordedDetectorCutCount as number,
    expectedDetectorCutCount: value.expectedDetectorCutCount as number,
    runtimeGeneration: value.runtimeGeneration as number | null,
  });
}

function validateCapturePort(
  value: unknown,
): Readonly<VolumeForwardMeasurementCapturePort> {
  if (
    !plainRecord(value)
    || typeof value.observe !== 'function'
    || typeof value.advanceTime !== 'function'
    || typeof value.snapshot !== 'function'
    || typeof value.close !== 'function'
  ) {
    throw new TypeError('VOLUME_FORWARD_MEASUREMENT_CAPTURE_PORT_INVALID');
  }
  return Object.freeze({
    observe: value.observe.bind(value),
    advanceTime: value.advanceTime.bind(value),
    snapshot: value.snapshot.bind(value),
    close: value.close.bind(value),
  });
}

function validateTimerPort(
  value: unknown,
): Readonly<VolumeForwardMeasurementTimerPort> {
  if (
    value === null
    || (typeof value !== 'object' && typeof value !== 'function')
  ) {
    throw new TypeError('VOLUME_FORWARD_MEASUREMENT_TIMER_PORT_INVALID');
  }
  const port = value as Readonly<Record<string, unknown>>;
  if (
    typeof port.setTimeout !== 'function'
    || typeof port.clearTimeout !== 'function'
  ) {
    throw new TypeError('VOLUME_FORWARD_MEASUREMENT_TIMER_PORT_INVALID');
  }
  return Object.freeze({
    setTimeout: port.setTimeout.bind(value) as
      VolumeForwardMeasurementTimerPort['setTimeout'],
    clearTimeout: port.clearTimeout.bind(value) as
      VolumeForwardMeasurementTimerPort['clearTimeout'],
  });
}

class VolumeForwardMeasurementScheduler {
  private state: VolumeForwardMeasurementSchedulerState;
  private readonly config:
    Readonly<VolumeForwardMeasurementActivationConfig>;
  private readonly capture: Readonly<VolumeForwardMeasurementCapturePort> | null;
  private readonly clock: () => number;
  private readonly timers: Readonly<VolumeForwardMeasurementTimerPort>;
  private readonly runDetectorTick: (
    captureCut: boolean,
    admittedAtMs: number,
  ) => unknown;
  private readonly onCaptureDetached: () => unknown;
  private readonly reasons = new Set<string>();
  private running = false;
  private disposed = false;
  private epoch = 0;
  private timer: VolumeForwardMeasurementTimerHandle | null = null;
  private timerToken: number | null = null;
  private nextTimerToken = 0;
  private tickInFlight = false;
  private captureTickOpen = false;
  private captureForwarded = false;
  private nextDeadlineMs: number | null = null;
  private nextCaptureCutIndex = 0;
  private expectedCaptureCutCount = 0;
  private expectedWarmupCutCount = 0;
  private expectedDetectorCutCount = 0;
  private forwardedCutCount = 0;
  private overlapPreventedCount = 0;
  private failureCount = 0;
  private closeCount = 0;
  private detached = false;
  private lastNowMs: number | null = null;
  private runnerState: string | null = null;

  constructor(input: Readonly<{
    readonly config?: unknown;
    readonly capture?: unknown;
    readonly clock: () => number;
    readonly timers: unknown;
    readonly runDetectorTick: (
      captureCut: boolean,
      admittedAtMs: number,
    ) => unknown;
    readonly onCaptureDetached?: () => unknown;
  }>) {
    if (
      !plainRecord(input)
      || typeof input.clock !== 'function'
      || typeof input.runDetectorTick !== 'function'
      || (
        input.onCaptureDetached !== undefined
        && typeof input.onCaptureDetached !== 'function'
      )
    ) {
      throw new TypeError('VOLUME_FORWARD_MEASUREMENT_SCHEDULER_INPUT_INVALID');
    }
    this.config = validateVolumeForwardMeasurementActivation(input.config);
    this.clock = input.clock;
    this.timers = validateTimerPort(input.timers);
    this.runDetectorTick = input.runDetectorTick;
    this.onCaptureDetached = input.onCaptureDetached ?? (() => {});
    if (!this.config.captureEnabled) {
      if (input.capture !== undefined) {
        throw new TypeError(
          'VOLUME_FORWARD_MEASUREMENT_CAPTURE_WITHOUT_ACTIVATION',
        );
      }
      this.capture = null;
      this.state = 'OFF';
      this.reasons.add('CAPTURE_ACTIVATION_OFF');
      return;
    }
    this.capture = validateCapturePort(input.capture);
    const initial = runnerSnapshot(this.capture.snapshot());
    this.expectedWarmupCutCount = initial.expectedWarmupCutCount;
    this.expectedDetectorCutCount = initial.expectedDetectorCutCount;
    this.nextCaptureCutIndex =
      initial.recordedWarmupCutCount + initial.recordedDetectorCutCount;
    if (!this.runnerMatchesCursor(initial, this.nextCaptureCutIndex, false)) {
      throw new TypeError(
        'VOLUME_FORWARD_MEASUREMENT_ACTIVATION_RUNNER_MISMATCH',
      );
    }
    this.expectedCaptureCutCount =
      this.expectedWarmupCutCount + this.expectedDetectorCutCount;
    if (
      this.expectedCaptureCutCount
        !== (
          this.config.maturityAtMs - this.config.warmupStartMs
        ) / this.config.detectorCadenceMs
    ) {
      throw new TypeError(
        'VOLUME_FORWARD_MEASUREMENT_ACTIVATION_SCHEDULE_MISMATCH',
      );
    }
    this.runnerState = initial.state;
    this.state = 'WAITING';
    this.reasons.add('CAPTURE_SCHEDULER_NOT_STARTED');
  }

  start(): Readonly<VolumeForwardMeasurementSchedulerSnapshot> {
    if (
      !this.config.captureEnabled
      || this.disposed
      || this.running
      || this.state === 'READY'
      || this.state === 'FAILED'
      || this.state === 'STOPPED'
    ) return this.snapshot();
    this.reasons.delete('CAPTURE_SCHEDULER_NOT_STARTED');
    this.running = true;
    const epoch = ++this.epoch;
    let nowMs: number;
    try {
      nowMs = this.readNow();
    } catch {
      return this.fail('CAPTURE_CLOCK_INVALID');
    }
    this.scheduleNext(epoch, nowMs);
    return this.snapshot();
  }

  wantsDetectorCut(): boolean {
    return this.running
      && this.captureTickOpen
      && !this.captureForwarded
      && (this.state === 'WARMING' || this.state === 'CAPTURING');
  }

  observe(
    cut: Readonly<VolumeRuntimeForwardDetectorCut>,
  ): Readonly<VolumeForwardMeasurementSchedulerSnapshot> {
    if (
      !this.wantsDetectorCut()
      || this.capture === null
    ) {
      return this.fail('CAPTURE_FORWARD_OUTSIDE_SCHEDULED_TICK');
    }
    const observationEpoch = this.epoch;
    this.captureForwarded = true;
    try {
      const result = this.capture.observe(cut);
      if (
        observationEpoch !== this.epoch
        || !this.running
      ) return this.snapshot();
      if (!synchronous(result)) {
        return this.fail('CAPTURE_RUNNER_OBSERVER_ASYNC');
      }
      const observed = runnerSnapshot(this.capture.snapshot());
      this.runnerState = observed.state;
      if (observed.state === 'FAILED') {
        return this.fail('CAPTURE_RUNNER_FAILED');
      }
      if (observed.state === 'READY_TO_TERMINALIZE') {
        return this.fail('CAPTURE_RUNNER_READY_BEFORE_MATURITY');
      }
      if (
        !this.runnerMatchesCursor(
          observed,
          this.nextCaptureCutIndex + 1,
          true,
        )
      ) {
        return this.fail('CAPTURE_RUNNER_CURSOR_DRIFT');
      }
      this.state = observed.state === 'CAPTURING'
        ? 'CAPTURING'
        : 'WARMING';
      this.forwardedCutCount += 1;
      return this.snapshot();
    } catch {
      return this.fail('CAPTURE_RUNNER_OBSERVER_FAILED');
    }
  }

  failClosed(
    reasonCode: string,
  ): Readonly<VolumeForwardMeasurementSchedulerSnapshot> {
    if (
      typeof reasonCode !== 'string'
      || !/^[A-Z][A-Z0-9_]{2,127}$/.test(reasonCode)
    ) {
      return this.fail('CAPTURE_FAILURE_REASON_INVALID');
    }
    return this.fail(reasonCode);
  }

  stop(
    reasonCode = 'CAPTURE_STOP_REQUESTED',
  ): Readonly<VolumeForwardMeasurementSchedulerSnapshot> {
    if (
      this.state === 'OFF'
      || this.state === 'READY'
      || this.state === 'FAILED'
      || this.state === 'STOPPED'
    ) return this.snapshot();
    this.reasons.add(reasonCode);
    this.transitionTerminal('STOPPED');
    return this.snapshot();
  }

  dispose(): Readonly<VolumeForwardMeasurementSchedulerSnapshot> {
    if (this.disposed) return this.snapshot();
    this.disposed = true;
    if (
      this.state !== 'OFF'
      && this.state !== 'READY'
      && this.state !== 'FAILED'
      && this.state !== 'STOPPED'
    ) {
      this.reasons.add('CAPTURE_DISPOSED');
      this.transitionTerminal('STOPPED');
    } else {
      this.cancelTimer();
      this.closeCapture();
    }
    return this.snapshot();
  }

  snapshot(): Readonly<VolumeForwardMeasurementSchedulerSnapshot> {
    return Object.freeze({
      schemaVersion: VOLUME_FORWARD_MEASUREMENT_ACTIVATION_SCHEMA,
      state: this.state,
      captureEnabled: this.config.captureEnabled,
      activationId:
        this.config.captureEnabled ? this.config.activationId : null,
      runtimeGeneration:
        this.config.captureEnabled
          ? this.config.runtimeGeneration
          : null,
      resume: this.config.captureEnabled && this.config.resume,
      warmupStartMs:
        this.config.captureEnabled ? this.config.warmupStartMs : null,
      maturityAtMs:
        this.config.captureEnabled ? this.config.maturityAtMs : null,
      detectorCadenceMs:
        this.config.captureEnabled
          ? this.config.detectorCadenceMs
          : null,
      running: this.running,
      disposed: this.disposed,
      timerPending: this.timer !== null,
      tickInFlight: this.tickInFlight,
      nextDeadlineMs: this.nextDeadlineMs,
      nextCaptureCutIndex: this.nextCaptureCutIndex,
      expectedCaptureCutCount: this.expectedCaptureCutCount,
      forwardedCutCount: this.forwardedCutCount,
      overlapPreventedCount: this.overlapPreventedCount,
      failureCount: this.failureCount,
      closeCount: this.closeCount,
      runnerState: this.runnerState,
      reasonCodes: Object.freeze([...this.reasons].sort()),
      consumerGate:
        'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED' as const,
      profitabilityClaim: false as const,
    });
  }

  private readNow(): number {
    const value = this.clock();
    if (
      !safeUtcMs(value)
      || (this.lastNowMs !== null && value < this.lastNowMs)
    ) {
      throw new TypeError('capture scheduler clock invalid');
    }
    this.lastNowMs = value;
    return value;
  }

  private scheduleNext(epoch: number, nowMs: number): void {
    if (!this.running || epoch !== this.epoch) return;
    if (!this.config.captureEnabled) return;
    if (nowMs >= this.config.maturityAtMs) {
      this.advanceMaturity();
      return;
    }
    let deadlineMs: number;
    if (nowMs < this.config.warmupStartMs) {
      this.state = 'WAITING';
      deadlineMs = Math.min(
        this.config.warmupStartMs,
        nowMs + this.config.detectorCadenceMs,
      );
    } else {
      deadlineMs = this.config.warmupStartMs
        + this.nextCaptureCutIndex * this.config.detectorCadenceMs;
      if (nowMs >= deadlineMs + this.config.detectorCadenceMs) {
        this.fail('CAPTURE_DETECTOR_SLOT_MISSED');
        return;
      }
    }
    this.armTimer(epoch, deadlineMs, nowMs);
  }

  private armTimer(epoch: number, deadlineMs: number, nowMs: number): void {
    if (this.timer !== null) {
      this.fail('CAPTURE_MULTIPLE_TIMERS_FORBIDDEN');
      return;
    }
    const delayMs = Math.min(
      NODE_MAX_TIMEOUT_MS,
      Math.max(0, deadlineMs - nowMs),
    );
    let handle: VolumeForwardMeasurementTimerHandle;
    const timerToken = ++this.nextTimerToken;
    try {
      handle = this.timers.setTimeout(
        () => {
          if (
            epoch !== this.epoch
            || !this.running
          ) return;
          if (this.timerToken !== timerToken) {
            if (this.tickInFlight) this.overlapPreventedCount += 1;
            return;
          }
          if (this.tickInFlight) {
            this.overlapPreventedCount += 1;
            return;
          }
          this.timer = null;
          this.timerToken = null;
          this.nextDeadlineMs = null;
          this.tickInFlight = true;
          void this.runWake(epoch)
            .catch(() => {
              this.fail('CAPTURE_SCHEDULER_WAKE_FAILED');
            })
            .finally(() => {
              this.tickInFlight = false;
              this.captureTickOpen = false;
              this.captureForwarded = false;
            });
        },
        delayMs,
      );
      this.timer = handle;
      this.timerToken = timerToken;
      this.nextDeadlineMs = deadlineMs;
      if (typeof handle.unref === 'function') handle.unref();
    } catch {
      if (this.timer !== null) {
        try {
          this.timers.clearTimeout(this.timer);
        } catch {
          // The terminal reason below remains the authoritative failure.
        }
      }
      this.timer = null;
      this.timerToken = null;
      this.nextDeadlineMs = null;
      this.fail('CAPTURE_TIMER_SCHEDULE_FAILED');
    }
  }

  private async runWake(epoch: number): Promise<void> {
    if (epoch !== this.epoch || !this.running) return;
    let nowMs: number;
    try {
      nowMs = this.readNow();
    } catch {
      this.fail('CAPTURE_CLOCK_REGRESSED');
      return;
    }
    if (!this.config.captureEnabled) return;
    if (nowMs >= this.config.maturityAtMs) {
      this.advanceMaturity();
      return;
    }
    if (nowMs < this.config.warmupStartMs) {
      try {
        await this.runDetectorTick(false, nowMs);
      } catch {
        this.fail('CAPTURE_WAITING_DETECTOR_TICK_FAILED');
        return;
      }
      if (epoch === this.epoch && this.running) {
        let nextNowMs: number;
        try {
          nextNowMs = this.readNow();
        } catch {
          this.fail('CAPTURE_CLOCK_REGRESSED');
          return;
        }
        this.scheduleNext(epoch, nextNowMs);
      }
      return;
    }
    const deadlineMs = this.config.warmupStartMs
      + this.nextCaptureCutIndex * this.config.detectorCadenceMs;
    if (
      nowMs < deadlineMs
      || nowMs >= deadlineMs + this.config.detectorCadenceMs
    ) {
      if (nowMs < deadlineMs) {
        this.scheduleNext(epoch, nowMs);
      } else {
        this.fail('CAPTURE_DETECTOR_SLOT_MISSED');
      }
      return;
    }
    let initial: Readonly<RunnerSnapshot> | null = null;
    try {
      initial = this.capture === null
        ? null
        : runnerSnapshot(this.capture.snapshot());
    } catch {
      this.fail('CAPTURE_RUNNER_SNAPSHOT_INVALID');
      return;
    }
    if (
      initial === null
      || (
        !this.config.resume
        && this.nextCaptureCutIndex === 0
        && nowMs >= this.config.warmupStartMs
          + this.config.detectorCadenceMs
      )
    ) {
      this.fail('CAPTURE_ACTIVATION_START_MISSED');
      return;
    }
    if (
      !this.runnerMatchesCursor(
        initial,
        this.nextCaptureCutIndex,
        this.forwardedCutCount > 0,
      )
    ) {
      this.fail('CAPTURE_RUNNER_CURSOR_DRIFT');
      return;
    }
    this.state = this.nextCaptureCutIndex
      < initial.expectedWarmupCutCount
      ? 'WARMING'
      : 'CAPTURING';
    this.captureTickOpen = true;
    this.captureForwarded = false;
    try {
      await this.runDetectorTick(true, nowMs);
    } catch {
      this.fail('CAPTURE_DETECTOR_TICK_FAILED');
      return;
    }
    if (epoch !== this.epoch || !this.running) return;
    if (!this.captureForwarded) {
      this.fail('CAPTURE_DETECTOR_CUT_NOT_FORWARDED');
      return;
    }
    this.captureTickOpen = false;
    this.nextCaptureCutIndex += 1;
    let nextNowMs: number;
    try {
      nextNowMs = this.readNow();
    } catch {
      this.fail('CAPTURE_CLOCK_REGRESSED');
      return;
    }
    this.scheduleNext(epoch, nextNowMs);
  }

  private advanceMaturity(): void {
    if (
      !this.running
      || !this.config.captureEnabled
      || this.capture === null
    ) return;
    let nowMs: number;
    try {
      nowMs = this.readNow();
      const result = this.capture.advanceTime(nowMs);
      if (!synchronous(result)) {
        this.fail('CAPTURE_RUNNER_ADVANCE_ASYNC');
        return;
      }
      const observed = runnerSnapshot(this.capture.snapshot());
      this.runnerState = observed.state;
      if (observed.state === 'READY_TO_TERMINALIZE') {
        if (
          !this.runnerMatchesCursor(
            observed,
            this.expectedCaptureCutCount,
            this.forwardedCutCount > 0,
          )
        ) {
          this.fail('CAPTURE_RUNNER_CURSOR_DRIFT_AT_MATURITY');
          return;
        }
        this.transitionTerminal('READY');
        return;
      }
      if (observed.state === 'FAILED') {
        this.fail('CAPTURE_RUNNER_FAILED_AT_MATURITY');
        return;
      }
      this.fail('CAPTURE_INCOMPLETE_AT_MATURITY');
    } catch {
      this.fail('CAPTURE_RUNNER_ADVANCE_FAILED');
    }
  }

  private runnerMatchesCursor(
    observed: Readonly<RunnerSnapshot>,
    expectedRecordedCutCount: number,
    currentGenerationRequired: boolean,
  ): boolean {
    if (!this.config.captureEnabled) return false;
    const expectedWarmupRecorded = Math.min(
      expectedRecordedCutCount,
      this.expectedWarmupCutCount,
    );
    const expectedDetectorRecorded = Math.max(
      0,
      expectedRecordedCutCount - this.expectedWarmupCutCount,
    );
    const expectedState =
      expectedRecordedCutCount === 0
        ? 'SCHEDULED'
        : expectedDetectorRecorded === 0
        ? 'WARMING'
        : 'CAPTURING';
    const expectedRuntimeGeneration = currentGenerationRequired
      ? this.config.runtimeGeneration
      : this.config.resume
      ? this.config.runtimeGeneration - 1
      : null;
    return observed.activationId === this.config.activationId
      && observed.expectedWarmupCutCount
        === this.expectedWarmupCutCount
      && observed.expectedDetectorCutCount
        === this.expectedDetectorCutCount
      && observed.recordedWarmupCutCount === expectedWarmupRecorded
      && observed.recordedDetectorCutCount === expectedDetectorRecorded
      && observed.runtimeGeneration === expectedRuntimeGeneration
      && (
        observed.state === expectedState
        || (
          expectedRecordedCutCount === this.expectedCaptureCutCount
          && observed.state === 'READY_TO_TERMINALIZE'
        )
      );
  }

  private fail(
    reasonCode: string,
  ): Readonly<VolumeForwardMeasurementSchedulerSnapshot> {
    if (
      this.state === 'OFF'
      || this.state === 'READY'
      || this.state === 'FAILED'
      || this.state === 'STOPPED'
    ) return this.snapshot();
    this.failureCount += 1;
    this.reasons.add(reasonCode);
    this.transitionTerminal('FAILED');
    return this.snapshot();
  }

  private transitionTerminal(
    state: 'READY' | 'FAILED' | 'STOPPED',
  ): void {
    this.running = false;
    this.captureTickOpen = false;
    this.captureForwarded = false;
    this.epoch += 1;
    this.state = state;
    this.cancelTimer();
    this.closeCapture();
    this.detach();
  }

  private cancelTimer(): void {
    if (this.timer === null) {
      this.timerToken = null;
      this.nextDeadlineMs = null;
      return;
    }
    const handle = this.timer;
    this.timer = null;
    this.timerToken = null;
    this.nextDeadlineMs = null;
    try {
      this.timers.clearTimeout(handle);
    } catch {
      this.reasons.add('CAPTURE_TIMER_CANCEL_FAILED');
      this.failureCount += 1;
      this.state = 'FAILED';
    }
  }

  private closeCapture(): void {
    if (this.capture === null || this.closeCount !== 0) return;
    this.closeCount = 1;
    try {
      const result = this.capture.close();
      if (!synchronous(result)) {
        throw new TypeError('capture close must be synchronous');
      }
    } catch {
      this.reasons.add('CAPTURE_OWNER_CLOSE_FAILED');
      this.failureCount += 1;
      this.state = 'FAILED';
    }
  }

  private detach(): void {
    if (this.detached) return;
    this.detached = true;
    try {
      const result = this.onCaptureDetached();
      if (!synchronous(result)) {
        throw new TypeError('capture detach must be synchronous');
      }
    } catch {
      this.reasons.add('CAPTURE_DETACH_FAILED');
      this.failureCount += 1;
      this.state = 'FAILED';
    }
  }
}

export function createVolumeForwardMeasurementScheduler(
  input: Readonly<{
    readonly config?: unknown;
    readonly capture?: unknown;
    readonly clock: () => number;
    readonly timers: unknown;
    readonly runDetectorTick: (
      captureCut: boolean,
      admittedAtMs: number,
    ) => unknown;
    readonly onCaptureDetached?: () => unknown;
  }>,
): Readonly<{
  readonly start: () =>
    Readonly<VolumeForwardMeasurementSchedulerSnapshot>;
  readonly wantsDetectorCut: () => boolean;
  readonly observe: (
    cut: Readonly<VolumeRuntimeForwardDetectorCut>,
  ) => Readonly<VolumeForwardMeasurementSchedulerSnapshot>;
  readonly failClosed: (
    reasonCode: string,
  ) => Readonly<VolumeForwardMeasurementSchedulerSnapshot>;
  readonly stop: (
    reasonCode?: string,
  ) => Readonly<VolumeForwardMeasurementSchedulerSnapshot>;
  readonly dispose: () =>
    Readonly<VolumeForwardMeasurementSchedulerSnapshot>;
  readonly snapshot: () =>
    Readonly<VolumeForwardMeasurementSchedulerSnapshot>;
}> {
  const scheduler = new VolumeForwardMeasurementScheduler(input);
  return Object.freeze({
    start: () => scheduler.start(),
    wantsDetectorCut: () => scheduler.wantsDetectorCut(),
    observe: (cut) => scheduler.observe(cut),
    failClosed: (reasonCode) => scheduler.failClosed(reasonCode),
    stop: (reasonCode) => scheduler.stop(reasonCode),
    dispose: () => scheduler.dispose(),
    snapshot: () => scheduler.snapshot(),
  });
}
