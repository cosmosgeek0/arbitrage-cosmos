import {
  canonicalJson,
  PRODUCT_FAMILIES,
  SOURCE_ENDPOINT_CLASSES,
} from '../../intelligenceFoundation/contracts/index.js';
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

const RATE_BUDGET_STATES = new Set(['AVAILABLE', 'NEAR_LIMIT', 'EXHAUSTED', 'COOLDOWN', 'UNKNOWN']);
const RATE_BUDGET_FIELDS = new Set([
  'state', 'usedWeight', 'limit', 'intervalMs', 'resetsAtMs', 'retryAfterMs', 'observedAtMs',
]);
const ERROR_FIELDS = new Set(['code', 'message', 'retryable', 'observedAtMs', 'recommendedAction']);
const DEFINITION_FIELDS = new Set([
  'sourceId', 'transportKind', 'endpointClass', 'productFamily', 'silentAfterMs', 'staleAfterMs',
  'maximumFutureSkewMs', 'retryCeiling', 'authority',
]);
const TRANSPORT_KINDS = new Set(['REST', 'WEBSOCKET', 'INJECTED']);
const RUNTIME_AUTHORITIES = new Set(['COMPLETE', 'PARTIAL', 'SAMPLED', 'UNAVAILABLE', 'UNKNOWN']);

function nonNegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return value;
}

function optionalTime(value: number | null, name: string): number | null {
  if (value === null) return null;
  return nonNegativeSafeInteger(value, name);
}

