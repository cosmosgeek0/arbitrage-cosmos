/** Bounded pre-trigger/post-trigger capture state machine. */
import { canonicalJson, isValidUtcMillis, ok, type ContractResult } from '../contracts/index.js';
import { createReplayEnvelope } from './envelope.js';
import { createReplayEvent, createReplayTrigger, safeReplayCorrelationId } from './event.js';
import { replayFailure, REPLAY_FAILURE_CODES } from './failures.js';
import { utf8ByteLength } from './guard.js';
import { BoundedRingBuffer } from './ringBuffer.js';
import {
  MAX_REPLAY_POST_TRIGGER_EVENTS,
  MAX_REPLAY_RETAINED_EVENT_BYTES,
  MAX_REPLAY_RING_CAPACITY,
  REPLAY_SCHEMA,
  REPLAY_SCHEMA_VERSION,
  isValidReplayCaptureId,
  type ReplayCaptureConfig,
  type ReplayCaptureSnapshot,
  type ReplayCaptureState,
  type ReplayEnvelopeV1,
  type ReplayEvent,
  type ReplayEventInput,
  type ReplayTrigger,
  type ReplayTriggerInput,
} from './types.js';

const CONFIG_KEYS = [
  'captureId',
  'startedAtMs',
  'preTriggerCapacity',
  'postTriggerEventLimit',
] as const;

/** Descriptor-only config validation; accessors and hidden/symbol fields fail. */
function normalizeConfig(config: ReplayCaptureConfig): Readonly<ReplayCaptureConfig> | null {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return null;
  const proto = Object.getPrototypeOf(config);
  if (proto !== Object.prototype && proto !== null) return null;
  const ownKeys = Reflect.ownKeys(config);
  if (ownKeys.length !== CONFIG_KEYS.length || ownKeys.some((key) => typeof key !== 'string')) return null;
  const values: Record<string, unknown> = {};
  for (const key of CONFIG_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(config, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) return null;
    values[key] = descriptor.value;
  }
  if (
    !isValidReplayCaptureId(values.captureId) ||
    !isValidUtcMillis(values.startedAtMs) ||
    !Number.isSafeInteger(values.preTriggerCapacity) ||
    (values.preTriggerCapacity as number) < 1 ||
    (values.preTriggerCapacity as number) > MAX_REPLAY_RING_CAPACITY ||
    !Number.isSafeInteger(values.postTriggerEventLimit) ||
    (values.postTriggerEventLimit as number) < 0 ||
    (values.postTriggerEventLimit as number) > MAX_REPLAY_POST_TRIGGER_EVENTS
  ) return null;
  return Object.freeze(values as unknown as ReplayCaptureConfig);
}

interface CapturedEventEntry {
  event: Readonly<ReplayEvent>;
  canonicalBytes: number;
}

export class PrePostReplayCapture {
  readonly #config: Readonly<ReplayCaptureConfig>;
  readonly #preEvents: BoundedRingBuffer<Readonly<CapturedEventEntry>>;
  readonly #postEvents: Readonly<CapturedEventEntry>[] = [];
  #trigger: Readonly<ReplayTrigger> | null = null;
  #state: ReplayCaptureState = 'ARMED';
  #finalEnvelope: Readonly<ReplayEnvelopeV1> | null = null;
  #retainedEventBytes = 0;
  #lastOperationNowMs: number;

  constructor(config: ReplayCaptureConfig, nowMs: number) {
    const normalized = normalizeConfig(config);
    if (!normalized || !isValidUtcMillis(nowMs) || nowMs < normalized.startedAtMs) {
      throw new TypeError(
        `PrePostReplayCapture: invalid config/clock (safe ID, pre 1..${MAX_REPLAY_RING_CAPACITY}, post 0..${MAX_REPLAY_POST_TRIGGER_EVENTS})`,
      );
    }
    this.#config = normalized;
    this.#preEvents = new BoundedRingBuffer(normalized.preTriggerCapacity);
    this.#lastOperationNowMs = nowMs;
  }

  get state(): ReplayCaptureState {
    return this.#state;
  }

  snapshot(): Readonly<ReplayCaptureSnapshot> {
    return Object.freeze({
      captureId: this.#config.captureId,
      state: this.#state,
      preTriggerCapacity: this.#config.preTriggerCapacity,
      preTriggerObservedCount: this.#preEvents.totalPushed,
      preTriggerRetainedCount: this.#preEvents.size,
      preTriggerDroppedCount: this.#preEvents.droppedCount,
      postTriggerEventLimit: this.#config.postTriggerEventLimit,
      postTriggerCapturedCount: this.#postEvents.length,
      trigger: this.#trigger,
    });
  }

