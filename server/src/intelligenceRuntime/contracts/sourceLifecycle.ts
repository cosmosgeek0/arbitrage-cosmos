import { canonicalJson } from '../../intelligenceFoundation/contracts/index.js';
import type {
  RuntimeBackoffState,
  RuntimeClock,
  RuntimeError,
  RuntimeLifecycleState,
  RuntimeRateBudgetState,
  RuntimeSourceDefinition,
  RuntimeSourceSnapshot,
} from './types.js';

const ZERO_BACKOFF: RuntimeBackoffState = Object.freeze({
  attempt: 0,
  ceiling: 0,
  delayMs: null,
  retryAtMs: null,
  cooldownUntilMs: null,
});

const UNKNOWN_RATE_BUDGET: RuntimeRateBudgetState = Object.freeze({
  state: 'UNKNOWN',
  usedWeight: null,
  limit: null,
  intervalMs: null,
  resetsAtMs: null,
  retryAfterMs: null,
  observedAtMs: null,
});

function nonNegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return value;
}

function optionalTime(value: number | null, name: string): number | null {
  if (value === null) return null;
  return nonNegativeSafeInteger(value, name);
}

function validateDefinition(value: RuntimeSourceDefinition): RuntimeSourceDefinition {
  if (typeof value.sourceId !== 'string' || value.sourceId.length < 3 || value.sourceId.length > 256) {
    throw new TypeError('sourceId must be a bounded non-empty string');
  }
  nonNegativeSafeInteger(value.silentAfterMs, 'silentAfterMs');
  nonNegativeSafeInteger(value.staleAfterMs, 'staleAfterMs');
  nonNegativeSafeInteger(value.maximumFutureSkewMs, 'maximumFutureSkewMs');
  nonNegativeSafeInteger(value.retryCeiling, 'retryCeiling');
  if (value.silentAfterMs === 0 || value.staleAfterMs < value.silentAfterMs) {
    throw new TypeError('source freshness thresholds are invalid');
  }
  return Object.freeze({ ...value });
}

export class SourceLifecycleTracker {
  readonly #definition: RuntimeSourceDefinition;
  readonly #clock: RuntimeClock;
  #desiredState: 'STOPPED' | 'RUNNING' = 'STOPPED';
  #observedState: RuntimeLifecycleState = 'STOPPED';
  #connectionGeneration = 0;
  #connectedAtMs: number | null = null;
  #lastMessageSourceTimeMs: number | null = null;
  #lastMessageReceiveTimeMs: number | null = null;
  #lastProcessedTimeMs: number | null = null;
  #messageCount = 0;
  #invalidCount = 0;
  #duplicateCount = 0;
  #outOfOrderCount = 0;
  #sequenceGapCount = 0;
  #droppedCount = 0;
  #coalescedCount = 0;
  #reconnectCount = 0;
  #backoff: RuntimeBackoffState;
  #rateBudget: RuntimeRateBudgetState = { ...UNKNOWN_RATE_BUDGET };
  #lastError: RuntimeError | null = null;
  #completeness: RuntimeSourceSnapshot['completeness'] = 'MISSING';

  constructor(definition: RuntimeSourceDefinition, clock: RuntimeClock) {
    this.#definition = validateDefinition(definition);
    if (typeof clock?.nowMs !== 'function') throw new TypeError('runtime clock is required');
    this.#clock = clock;
    this.#backoff = { ...ZERO_BACKOFF, ceiling: definition.retryCeiling };
  }

