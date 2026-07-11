/** Lane G structured failures. Caller supplies every timestamp. */
import {
  createStructuredFailure,
  fail,
  isValidUtcMillis,
  type ContractResult,
} from '../contracts/index.js';

export const REPLAY_COMPONENT = 'foundation.replay' as const;

export const REPLAY_FAILURE_CODES = Object.freeze({
  CAPTURE_CONFIG_INVALID: 'REPLAY_CAPTURE_CONFIG_INVALID',
  CAPTURE_STATE_INVALID: 'REPLAY_CAPTURE_STATE_INVALID',
  CAPTURE_COMPLETE: 'REPLAY_CAPTURE_COMPLETE',
  EVENT_INVALID: 'REPLAY_EVENT_INVALID',
  PRIVATE_PAYLOAD_REJECTED: 'REPLAY_PRIVATE_PAYLOAD_REJECTED',
  PAYLOAD_REJECTED: 'REPLAY_PAYLOAD_REJECTED',
  TRIGGER_INVALID: 'REPLAY_TRIGGER_INVALID',
  SCHEMA_INVALID: 'REPLAY_SCHEMA_INVALID',
  SCHEMA_UNSUPPORTED: 'REPLAY_SCHEMA_UNSUPPORTED',
  CHECKSUM_MISMATCH: 'REPLAY_CHECKSUM_MISMATCH',
  JSON_MALFORMED: 'REPLAY_JSON_MALFORMED',
  JSON_TRUNCATED: 'REPLAY_JSON_TRUNCATED',
  ENVELOPE_TOO_LARGE: 'REPLAY_ENVELOPE_TOO_LARGE',
  TRUNCATED: 'REPLAY_TRUNCATED',
  SEQUENCE_GAP: 'REPLAY_SEQUENCE_GAP',
  CLOCK_INVALID: 'REPLAY_CLOCK_INVALID',
  HANDLER_FAILED: 'REPLAY_HANDLER_FAILED',
  STORAGE_WRITE_FAILED: 'REPLAY_STORAGE_WRITE_FAILED',
  STORAGE_READ_FAILED: 'REPLAY_STORAGE_READ_FAILED',
  STORAGE_NOT_FOUND: 'REPLAY_STORAGE_NOT_FOUND',
  STORAGE_KEY_MISMATCH: 'REPLAY_STORAGE_KEY_MISMATCH',
} as const);

export type ReplayFailureCode =
  (typeof REPLAY_FAILURE_CODES)[keyof typeof REPLAY_FAILURE_CODES];

export interface ReplayFailureInput {
  stage: string;
  code: ReplayFailureCode;
  message: string;
  nowMs: number;
  correlationId?: string | null;
  retryable?: boolean;
  safeCurrentState?: string;
  recommendedOperatorAction?: string;
}

function safeCorrelationId(value: string | null | undefined): string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128
    ? value
    : 'UNCORRELATED';
}

export function replayFailure<T = never>(input: ReplayFailureInput): ContractResult<T> {
  if (!isValidUtcMillis(input.nowMs)) {
    throw new TypeError('replayFailure: nowMs must be valid UTC ms from an injected clock');
  }
  return fail(
    createStructuredFailure({
      component: REPLAY_COMPONENT,
      stage: input.stage,
      code: input.code,
      message: input.message,
      occurredAt: input.nowMs,
      retryable: input.retryable ?? false,
      safeCurrentState: input.safeCurrentState ?? 'UNCHANGED',
      recommendedOperatorAction:
        input.recommendedOperatorAction ?? 'Inspect the replay evidence and capture configuration.',
      correlationId: safeCorrelationId(input.correlationId),
    }),
  );
}
