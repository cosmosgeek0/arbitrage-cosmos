/**
 * Lane G — bounded replay capture contracts.
 *
 * These are lane-local shapes built on the frozen foundation vocabulary.
 * They deliberately contain no storage implementation, clock source, timer,
 * environment access, or live authority.
 */
import type {
  ContractResult,
  DataAuthority,
  SourcedTimestamp,
  StructuredFailure,
} from '../contracts/index.js';

export const REPLAY_SCHEMA = 'cosmos.foundation.replay' as const;
export const REPLAY_SCHEMA_VERSION = 1 as const;
export const REPLAY_EVENT_VERSION = 1 as const;
export const REPLAY_TRIGGER_VERSION = 1 as const;
export const REPLAY_CHECKSUM_ALGORITHM = 'FNV1A64X2_CANONICAL_JSON_V1' as const;
export const REPLAY_CAPTURE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Hard resource bounds. Restored input is rejected before unbounded work. */
export const MAX_REPLAY_RING_CAPACITY = 10_000;
export const MAX_REPLAY_POST_TRIGGER_EVENTS = 10_000;
export const MAX_REPLAY_ENVELOPE_EVENTS =
  MAX_REPLAY_RING_CAPACITY + MAX_REPLAY_POST_TRIGGER_EVENTS;
export const MAX_REPLAY_PAYLOAD_DEPTH = 32;
export const MAX_REPLAY_PAYLOAD_NODES = 20_000;
export const MAX_REPLAY_ARRAY_LENGTH = 10_000;
export const MAX_REPLAY_OBJECT_KEYS = 1_000;
export const MAX_REPLAY_STRING_LENGTH = 262_144;
export const MAX_REPLAY_PAYLOAD_BYTES = 524_288;
export const MAX_REPLAY_ENVELOPE_BYTES = 16 * 1024 * 1024;
/** Leaves deterministic room for envelope metadata, delimiters, and checksum. */
export const MAX_REPLAY_RETAINED_EVENT_BYTES = MAX_REPLAY_ENVELOPE_BYTES - 64 * 1024;
export const MAX_REPLAY_VALIDATION_ISSUES = 64;

export const REPLAY_PHASES = ['PRE_TRIGGER', 'POST_TRIGGER'] as const;
export type ReplayPhase = (typeof REPLAY_PHASES)[number];

export const REPLAY_CAPTURE_STATES = [
  'ARMED',
  'CAPTURING_POST_TRIGGER',
  'READY',
  'FINALIZED',
] as const;
export type ReplayCaptureState = (typeof REPLAY_CAPTURE_STATES)[number];

/** Private facts are never replay-captured, even if their payload looks safe. */
export type ReplaySourceAuthority = Exclude<DataAuthority, 'LIVE_PRIVATE'>;

export type ReplayJsonPrimitive = string | number | boolean | null;
export type ReplayJsonValue =
  | ReplayJsonPrimitive
  | readonly ReplayJsonValue[]
  | { readonly [key: string]: ReplayJsonValue };

export interface ReplayEventInput {
  streamId: string;
  sequence: number;
  kind: string;
  timestamp: SourcedTimestamp;
  correlationId: string | null;
  payload: unknown;
}

export interface ReplayEvent {
  eventVersion: typeof REPLAY_EVENT_VERSION;
  /** Derived from streamId + sequence; never from array position or time. */
  eventId: string;
  streamId: string;
  sequence: number;
  kind: string;
  /** Capture-call position relative to the trigger, not inferred from time. */
  phase: ReplayPhase;
  timestamp: Readonly<SourcedTimestamp>;
  correlationId: string | null;
  payload: ReplayJsonValue;
}

export interface ReplayTriggerInput {
  triggerId: string;
  kind: string;
  /** Source occurrence time when known; null remains explicitly unknown. */
  sourceTimeMs: number | null;
  /** Local receipt time from the caller's injected clock. */
  receivedAtMs: number;
  /** Runtime validation rejects LIVE_PRIVATE; keeping the input broad makes that rejection testable. */
  authority: DataAuthority;
  sourceId: string;
  correlationId: string | null;
}

