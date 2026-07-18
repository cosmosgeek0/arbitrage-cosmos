/** Deterministic synchronous replay over an explicit virtual clock. */
import { isValidUtcMillis, observeRejectedThenable, ok, type ContractResult } from '../contracts/index.js';
import { inspectReplayEnvelope } from './envelope.js';
import { replayEventTimeMs } from './event.js';
import { replayFailure, REPLAY_FAILURE_CODES } from './failures.js';
import type {
  ReplayDispatch,
  ReplayEnvelopeV1,
  ReplayInspection,
  ReplayOptions,
  ReplaySummary,
  ReplayVirtualClockPort,
} from './types.js';

export type ReplayEventHandler = (dispatch: Readonly<ReplayDispatch>) => void;

function integrityBlocked(
  inspection: ReplayInspection,
  options: ReplayOptions,
): 'GAP' | 'TRUNCATED' | null {
  const state = inspection.integrity.state;
  if ((state === 'GAPPED' || state === 'GAPPED_AND_TRUNCATED') && options.allowGaps !== true) {
    return 'GAP';
  }
  if ((state === 'TRUNCATED' || state === 'GAPPED_AND_TRUNCATED') && options.allowTruncated !== true) {
    return 'TRUNCATED';
  }
  return null;
}

function replayInspectedEnvelope(
  inspection: ReplayInspection,
  clock: ReplayVirtualClockPort,
  handler: ReplayEventHandler,
  options: ReplayOptions = {},
): ContractResult<Readonly<ReplaySummary>> {
  if (
    typeof clock !== 'object' ||
    clock === null ||
    typeof clock.nowMs !== 'function' ||
    typeof clock.advanceTo !== 'function' ||
    typeof handler !== 'function'
  ) {
    throw new TypeError('replayInspectedEnvelope: clock port and handler are required');
  }
  const replayStartedAtMs = clock.nowMs();
  if (!isValidUtcMillis(replayStartedAtMs)) {
    throw new TypeError('replayInspectedEnvelope: virtual clock returned invalid UTC ms');
  }
  const blocked = integrityBlocked(inspection, options);
  if (blocked) {
    return replayFailure({
      stage: 'replay',
      code:
        blocked === 'GAP'
          ? REPLAY_FAILURE_CODES.SEQUENCE_GAP
          : REPLAY_FAILURE_CODES.TRUNCATED,
      message:
        blocked === 'GAP'
          ? 'replay blocked because retained history has a sequence gap'
          : 'replay blocked because retained history is truncated',
      nowMs: replayStartedAtMs,
      correlationId: inspection.envelope.trigger.correlationId,
      safeCurrentState: 'NOT_REPLAYED',
      recommendedOperatorAction:
        blocked === 'GAP'
          ? 'Restore complete history or explicitly allow gap-aware analysis.'
          : 'Restore complete history or explicitly allow bounded partial analysis.',
    });
  }

  const events = inspection.envelope.events;
  const firstEventBasisTimeMs = events.length > 0 ? replayEventTimeMs(events[0]) : null;
  const firstSourceTimeMs = events.length > 0 ? events[0].timestamp.sourceTimeMs : null;
  const lastSourceTimeMs = events.length > 0
    ? events[events.length - 1].timestamp.sourceTimeMs
    : null;
  const targets: number[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const offsetMs = replayEventTimeMs(events[i]) - (firstEventBasisTimeMs as number);
    const targetMs = replayStartedAtMs + offsetMs;
    if (!isValidUtcMillis(targetMs) || (i > 0 && targetMs < targets[i - 1])) {
      return replayFailure({
        stage: 'preflightVirtualClock',
        code: REPLAY_FAILURE_CODES.CLOCK_INVALID,
        message: 'replay timeline cannot fit monotonically inside the supported virtual UTC range',
        nowMs: replayStartedAtMs,
        correlationId: events[i].correlationId,
        safeCurrentState: 'NOT_REPLAYED',
      });
    }
    targets.push(targetMs);
  }

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    const eventTimeMs = replayEventTimeMs(event);
    const offsetMs = eventTimeMs - (firstEventBasisTimeMs as number);
    const targetMs = targets[i];
    try {
      clock.advanceTo(targetMs);
    } catch {
      return replayFailure({
        stage: 'advanceVirtualClock',
        code: REPLAY_FAILURE_CODES.CLOCK_INVALID,
        message: 'virtual clock rejected deterministic replay advancement',
        nowMs: clock.nowMs(),
        correlationId: event.correlationId,
        safeCurrentState: 'REPLAY_STOPPED',
      });
    }
    if (clock.nowMs() !== targetMs) {
      return replayFailure({
        stage: 'advanceVirtualClock',
        code: REPLAY_FAILURE_CODES.CLOCK_INVALID,
        message: 'virtual clock did not advance to the requested exact time',
        nowMs: clock.nowMs(),
        correlationId: event.correlationId,
        safeCurrentState: 'REPLAY_STOPPED',
      });
    }
    try {
      const returned = handler(
        Object.freeze({
          event,
          authority: 'RECORDED_REPLAY',
          replayedAtMs: targetMs,
          offsetMs,
          ordinal: i,
        }),
      );
      const returnedThenable = observeRejectedThenable(returned);
      if (returnedThenable || returned !== undefined) {
        return replayFailure({
          stage: 'dispatchEvent',
          code: REPLAY_FAILURE_CODES.HANDLER_FAILED,
          message: 'replay handler must be synchronous and return undefined',
          nowMs: targetMs,
          correlationId: event.correlationId,
          safeCurrentState: 'REPLAY_STOPPED',
        });
      }
      if (clock.nowMs() !== targetMs) {
        return replayFailure({
          stage: 'dispatchEvent',
          code: REPLAY_FAILURE_CODES.CLOCK_INVALID,
          message: 'replay handler mutated the shared virtual clock',
          nowMs: targetMs,
          correlationId: event.correlationId,
          safeCurrentState: 'REPLAY_STOPPED',
        });
      }
    } catch {
      return replayFailure({
        stage: 'dispatchEvent',
        code: REPLAY_FAILURE_CODES.HANDLER_FAILED,
        message: 'replay handler failed; error detail is intentionally not captured',
        nowMs: targetMs,
        correlationId: event.correlationId,
        safeCurrentState: 'REPLAY_STOPPED',
      });
    }
  }

  return ok(
    Object.freeze({
      captureId: inspection.envelope.captureId,
      authority: 'RECORDED_REPLAY',
      integrityState: inspection.integrity.state,
      dispatchedCount: events.length,
      replayStartedAtMs,
      replayCompletedAtMs: targets.length > 0 ? targets[targets.length - 1] : replayStartedAtMs,
      firstSourceTimeMs,
      lastSourceTimeMs,
    }),
  );
}

export function replayEnvelope(
  envelope: ReplayEnvelopeV1,
  clock: ReplayVirtualClockPort,
  handler: ReplayEventHandler,
  options: ReplayOptions = {},
): ContractResult<Readonly<ReplaySummary>> {
  if (
    typeof clock !== 'object' ||
    clock === null ||
    typeof clock.nowMs !== 'function' ||
    typeof clock.advanceTo !== 'function'
  ) {
    throw new TypeError('replayEnvelope: virtual clock port is required');
  }
  const nowMs = clock.nowMs();
  if (!isValidUtcMillis(nowMs)) {
    throw new TypeError('replayEnvelope: virtual clock returned invalid UTC ms');
  }
  const inspected = inspectReplayEnvelope(envelope, nowMs);
  if (!inspected.ok) return inspected;
  return replayInspectedEnvelope(inspected.value, clock, handler, options);
}
