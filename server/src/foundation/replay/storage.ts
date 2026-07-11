/** Injected persistence seam. No filesystem or database implementation lives here. */
import { isValidUtcMillis, ok, type ContractResult } from '../contracts/index.js';
import {
  inspectReplayEnvelope,
  parseReplayEnvelope,
  serializeReplayEnvelope,
} from './envelope.js';
import { replayFailure, REPLAY_FAILURE_CODES } from './failures.js';
import { utf8ByteLength } from './guard.js';
import type {
  ReplayEnvelopeV1,
  ReplayInspection,
  ReplayStorageContext,
  ReplayStoragePort,
  ReplayStorageWriteReceipt,
} from './types.js';
import { isValidReplayCaptureId } from './types.js';

function validateContext(context: ReplayStorageContext): void {
  if (
    typeof context !== 'object' ||
    context === null ||
    !isValidUtcMillis(context.nowMs) ||
    typeof context.correlationId !== 'string' ||
    context.correlationId.trim().length === 0 ||
    context.correlationId.length > 128
  ) {
    throw new TypeError('replay storage context requires injected nowMs and bounded correlationId');
  }
}

function validatePort(port: ReplayStoragePort): void {
  if (
    typeof port !== 'object' ||
    port === null ||
    typeof port.write !== 'function' ||
    typeof port.read !== 'function'
  ) {
    throw new TypeError('ReplayStoragePort requires read() and write()');
  }
}

export async function storeReplayEnvelope(
  port: ReplayStoragePort,
  envelope: ReplayEnvelopeV1,
  context: ReplayStorageContext,
): Promise<ContractResult<Readonly<ReplayStorageWriteReceipt>>> {
  validatePort(port);
  validateContext(context);
  const inspected = inspectReplayEnvelope(envelope, context.nowMs);
  if (!inspected.ok) return inspected;
  const serialized = serializeReplayEnvelope(inspected.value.envelope);
  try {
    await port.write(inspected.value.envelope.captureId, serialized);
  } catch {
    return replayFailure({
      stage: 'storageWrite',
      code: REPLAY_FAILURE_CODES.STORAGE_WRITE_FAILED,
      message: 'injected replay storage write failed; error detail is intentionally not captured',
      nowMs: context.nowMs,
      correlationId: context.correlationId,
      retryable: true,
      safeCurrentState: 'ENVELOPE_NOT_PERSISTED',
      recommendedOperatorAction: 'Inspect the injected storage adapter and retry with the same capture ID.',
    });
  }
  return ok(
    Object.freeze({
      captureId: inspected.value.envelope.captureId,
      serializedBytes: utf8ByteLength(serialized),
    }),
  );
}

export async function loadReplayEnvelope(
  port: ReplayStoragePort,
  captureId: string,
  context: ReplayStorageContext,
): Promise<ContractResult<Readonly<ReplayInspection>>> {
  validatePort(port);
  validateContext(context);
  if (!isValidReplayCaptureId(captureId)) {
    throw new TypeError('loadReplayEnvelope: captureId must be a safe opaque replay ID');
  }
  let serialized: string | null;
  try {
    serialized = await port.read(captureId);
  } catch {
    return replayFailure({
      stage: 'storageRead',
      code: REPLAY_FAILURE_CODES.STORAGE_READ_FAILED,
      message: 'injected replay storage read failed; error detail is intentionally not captured',
      nowMs: context.nowMs,
      correlationId: context.correlationId,
      retryable: true,
      safeCurrentState: 'ENVELOPE_NOT_LOADED',
      recommendedOperatorAction: 'Inspect the injected storage adapter and retry the same capture ID.',
    });
  }
  if (serialized === null) {
    return replayFailure({
      stage: 'storageRead',
      code: REPLAY_FAILURE_CODES.STORAGE_NOT_FOUND,
      message: 'replay capture was not found in the injected storage port',
      nowMs: context.nowMs,
      correlationId: context.correlationId,
      retryable: false,
      safeCurrentState: 'ENVELOPE_NOT_LOADED',
      recommendedOperatorAction: 'Verify the capture ID or restore the envelope from another copy.',
    });
  }
  const parsed = parseReplayEnvelope(serialized, context.nowMs, context.correlationId);
  if (!parsed.ok) return parsed;
  if (parsed.value.envelope.captureId !== captureId) {
    return replayFailure({
      stage: 'storageRead',
      code: REPLAY_FAILURE_CODES.STORAGE_KEY_MISMATCH,
      message: 'stored replay envelope captureId does not match the requested storage key',
      nowMs: context.nowMs,
      correlationId: context.correlationId,
      retryable: false,
      safeCurrentState: 'ENVELOPE_NOT_LOADED',
      recommendedOperatorAction: 'Treat the storage mapping as corrupt and inspect the storage adapter.',
    });
  }
  return parsed;
}
