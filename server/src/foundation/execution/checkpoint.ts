import {
  canonicalJson,
  findSecretLikePaths,
  findSerializabilityIssues,
  stableHash128Hex,
} from '../contracts/index.js';
import { replayExecutionEvents } from './reducer.js';
import {
  EXECUTION_CHECKPOINT_SCHEMA,
  EXECUTION_CHECKPOINT_VERSION,
  type CheckpointRestoreResult,
  type ExecutionCheckpoint,
  type ExecutionPlanState,
} from './types.js';

function checkpointPayload(state: ExecutionPlanState): Omit<ExecutionCheckpoint, 'checksum'> {
  return {
    schema: EXECUTION_CHECKPOINT_SCHEMA,
    version: EXECUTION_CHECKPOINT_VERSION,
    planId: state.plan.planId,
    revision: state.revision,
    state,
  };
}

/** Same state always yields the same checkpoint and checksum. */
export function createExecutionCheckpoint(state: ExecutionPlanState): Readonly<ExecutionCheckpoint> {
  const payload = checkpointPayload(state);
  if (findSecretLikePaths(payload).length > 0 || findSerializabilityIssues(payload).length > 0) {
    throw new TypeError('execution checkpoint state must be secret-free canonical plain data');
  }
  return Object.freeze({ ...payload, checksum: stableHash128Hex(canonicalJson(payload)) });
}

/** Canonical JSON makes byte output independent of object key insertion order. */
export function serializeExecutionCheckpoint(state: ExecutionPlanState): string {
  return canonicalJson(createExecutionCheckpoint(state));
}

/**
 * Restores only after checksum verification and a full event replay. A
 * checksum-valid but reducer-inconsistent snapshot is still rejected.
 */
export function restoreExecutionCheckpoint(serialized: string): CheckpointRestoreResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_PARSE_FAILED' as const,
      message: 'checkpoint is not valid JSON',
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_STATE_INVALID' as const,
      message: 'checkpoint must be an object',
    });
  }
  const checkpoint = parsed as Record<string, unknown>;
  const exactKeys = ['checksum', 'planId', 'revision', 'schema', 'state', 'version'];
  if (Object.keys(checkpoint).sort().join('|') !== exactKeys.join('|')) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_UNKNOWN_FIELD' as const,
      message: 'checkpoint contains missing or unknown top-level fields',
    });
  }
  const secretPaths = findSecretLikePaths(checkpoint);
  if (secretPaths.length > 0) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_SECRET_FIELD_REJECTED' as const,
      message: `checkpoint contains forbidden secret-like fields: ${secretPaths.join(', ')}`,
    });
  }
  if (findSerializabilityIssues(checkpoint).length > 0) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_STATE_INVALID' as const,
      message: 'checkpoint is not canonical plain data',
    });
  }
  if (checkpoint.schema !== EXECUTION_CHECKPOINT_SCHEMA || checkpoint.version !== EXECUTION_CHECKPOINT_VERSION) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_SCHEMA_UNSUPPORTED' as const,
      message: 'checkpoint schema or version is unsupported',
    });
  }
  if (typeof checkpoint.checksum !== 'string') {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_STATE_INVALID' as const,
      message: 'checkpoint checksum is missing',
    });
  }
  const { checksum, ...payload } = checkpoint;
  let expected: string;
  try {
    expected = stableHash128Hex(canonicalJson(payload));
  } catch {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_STATE_INVALID' as const,
      message: 'checkpoint contains non-canonical data',
    });
  }
  if (checksum !== expected) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_CHECKSUM_MISMATCH' as const,
      message: 'checkpoint checksum does not match its payload',
    });
  }
  const candidate = checkpoint.state as Partial<ExecutionPlanState> | undefined;
  if (
    candidate === undefined ||
    !Array.isArray(candidate.eventLog) ||
    candidate.eventLog.length === 0 ||
    checkpoint.planId !== candidate.plan?.planId ||
    checkpoint.revision !== candidate.revision
  ) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_STATE_INVALID' as const,
      message: 'checkpoint identity, revision, or event log is invalid',
    });
  }
  const replayed = replayExecutionEvents(candidate.eventLog);
  if (!replayed.applied) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_STATE_INVALID' as const,
      message: `checkpoint event stream is invalid (${replayed.reason})`,
    });
  }
  try {
    if (canonicalJson(replayed.state) !== canonicalJson(candidate)) {
      return Object.freeze({
        ok: false as const,
        code: 'CHECKPOINT_REPLAY_MISMATCH' as const,
        message: 'checkpoint snapshot does not match deterministic event replay',
      });
    }
  } catch {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_STATE_INVALID' as const,
      message: 'checkpoint state is not canonical plain data',
    });
  }
  return Object.freeze({ ok: true as const, state: replayed.state });
}