function checkedAdd(left: number, right: number, name: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} exceeds the safe integer bound`);
  return value;
}

function exactFields(value: object, allowed: ReadonlySet<string>, name: string): void {
  if (Object.getOwnPropertySymbols(value).length > 0
    || Object.keys(value).some((field) => !allowed.has(field))) {
    throw new TypeError(`${name} contains unsupported fields`);
  }
}

function boundedText(value: unknown, name: string, pattern: RegExp, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || !pattern.test(value)) {
    throw new TypeError(`${name} must be a bounded safe string`);
  }
  return value;
}

function validateDefinition(value: RuntimeSourceDefinition): RuntimeSourceDefinition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('source definition is required');
  exactFields(value, DEFINITION_FIELDS, 'source definition');
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
  if (value.silentAfterMs > 7 * 24 * 60 * 60_000
    || value.staleAfterMs > 30 * 24 * 60 * 60_000
    || value.maximumFutureSkewMs > 60_000
    || value.retryCeiling > 1_000) {
    throw new RangeError('source lifecycle policy exceeds its hard safety bound');
  }
  if (!TRANSPORT_KINDS.has(value.transportKind)) throw new TypeError('source transportKind is invalid');
  if (!SOURCE_ENDPOINT_CLASSES.includes(value.endpointClass)) throw new TypeError('source endpointClass is invalid');
  if (value.productFamily !== 'ANY' && !PRODUCT_FAMILIES.includes(value.productFamily)) {
    throw new TypeError('source productFamily is invalid');
  }
  if (!RUNTIME_AUTHORITIES.has(value.authority)) throw new TypeError('source authority is invalid');
  return Object.freeze({
    sourceId: value.sourceId,
    transportKind: value.transportKind,
    endpointClass: value.endpointClass,
    productFamily: value.productFamily,
    silentAfterMs: value.silentAfterMs,
    staleAfterMs: value.staleAfterMs,
    maximumFutureSkewMs: value.maximumFutureSkewMs,
    retryCeiling: value.retryCeiling,
    authority: value.authority,
  });
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

  #clearBackoff(): void {
    this.#backoff = { ...ZERO_BACKOFF, ceiling: this.#definition.retryCeiling };
  }

  start(): number {
    if (this.#desiredState === 'RUNNING') return this.#connectionGeneration;
    this.#desiredState = 'RUNNING';
    this.#observedState = 'CONNECTING';
    this.#connectionGeneration = checkedAdd(this.#connectionGeneration, 1, 'connectionGeneration');
    this.#connectedAtMs = null;
    this.#lastMessageSourceTimeMs = null;
    this.#lastMessageReceiveTimeMs = null;
    this.#lastProcessedTimeMs = null;
    this.#lastError = null;
    this.#completeness = 'MISSING';
    return this.#connectionGeneration;
  }

  connected(generation: number, connectedAtMs = this.#clock.nowMs()): boolean {
    optionalTime(connectedAtMs, 'connectedAtMs');
    if (connectedAtMs > nonNegativeSafeInteger(this.#clock.nowMs(), 'clock.nowMs')) {
      throw new TypeError('connectedAtMs cannot be ahead of the injected clock');
    }
    if (generation !== this.#connectionGeneration || this.#desiredState === 'STOPPED') return false;
    if (this.#connectedAtMs !== null && connectedAtMs < this.#connectedAtMs) {
      throw new TypeError('connectedAtMs regressed within the active connection generation');
    }
    this.#connectedAtMs = connectedAtMs;
    this.#observedState = 'WARMING';
    this.#clearBackoff();
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
    if (input.receiveTimeMs > now) {
      throw new TypeError('receiveTimeMs cannot be ahead of the injected clock');
    }
    if (input.sourceTimeMs !== null && input.sourceTimeMs > input.receiveTimeMs + this.#definition.maximumFutureSkewMs) {
      throw new TypeError('sourceTimeMs exceeds maximum future skew');
    }
    if (input.generation !== this.#connectionGeneration || this.#desiredState === 'STOPPED') return false;
    if (this.#lastMessageReceiveTimeMs !== null && input.receiveTimeMs < this.#lastMessageReceiveTimeMs) {
      throw new TypeError('receiveTimeMs regressed within the active connection generation');
    }
    const nextMessageCount = checkedAdd(this.#messageCount, 1, 'messageCount');
    this.#lastMessageSourceTimeMs = input.sourceTimeMs === null
      ? this.#lastMessageSourceTimeMs
      : Math.max(this.#lastMessageSourceTimeMs ?? 0, input.sourceTimeMs);
    this.#lastMessageReceiveTimeMs = input.receiveTimeMs;
    this.#messageCount = nextMessageCount;
    this.#observedState = 'LIVE';
    this.#completeness = 'COMPLETE';
    this.#lastError = null;
    this.#clearBackoff();
    return true;
  }

  processed(generation: number, processedAtMs = this.#clock.nowMs()): boolean {
    optionalTime(processedAtMs, 'processedAtMs');
    if (processedAtMs > nonNegativeSafeInteger(this.#clock.nowMs(), 'clock.nowMs')) {
      throw new TypeError('processedAtMs cannot be ahead of the injected clock');
    }
    if (generation !== this.#connectionGeneration || this.#desiredState === 'STOPPED') return false;
    if (this.#lastMessageReceiveTimeMs !== null && processedAtMs < this.#lastMessageReceiveTimeMs) {
      throw new TypeError('processedAtMs precedes receive time');
    }
    if (this.#lastProcessedTimeMs !== null && processedAtMs < this.#lastProcessedTimeMs) {
      throw new TypeError('processedAtMs regressed within the active connection generation');
    }
    this.#lastProcessedTimeMs = processedAtMs;
    if (this.#lastMessageReceiveTimeMs !== null) {
      this.#observedState = 'LIVE';
      this.#completeness = 'COMPLETE';
      this.#lastError = null;
    } else if (this.#connectedAtMs !== null) {
      this.#observedState = 'WARMING';
    }
    this.#clearBackoff();
    return true;
  }

  count(kind: 'invalid' | 'duplicate' | 'outOfOrder' | 'sequenceGap' | 'dropped' | 'coalesced', amount = 1): void {
    nonNegativeSafeInteger(amount, 'counter amount');
    if (amount === 0) return;
    if (kind === 'invalid') this.#invalidCount = checkedAdd(this.#invalidCount, amount, 'invalidCount');
    else if (kind === 'duplicate') this.#duplicateCount = checkedAdd(this.#duplicateCount, amount, 'duplicateCount');
    else if (kind === 'outOfOrder') this.#outOfOrderCount = checkedAdd(this.#outOfOrderCount, amount, 'outOfOrderCount');
    else if (kind === 'sequenceGap') this.#sequenceGapCount = checkedAdd(this.#sequenceGapCount, amount, 'sequenceGapCount');
    else if (kind === 'dropped') this.#droppedCount = checkedAdd(this.#droppedCount, amount, 'droppedCount');
    else this.#coalescedCount = checkedAdd(this.#coalescedCount, amount, 'coalescedCount');
    this.#observedState = 'DEGRADED';
    this.#completeness = 'PARTIAL';
  }

  backoff(input: { attempt: number; delayMs: number; retryAtMs: number; cooldownUntilMs?: number | null }): void {
    nonNegativeSafeInteger(input.attempt, 'attempt');
    nonNegativeSafeInteger(input.delayMs, 'delayMs');
    nonNegativeSafeInteger(input.retryAtMs, 'retryAtMs');
    optionalTime(input.cooldownUntilMs ?? null, 'cooldownUntilMs');
    if (input.attempt < 1 || input.attempt > this.#definition.retryCeiling) {
      throw new TypeError('backoff attempt must be active and within the retry ceiling');
    }
    if (input.delayMs < 1) throw new TypeError('backoff delayMs must describe an active delay');
    const now = nonNegativeSafeInteger(this.#clock.nowMs(), 'clock.nowMs');
    if (input.retryAtMs < now || input.retryAtMs - now !== input.delayMs) {
      throw new TypeError('backoff retryAtMs must equal the injected clock plus delayMs');
    }
    if (input.cooldownUntilMs !== undefined && input.cooldownUntilMs !== null
      && input.cooldownUntilMs < input.retryAtMs) {
      throw new TypeError('backoff cooldownUntilMs precedes retryAtMs');
    }
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
    if (typeof rateBudget !== 'object' || rateBudget === null || Array.isArray(rateBudget)) {
      throw new TypeError('rateBudget must be an object');
    }
    exactFields(rateBudget, RATE_BUDGET_FIELDS, 'rateBudget');
    if (!RATE_BUDGET_STATES.has(rateBudget.state)) throw new TypeError('rateBudget.state is invalid');
    optionalTime(rateBudget.observedAtMs, 'rateBudget.observedAtMs');
    optionalTime(rateBudget.resetsAtMs, 'rateBudget.resetsAtMs');
    optionalTime(rateBudget.retryAfterMs, 'rateBudget.retryAfterMs');
    if (rateBudget.usedWeight !== null && (!Number.isFinite(rateBudget.usedWeight) || rateBudget.usedWeight < 0)) {
      throw new TypeError('usedWeight must be finite and non-negative');
    }
    if (rateBudget.limit !== null && (!Number.isFinite(rateBudget.limit) || rateBudget.limit <= 0)) {
      throw new TypeError('rate limit must be finite and positive');
    }
    if (rateBudget.usedWeight !== null && rateBudget.usedWeight > 1_000_000_000) throw new RangeError('usedWeight exceeds hard bound');
    if (rateBudget.limit !== null && rateBudget.limit > 1_000_000_000) throw new RangeError('rate limit exceeds hard bound');
    if (rateBudget.intervalMs !== null
      && (!Number.isSafeInteger(rateBudget.intervalMs) || rateBudget.intervalMs < 1
        || rateBudget.intervalMs > 7 * 24 * 60 * 60_000)) {
      throw new TypeError('rateBudget.intervalMs is outside the hard bound');
    }
    if (rateBudget.observedAtMs !== null && rateBudget.resetsAtMs !== null
      && rateBudget.resetsAtMs < rateBudget.observedAtMs) {
      throw new TypeError('rateBudget.resetsAtMs precedes its observation');
    }
    if (rateBudget.retryAfterMs !== null && rateBudget.retryAfterMs > 3 * 24 * 60 * 60_000) {
      throw new RangeError('rateBudget.retryAfterMs exceeds hard bound');
    }
    if ((rateBudget.state === 'COOLDOWN') !== (rateBudget.retryAfterMs !== null)) {
      throw new TypeError('rateBudget cooldown state and retryAfterMs disagree');
    }
    const now = nonNegativeSafeInteger(this.#clock.nowMs(), 'clock.nowMs');
    if (rateBudget.observedAtMs !== null && rateBudget.observedAtMs > now) {
      throw new TypeError('rateBudget.observedAtMs cannot be ahead of the injected clock');
    }
    if (this.#rateBudget.observedAtMs !== null && rateBudget.observedAtMs !== null
      && rateBudget.observedAtMs < this.#rateBudget.observedAtMs) {
      throw new TypeError('rateBudget.observedAtMs cannot regress');
    }
    this.#rateBudget = {
      state: rateBudget.state,
      usedWeight: rateBudget.usedWeight,
      limit: rateBudget.limit,
      intervalMs: rateBudget.intervalMs,
      resetsAtMs: rateBudget.resetsAtMs,
      retryAfterMs: rateBudget.retryAfterMs,
      observedAtMs: rateBudget.observedAtMs,
    };
  }

  fail(error: RuntimeError): void {
    if (typeof error !== 'object' || error === null || Array.isArray(error)) throw new TypeError('error must be an object');
    exactFields(error, ERROR_FIELDS, 'error');
    nonNegativeSafeInteger(error.observedAtMs, 'error.observedAtMs');
    if (error.observedAtMs > nonNegativeSafeInteger(this.#clock.nowMs(), 'clock.nowMs')) {
      throw new TypeError('error.observedAtMs cannot be ahead of the injected clock');
    }
    const retainedKnowledgeTimeMs = Math.max(
      this.#connectedAtMs ?? 0,
      this.#lastMessageReceiveTimeMs ?? 0,
      this.#lastProcessedTimeMs ?? 0,
      this.#lastError?.observedAtMs ?? 0,
    );
    if (error.observedAtMs < retainedKnowledgeTimeMs) throw new TypeError('error.observedAtMs precedes retained source knowledge');
    const code = boundedText(error.code, 'error.code', /^[A-Z0-9_]+$/, 96);
    const message = boundedText(error.message, 'error.message', /^[^\r\n\t]+$/, 400);
    const recommendedAction = boundedText(
      error.recommendedAction,
      'error.recommendedAction',
      /^[^\r\n\t]+$/,
      400,
    );
    if (typeof error.retryable !== 'boolean') throw new TypeError('error.retryable must be boolean');
    this.#lastError = { code, message, retryable: error.retryable, observedAtMs: error.observedAtMs, recommendedAction };
    this.#observedState = 'FAILED';
    this.#completeness = 'MISSING';
  }

  reconnect(): number {
    if (this.#desiredState === 'STOPPED') return this.#connectionGeneration;
    this.#reconnectCount = checkedAdd(this.#reconnectCount, 1, 'reconnectCount');
    this.#connectionGeneration = checkedAdd(this.#connectionGeneration, 1, 'connectionGeneration');
    this.#connectedAtMs = null;
    this.#lastMessageSourceTimeMs = null;
    this.#lastMessageReceiveTimeMs = null;
    this.#lastProcessedTimeMs = null;
    this.#observedState = 'CONNECTING';
    this.#completeness = 'MISSING';
    return this.#connectionGeneration;
  }

  stop(): void {
    this.#desiredState = 'STOPPED';
    this.#observedState = 'STOPPED';
    this.#connectedAtMs = null;
    this.#clearBackoff();
    this.#completeness = 'MISSING';
  }

  snapshot(atMs = this.#clock.nowMs()): RuntimeSourceSnapshot {
    nonNegativeSafeInteger(atMs, 'snapshot time');
    const now = nonNegativeSafeInteger(this.#clock.nowMs(), 'clock.nowMs');
    if (atMs > now) throw new RangeError('snapshot time cannot be ahead of the injected clock');
    const retainedKnowledgeTimeMs = Math.max(
      this.#connectedAtMs ?? 0,
      this.#lastMessageReceiveTimeMs ?? 0,
      this.#lastProcessedTimeMs ?? 0,
      this.#lastError?.observedAtMs ?? 0,
      this.#rateBudget.observedAtMs ?? 0,
    );
    if (atMs < retainedKnowledgeTimeMs) throw new RangeError('snapshot time precedes retained source knowledge');
    let observedState = this.#desiredState === 'STOPPED' ? 'STOPPED' : this.#observedState;
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
    const messageAgeMs = this.#desiredState === 'STOPPED' || this.#lastMessageReceiveTimeMs === null
      ? null
      : Math.max(0, atMs - this.#lastMessageReceiveTimeMs);
    const processingLagMs = this.#desiredState === 'STOPPED'
      || this.#lastMessageReceiveTimeMs === null
      || this.#lastProcessedTimeMs === null
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
      completeness: observedState === 'STOPPED'
        ? 'MISSING'
        : observedState === 'SILENT' || observedState === 'STALE'
          ? 'PARTIAL'
          : this.#completeness,
      snapshotTimeMs: atMs,
    });
  }
}

export function serializeRuntimeSourceSnapshot(snapshot: RuntimeSourceSnapshot): string {
  return canonicalJson(snapshot);
}