  record(
    input: ReplayEventInput,
    nowMs: number,
  ): ContractResult<Readonly<ReplayEvent>> {
    if (!isValidUtcMillis(nowMs)) {
      throw new TypeError('PrePostReplayCapture.record: nowMs must come from an injected clock');
    }
    const correlationId = safeReplayCorrelationId(input);
    if (this.#state === 'READY' || this.#state === 'FINALIZED') {
      return replayFailure({
        stage: 'captureEvent',
        code: REPLAY_FAILURE_CODES.CAPTURE_COMPLETE,
        message: 'capture is complete; further events are rejected',
        nowMs,
        correlationId,
        safeCurrentState: this.#state,
      });
    }
    if (nowMs < this.#lastOperationNowMs) {
      return replayFailure({
        stage: 'captureEvent',
        code: REPLAY_FAILURE_CODES.CAPTURE_STATE_INVALID,
        message: 'injected capture clock moved backwards',
        nowMs,
        correlationId,
        safeCurrentState: this.#state,
      });
    }

    const phase = this.#state === 'ARMED' ? 'PRE_TRIGGER' : 'POST_TRIGGER';
    const created = createReplayEvent(input, phase, nowMs);
    if (!created.ok) return created;
    const receivedAtMs = created.value.timestamp.receivedAtMs;
    if (
      receivedAtMs < this.#config.startedAtMs ||
      receivedAtMs > nowMs ||
      (phase === 'POST_TRIGGER' && receivedAtMs < (this.#trigger as ReplayTrigger).receivedAtMs)
    ) {
      return replayFailure({
        stage: 'captureEvent',
        code: REPLAY_FAILURE_CODES.EVENT_INVALID,
        message: 'event receipt time is outside its capture phase or ahead of the injected clock',
        nowMs,
        correlationId: created.value.correlationId,
        safeCurrentState: this.#state,
      });
    }

    const entry: Readonly<CapturedEventEntry> = Object.freeze({
      event: created.value,
      canonicalBytes: utf8ByteLength(canonicalJson(created.value)),
    });
    const evictedBytes =
      phase === 'PRE_TRIGGER' && this.#preEvents.size === this.#preEvents.capacity
        ? this.#preEvents.values()[0].canonicalBytes
        : 0;
    const projectedBytes = this.#retainedEventBytes - evictedBytes + entry.canonicalBytes;
    if (projectedBytes > MAX_REPLAY_RETAINED_EVENT_BYTES) {
      return replayFailure({
        stage: 'captureEvent',
        code: REPLAY_FAILURE_CODES.ENVELOPE_TOO_LARGE,
        message: `retained replay events would exceed ${MAX_REPLAY_RETAINED_EVENT_BYTES} canonical UTF-8 bytes`,
        nowMs,
        correlationId: created.value.correlationId,
        safeCurrentState: this.#state,
        recommendedOperatorAction: 'Reduce payload size or capture bounds before recording more events.',
      });
    }

    if (phase === 'PRE_TRIGGER') {
      this.#preEvents.push(entry);
    } else {
      this.#postEvents.push(entry);
      if (this.#postEvents.length === this.#config.postTriggerEventLimit) this.#state = 'READY';
    }
    this.#retainedEventBytes = projectedBytes;
    this.#lastOperationNowMs = nowMs;
    return created;
  }

  trigger(
    input: ReplayTriggerInput,
    nowMs: number,
  ): ContractResult<Readonly<ReplayTrigger>> {
    if (!isValidUtcMillis(nowMs)) {
      throw new TypeError('PrePostReplayCapture.trigger: nowMs must come from an injected clock');
    }
    const correlationId = safeReplayCorrelationId(input);
    if (this.#state !== 'ARMED') {
      return replayFailure({
        stage: 'triggerCapture',
        code: REPLAY_FAILURE_CODES.CAPTURE_STATE_INVALID,
        message: `capture cannot trigger from state ${this.#state}`,
        nowMs,
        correlationId,
        safeCurrentState: this.#state,
      });
    }
    if (nowMs < this.#lastOperationNowMs) {
      return replayFailure({
        stage: 'triggerCapture',
        code: REPLAY_FAILURE_CODES.CAPTURE_STATE_INVALID,
        message: 'injected capture clock moved backwards',
        nowMs,
        correlationId,
        safeCurrentState: this.#state,
      });
    }
    const trigger = createReplayTrigger(input, nowMs);
    if (!trigger.ok) return trigger;
    if (
      trigger.value.receivedAtMs < this.#config.startedAtMs ||
      trigger.value.receivedAtMs > nowMs
    ) {
      return replayFailure({
        stage: 'triggerCapture',
        code: REPLAY_FAILURE_CODES.TRIGGER_INVALID,
        message: 'trigger receipt time is outside capture chronology or ahead of the injected clock',
        nowMs,
        correlationId: trigger.value.correlationId,
        safeCurrentState: 'ARMED',
      });
    }
    const latePreEvent = this.#preEvents
      .values()
      .find((entry) => entry.event.timestamp.receivedAtMs > trigger.value.receivedAtMs);
    if (latePreEvent) {
      return replayFailure({
        stage: 'triggerCapture',
        code: REPLAY_FAILURE_CODES.TRIGGER_INVALID,
        message: 'trigger receipt time precedes an already captured pre-trigger event',
        nowMs,
        correlationId: trigger.value.correlationId,
        safeCurrentState: 'ARMED',
      });
    }

    this.#trigger = trigger.value;
    this.#state = this.#config.postTriggerEventLimit === 0 ? 'READY' : 'CAPTURING_POST_TRIGGER';
    this.#lastOperationNowMs = nowMs;
    return trigger;
  }

  finalize(
    completedAtMs: number,
    nowMs: number,
  ): ContractResult<Readonly<ReplayEnvelopeV1>> {
    if (!isValidUtcMillis(nowMs) || !isValidUtcMillis(completedAtMs)) {
      throw new TypeError('PrePostReplayCapture.finalize: times must come from injected clocks');
    }
    if (nowMs < this.#lastOperationNowMs || completedAtMs > nowMs) {
      return replayFailure({
        stage: 'finalizeCapture',
        code: REPLAY_FAILURE_CODES.CAPTURE_STATE_INVALID,
        message: 'capture completion violates injected-clock chronology',
        nowMs,
        correlationId: this.#trigger?.correlationId ?? null,
        safeCurrentState: this.#state,
      });
    }
    if (this.#state === 'ARMED' || this.#trigger === null) {
      return replayFailure({
        stage: 'finalizeCapture',
        code: REPLAY_FAILURE_CODES.CAPTURE_STATE_INVALID,
        message: 'capture must be triggered before finalization',
        nowMs,
        correlationId: null,
        safeCurrentState: 'ARMED',
      });
    }
    if (this.#state === 'FINALIZED' && this.#finalEnvelope !== null) {
      if (completedAtMs !== this.#finalEnvelope.completedAtMs) {
        return replayFailure({
          stage: 'finalizeCapture',
          code: REPLAY_FAILURE_CODES.CAPTURE_STATE_INVALID,
          message: 'capture was already finalized at a different completion time',
          nowMs,
          correlationId: this.#trigger.correlationId,
          safeCurrentState: 'FINALIZED',
        });
      }
      this.#lastOperationNowMs = nowMs;
      return ok(this.#finalEnvelope);
    }

    const entries = [...this.#preEvents.values(), ...this.#postEvents];
    const allEvents = entries.map((entry) => entry.event);
    const latestReceipt = allEvents.reduce(
      (latest, event) => Math.max(latest, event.timestamp.receivedAtMs),
      this.#trigger.receivedAtMs,
    );
    if (completedAtMs < latestReceipt || completedAtMs < this.#config.startedAtMs) {
      return replayFailure({
        stage: 'finalizeCapture',
        code: REPLAY_FAILURE_CODES.CAPTURE_STATE_INVALID,
        message: 'completion time precedes captured evidence',
        nowMs,
        correlationId: this.#trigger.correlationId,
        safeCurrentState: this.#state,
      });
    }

    const envelope = createReplayEnvelope(
      {
        schema: REPLAY_SCHEMA,
        schemaVersion: REPLAY_SCHEMA_VERSION,
        captureId: this.#config.captureId,
        authority: 'RECORDED_REPLAY',
        createdAtMs: this.#config.startedAtMs,
        completedAtMs,
        trigger: this.#trigger,
        capture: {
          preTriggerCapacity: this.#config.preTriggerCapacity,
          postTriggerEventLimit: this.#config.postTriggerEventLimit,
          preTriggerObservedCount: this.#preEvents.totalPushed,
          preTriggerRetainedCount: this.#preEvents.size,
          preTriggerDroppedCount: this.#preEvents.droppedCount,
          postTriggerCapturedCount: this.#postEvents.length,
          postTriggerComplete: this.#postEvents.length === this.#config.postTriggerEventLimit,
          eventCount: allEvents.length,
        },
        events: allEvents,
      },
      nowMs,
    );
    if (!envelope.ok) return envelope;
    this.#finalEnvelope = envelope.value;
    this.#state = 'FINALIZED';
    this.#lastOperationNowMs = nowMs;
    return envelope;
  }
}

export function createPrePostReplayCapture(
  config: ReplayCaptureConfig,
  nowMs: number,
): ContractResult<PrePostReplayCapture> {
  if (!isValidUtcMillis(nowMs)) {
    throw new TypeError('createPrePostReplayCapture: nowMs must come from an injected clock');
  }
  const normalized = normalizeConfig(config);
  if (!normalized || normalized.startedAtMs > nowMs) {
    return replayFailure({
      stage: 'createCapture',
      code: REPLAY_FAILURE_CODES.CAPTURE_CONFIG_INVALID,
      message: `capture config requires a safe opaque ID, start not ahead of now, pre capacity 1..${MAX_REPLAY_RING_CAPACITY}, and post limit 0..${MAX_REPLAY_POST_TRIGGER_EVENTS}`,
      nowMs,
      correlationId: null,
      safeCurrentState: 'CAPTURE_NOT_CREATED',
      recommendedOperatorAction: 'Fix the bounded capture configuration and injected-clock chronology.',
    });
  }
  return ok(new PrePostReplayCapture(normalized, nowMs));
}