  start(): number {
    if (this.#desiredState === 'RUNNING') return this.#connectionGeneration;
    this.#desiredState = 'RUNNING';
    this.#observedState = 'CONNECTING';
    this.#connectionGeneration += 1;
    this.#connectedAtMs = null;
    this.#lastError = null;
    return this.#connectionGeneration;
  }

  connected(generation: number, connectedAtMs = this.#clock.nowMs()): boolean {
    optionalTime(connectedAtMs, 'connectedAtMs');
    if (generation !== this.#connectionGeneration || this.#desiredState === 'STOPPED') return false;
    this.#connectedAtMs = connectedAtMs;
    this.#observedState = 'WARMING';
    return true;
  }

  message(input: {
    generation: number;
    sourceTimeMs: number | null;
    receiveTimeMs: number;
  }): boolean {
    optionalTime(input.sourceTimeMs, 'sourceTimeMs');
    optionalTime(input.receiveTimeMs, 'receiveTimeMs');
    const now = nonNegativeSafeInteger(this.#clock.nowMs(), 'clock.nowMs');
    if (input.receiveTimeMs > now + this.#definition.maximumFutureSkewMs) {
      throw new TypeError('receiveTimeMs exceeds maximum future skew');
    }
    if (input.sourceTimeMs !== null && input.sourceTimeMs > input.receiveTimeMs + this.#definition.maximumFutureSkewMs) {
      throw new TypeError('sourceTimeMs exceeds maximum future skew');
    }
    if (input.generation !== this.#connectionGeneration || this.#desiredState === 'STOPPED') return false;
    this.#lastMessageSourceTimeMs = input.sourceTimeMs;
    this.#lastMessageReceiveTimeMs = input.receiveTimeMs;
    this.#messageCount += 1;
    this.#observedState = 'LIVE';
    this.#completeness = 'COMPLETE';
    this.#lastError = null;
    return true;
  }

  processed(generation: number, processedAtMs = this.#clock.nowMs()): boolean {
    optionalTime(processedAtMs, 'processedAtMs');
    if (generation !== this.#connectionGeneration || this.#desiredState === 'STOPPED') return false;
    if (this.#lastMessageReceiveTimeMs !== null && processedAtMs < this.#lastMessageReceiveTimeMs) {
      throw new TypeError('processedAtMs precedes receive time');
    }
    this.#lastProcessedTimeMs = processedAtMs;
    return true;
  }

  count(kind: 'invalid' | 'duplicate' | 'outOfOrder' | 'sequenceGap' | 'dropped' | 'coalesced', amount = 1): void {
    nonNegativeSafeInteger(amount, 'counter amount');
    if (amount === 0) return;
    if (kind === 'invalid') this.#invalidCount += amount;
    else if (kind === 'duplicate') this.#duplicateCount += amount;
    else if (kind === 'outOfOrder') this.#outOfOrderCount += amount;
    else if (kind === 'sequenceGap') this.#sequenceGapCount += amount;
    else if (kind === 'dropped') this.#droppedCount += amount;
    else this.#coalescedCount += amount;
    this.#observedState = 'DEGRADED';
    this.#completeness = 'PARTIAL';
  }

  backoff(input: { attempt: number; delayMs: number; retryAtMs: number; cooldownUntilMs?: number | null }): void {
    nonNegativeSafeInteger(input.attempt, 'attempt');
    nonNegativeSafeInteger(input.delayMs, 'delayMs');
    nonNegativeSafeInteger(input.retryAtMs, 'retryAtMs');
    optionalTime(input.cooldownUntilMs ?? null, 'cooldownUntilMs');
    if (input.attempt > this.#definition.retryCeiling) throw new TypeError('backoff attempt exceeds retry ceiling');
    this.#backoff = {
      attempt: input.attempt,
      ceiling: this.#definition.retryCeiling,
      delayMs: input.delayMs,
      retryAtMs: input.retryAtMs,
      cooldownUntilMs: input.cooldownUntilMs ?? null,
    };
    this.#observedState = 'BACKING_OFF';
  }

  rateLimited(rateBudget: RuntimeRateBudgetState): void {
    this.setRateBudget(rateBudget);
    this.#observedState = 'RATE_LIMITED';
    this.#completeness = 'PARTIAL';
  }

  setRateBudget(rateBudget: RuntimeRateBudgetState): void {
    optionalTime(rateBudget.observedAtMs, 'rateBudget.observedAtMs');
    optionalTime(rateBudget.resetsAtMs, 'rateBudget.resetsAtMs');
    optionalTime(rateBudget.retryAfterMs, 'rateBudget.retryAfterMs');
    if (rateBudget.usedWeight !== null && (!Number.isFinite(rateBudget.usedWeight) || rateBudget.usedWeight < 0)) {
      throw new TypeError('usedWeight must be finite and non-negative');
    }
    if (rateBudget.limit !== null && (!Number.isFinite(rateBudget.limit) || rateBudget.limit <= 0)) {
      throw new TypeError('rate limit must be finite and positive');
    }
    this.#rateBudget = { ...rateBudget };
  }

  fail(error: RuntimeError): void {
    nonNegativeSafeInteger(error.observedAtMs, 'error.observedAtMs');
    this.#lastError = { ...error };
    this.#observedState = 'FAILED';
    this.#completeness = 'MISSING';
  }

  reconnect(): number {
    if (this.#desiredState === 'STOPPED') return this.#connectionGeneration;
    this.#reconnectCount += 1;
    this.#connectionGeneration += 1;
    this.#connectedAtMs = null;
    this.#observedState = 'CONNECTING';
    return this.#connectionGeneration;
  }

  stop(): void {
    this.#desiredState = 'STOPPED';
    this.#observedState = 'STOPPED';
    this.#connectedAtMs = null;
    this.#backoff = { ...ZERO_BACKOFF, ceiling: this.#definition.retryCeiling };
  }

  snapshot(atMs = this.#clock.nowMs()): RuntimeSourceSnapshot {
    nonNegativeSafeInteger(atMs, 'snapshot time');
    let observedState = this.#observedState;
    if (this.#desiredState === 'RUNNING' && this.#connectedAtMs !== null) {
      if (this.#lastMessageReceiveTimeMs === null && atMs - this.#connectedAtMs >= this.#definition.silentAfterMs) {
        observedState = 'SILENT';
      } else if (
        this.#lastMessageReceiveTimeMs !== null
        && atMs - this.#lastMessageReceiveTimeMs >= this.#definition.staleAfterMs
      ) {
        observedState = 'STALE';
      }
    }
    const messageAgeMs = this.#lastMessageReceiveTimeMs === null
      ? null
      : Math.max(0, atMs - this.#lastMessageReceiveTimeMs);
    const processingLagMs = this.#lastMessageReceiveTimeMs === null || this.#lastProcessedTimeMs === null
      ? null
      : Math.max(0, this.#lastProcessedTimeMs - this.#lastMessageReceiveTimeMs);
    const recommendedAction = observedState === 'SILENT'
      ? 'Reconnect on the documented routed endpoint and require useful messages.'
      : observedState === 'STALE'
        ? 'Refresh or reconnect the source before trusting its observations.'
        : observedState === 'FAILED'
          ? this.#lastError?.recommendedAction ?? 'Inspect the source failure.'
          : observedState === 'RATE_LIMITED'
            ? 'Wait for the declared rate-budget recovery window.'
            : observedState === 'STOPPED'
              ? 'Start explicitly when this source is required.'
              : 'No operator action required.';
    return Object.freeze({
      sourceId: this.#definition.sourceId,
      transportKind: this.#definition.transportKind,
      endpointClass: this.#definition.endpointClass,
      productFamily: this.#definition.productFamily,
      desiredState: this.#desiredState,
      observedState,
      connectionGeneration: this.#connectionGeneration,
      connectedAtMs: this.#connectedAtMs,
      lastMessageSourceTimeMs: this.#lastMessageSourceTimeMs,
      lastMessageReceiveTimeMs: this.#lastMessageReceiveTimeMs,
      lastProcessedTimeMs: this.#lastProcessedTimeMs,
      messageAgeMs,
      processingLagMs,
      messageCount: this.#messageCount,
      invalidCount: this.#invalidCount,
      duplicateCount: this.#duplicateCount,
      outOfOrderCount: this.#outOfOrderCount,
      sequenceGapCount: this.#sequenceGapCount,
      droppedCount: this.#droppedCount,
      coalescedCount: this.#coalescedCount,
      reconnectCount: this.#reconnectCount,
      backoff: Object.freeze({ ...this.#backoff }),
      rateBudget: Object.freeze({ ...this.#rateBudget }),
      lastError: this.#lastError === null ? null : Object.freeze({ ...this.#lastError }),
      recommendedAction,
      authority: this.#definition.authority,
      completeness: observedState === 'SILENT' || observedState === 'STALE' ? 'PARTIAL' : this.#completeness,
      snapshotTimeMs: atMs,
    });
  }
}

export function serializeRuntimeSourceSnapshot(snapshot: RuntimeSourceSnapshot): string {
  return canonicalJson(snapshot);
}