export interface ReplayTrigger extends Omit<ReplayTriggerInput, 'authority'> {
  triggerVersion: typeof REPLAY_TRIGGER_VERSION;
  authority: ReplaySourceAuthority;
}

export interface ReplayCaptureMetadata {
  preTriggerCapacity: number;
  postTriggerEventLimit: number;
  preTriggerObservedCount: number;
  preTriggerRetainedCount: number;
  preTriggerDroppedCount: number;
  postTriggerCapturedCount: number;
  postTriggerComplete: boolean;
  eventCount: number;
}

export interface ReplayChecksum {
  algorithm: typeof REPLAY_CHECKSUM_ALGORITHM;
  value: string;
}

export interface ReplayEnvelopeBodyV1 {
  schema: typeof REPLAY_SCHEMA;
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  captureId: string;
  /** Facts are replayed only with replay authority, never as live facts. */
  authority: 'RECORDED_REPLAY';
  createdAtMs: number;
  completedAtMs: number;
  trigger: Readonly<ReplayTrigger>;
  capture: Readonly<ReplayCaptureMetadata>;
  events: readonly Readonly<ReplayEvent>[];
}

export interface ReplayEnvelopeV1 extends ReplayEnvelopeBodyV1 {
  checksum: Readonly<ReplayChecksum>;
}

export const REPLAY_INTEGRITY_STATES = [
  'VALID',
  'GAPPED',
  'TRUNCATED',
  'GAPPED_AND_TRUNCATED',
] as const;
export type ReplayIntegrityState = (typeof REPLAY_INTEGRITY_STATES)[number];

export interface ReplayIntegrityIssue {
  code:
    | 'SEQUENCE_GAP'
    | 'SEQUENCE_REGRESSION'
    | 'PRE_TRIGGER_OVERWRITE'
    | 'POST_TRIGGER_INCOMPLETE';
  message: string;
  streamId: string | null;
  afterSequence: number | null;
  beforeSequence: number | null;
  missingCount: number | null;
}

export interface ReplayInspection {
  envelope: Readonly<ReplayEnvelopeV1>;
  integrity: Readonly<{
    state: ReplayIntegrityState;
    issues: readonly Readonly<ReplayIntegrityIssue>[];
  }>;
}

export interface ReplayCaptureConfig {
  captureId: string;
  startedAtMs: number;
  preTriggerCapacity: number;
  postTriggerEventLimit: number;
}

export interface ReplayCaptureSnapshot {
  captureId: string;
  state: ReplayCaptureState;
  preTriggerCapacity: number;
  preTriggerObservedCount: number;
  preTriggerRetainedCount: number;
  preTriggerDroppedCount: number;
  postTriggerEventLimit: number;
  postTriggerCapturedCount: number;
  trigger: Readonly<ReplayTrigger> | null;
}

export interface ReplayVirtualClockPort {
  nowMs(): number;
  advanceTo(targetMs: number): void;
}

export interface ReplayDispatch {
  event: Readonly<ReplayEvent>;
  /** The original capture authority remains inside event.timestamp. */
  authority: 'RECORDED_REPLAY';
  replayedAtMs: number;
  offsetMs: number;
  ordinal: number;
}

export interface ReplayOptions {
  allowGaps?: boolean;
  allowTruncated?: boolean;
}

export interface ReplaySummary {
  captureId: string;
  authority: 'RECORDED_REPLAY';
  integrityState: ReplayIntegrityState;
  dispatchedCount: number;
  replayStartedAtMs: number;
  replayCompletedAtMs: number;
  firstSourceTimeMs: number | null;
  lastSourceTimeMs: number | null;
}

export function isValidReplayCaptureId(value: unknown): value is string {
  return typeof value === 'string' && REPLAY_CAPTURE_ID_PATTERN.test(value);
}

export interface ReplayStoragePort {
  write(captureId: string, serializedEnvelope: string): Promise<void>;
  read(captureId: string): Promise<string | null>;
}

export interface ReplayStorageContext {
  nowMs: number;
  correlationId: string;
}

export interface ReplayStorageWriteReceipt {
  captureId: string;
  serializedBytes: number;
}

export type ReplayResult<T> = ContractResult<T>;
export type ReplayFailure = StructuredFailure;
