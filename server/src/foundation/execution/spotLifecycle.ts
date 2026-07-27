/**
 * Deterministic, side-effect-free lifecycle for one Spot order identity.
 *
 * The reducer records observations only. It cannot send, query, cancel, retry,
 * flatten, read a clock, or infer venue truth that was not supplied as an
 * event.
 */

import {
  compareSpotDecimals,
  normalizeSpotDecimal,
  subtractSpotDecimals,
} from '../exchange/binanceSpot/filters.js';

export const SPOT_LIFECYCLE_STATES = Object.freeze([
  'PREPARED',
  'SUBMITTING',
  'UNKNOWN',
  'ACKNOWLEDGED',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCEL_PENDING',
  'CANCELLED',
  'FLATTEN_REQUIRED',
  'FLATTEN_PENDING',
  'FLAT',
  'FAILED',
] as const);

export type SpotLifecycle = (typeof SPOT_LIFECYCLE_STATES)[number];

export const SPOT_AMBIGUITY_CAUSES = Object.freeze([
  'CANONICAL_ATTEMPT_UNKNOWN',
] as const);

export type SpotAmbiguityCause = (typeof SPOT_AMBIGUITY_CAUSES)[number];
export type SpotAmbiguityOperation = 'SUBMIT' | 'CANCEL';

interface SpotEventEnvelope {
  readonly eventId: string;
  readonly sequence: number;
}

export type SpotLifecycleEvent =
  | (SpotEventEnvelope & {
      readonly type: 'PREPARED';
      readonly originalClientOrderId: string;
      readonly targetQuantity: string;
    })
  | (SpotEventEnvelope & { readonly type: 'SUBMIT_STARTED' })
  | (SpotEventEnvelope & {
      readonly type: 'OUTCOME_AMBIGUOUS';
      /**
       * Classification is deliberately canonical-owner-shaped. Transport
       * timeout/5xx/disconnect classification belongs to the signed kernel.
       */
      readonly cause: SpotAmbiguityCause;
    })
  | (SpotEventEnvelope & {
      readonly type: 'ORDER_ACKNOWLEDGED';
      readonly venueOrderId: string | null;
      readonly cumulativeFilledQuantity: string;
    })
  | (SpotEventEnvelope & {
      readonly type: 'FILL_OBSERVED';
      readonly venueOrderId: string | null;
      readonly cumulativeFilledQuantity: string;
    })
  | (SpotEventEnvelope & { readonly type: 'ORDER_PROVEN_ABSENT' })
  | (SpotEventEnvelope & { readonly type: 'CANCEL_REQUESTED' })
  | (SpotEventEnvelope & {
      readonly type: 'ORDER_CANCELLED';
      readonly venueOrderId: string | null;
      readonly cumulativeFilledQuantity: string;
    })
  | (SpotEventEnvelope & {
      readonly type: 'FLATTEN_REQUIRED';
      /** Canonical evidence proves the source order can no longer fill. */
      readonly sourceOrderTerminal: boolean;
    })
  | (SpotEventEnvelope & { readonly type: 'FLATTEN_STARTED' })
  | (SpotEventEnvelope & {
      readonly type: 'FLATTEN_FILL_OBSERVED';
      readonly cumulativeFlattenedQuantity: string;
    })
  | (SpotEventEnvelope & { readonly type: 'FLAT_CONFIRMED' })
  | (SpotEventEnvelope & {
      readonly type: 'FAILED';
      readonly failureCode: string;
      /**
       * True only when canonical venue evidence proves no order can remain
       * live. Local/transport failure alone must never erase an open order.
       */
      readonly venueOrderTerminal: boolean;
    });

export interface SpotLifecycleState {
  readonly lifecycle: SpotLifecycle;
  readonly originalClientOrderId: string;
  readonly targetQuantity: string;
  readonly cumulativeFilledQuantity: string;
  readonly cumulativeFlattenedQuantity: string;
  readonly venueOrderId: string | null;
  readonly ambiguityCause: SpotAmbiguityCause | null;
  readonly ambiguityOperation: SpotAmbiguityOperation | null;
  readonly lifecycleBeforeAmbiguity: SpotLifecycle | null;
  readonly lastFailureCode: string | null;
  readonly revision: number;
  readonly lastSequence: number;
  readonly processedEventIds: readonly string[];
  readonly eventLog: readonly Readonly<SpotLifecycleEvent>[];
}

export type SpotLifecycleIgnoreReason =
  | 'DUPLICATE_EVENT'
  | 'STALE_EVENT';

export type SpotLifecycleRejectReason =
  | 'INVALID_EVENT'
  | 'EVENT_ID_CONFLICT'
  | 'EVENT_SEQUENCE_GAP'
  | 'EVENT_SEQUENCE_CONFLICT'
  | 'INVALID_TRANSITION'
  | 'FILL_REGRESSION'
  | 'FILL_EXCEEDS_TARGET'
  | 'FLATTEN_REGRESSION'
  | 'FLATTEN_EXCEEDS_FILL'
  | 'RESIDUAL_EXPOSURE'
  | 'UNRESOLVED_AMBIGUITY'
  | 'UNRESOLVED_VENUE_ORDER';

export type SpotLifecycleReducerResult =
  | {
      readonly applied: true;
      readonly state: Readonly<SpotLifecycleState>;
    }
  | {
      readonly applied: false;
      readonly state: Readonly<SpotLifecycleState> | null;
      readonly reason: SpotLifecycleIgnoreReason | SpotLifecycleRejectReason;
    };

export type SpotLifecycleReplayResult =
  | {
      readonly ok: true;
      readonly state: Readonly<SpotLifecycleState>;
      readonly duplicateCount: number;
    }
  | {
      readonly ok: false;
      readonly state: Readonly<SpotLifecycleState> | null;
      readonly eventIndex: number;
      readonly reason:
        | SpotLifecycleRejectReason
        | 'STALE_EVENT'
        | 'EMPTY_REPLAY';
    };

const EVENT_TYPES = new Set<SpotLifecycleEvent['type']>([
  'PREPARED',
  'SUBMIT_STARTED',
  'OUTCOME_AMBIGUOUS',
  'ORDER_ACKNOWLEDGED',
  'FILL_OBSERVED',
  'ORDER_PROVEN_ABSENT',
  'CANCEL_REQUESTED',
  'ORDER_CANCELLED',
  'FLATTEN_REQUIRED',
  'FLATTEN_STARTED',
  'FLATTEN_FILL_OBSERVED',
  'FLAT_CONFIRMED',
  'FAILED',
]);

function isNonEmptyIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim()
  );
}

function normalizedQuantity(
  value: unknown,
  fieldName: string,
): string | null {
  if (typeof value !== 'string') return null;
  try {
    return normalizeSpotDecimal(value, fieldName);
  } catch {
    return null;
  }
}

function isEventEnvelope(value: unknown): value is SpotLifecycleEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Partial<SpotLifecycleEvent>;
  return (
    isNonEmptyIdentity(event.eventId) &&
    Number.isSafeInteger(event.sequence) &&
    (event.sequence ?? 0) > 0 &&
    typeof event.type === 'string' &&
    EVENT_TYPES.has(event.type as SpotLifecycleEvent['type'])
  );
}

function normalizeEvent(event: SpotLifecycleEvent): SpotLifecycleEvent | null {
  if (!isEventEnvelope(event)) return null;
  switch (event.type) {
    case 'PREPARED': {
      const targetQuantity = normalizedQuantity(
        event.targetQuantity,
        'targetQuantity',
      );
      return (
        isNonEmptyIdentity(event.originalClientOrderId) &&
        targetQuantity !== null &&
        compareSpotDecimals(targetQuantity, '0') > 0
      )
        ? { ...event, targetQuantity }
        : null;
    }
    case 'OUTCOME_AMBIGUOUS':
      return (SPOT_AMBIGUITY_CAUSES as readonly string[]).includes(event.cause)
        ? { ...event }
        : null;
    case 'ORDER_ACKNOWLEDGED':
    case 'FILL_OBSERVED':
    case 'ORDER_CANCELLED': {
      const cumulativeFilledQuantity = normalizedQuantity(
        event.cumulativeFilledQuantity,
        'cumulativeFilledQuantity',
      );
      return (
        (event.venueOrderId === null || isNonEmptyIdentity(event.venueOrderId)) &&
        cumulativeFilledQuantity !== null
      )
        ? { ...event, cumulativeFilledQuantity }
        : null;
    }
    case 'FLATTEN_FILL_OBSERVED': {
      const cumulativeFlattenedQuantity = normalizedQuantity(
        event.cumulativeFlattenedQuantity,
        'cumulativeFlattenedQuantity',
      );
      return cumulativeFlattenedQuantity === null
        ? null
        : { ...event, cumulativeFlattenedQuantity };
    }
    case 'FLATTEN_REQUIRED':
      return typeof event.sourceOrderTerminal === 'boolean'
        ? { ...event }
        : null;
    case 'FAILED':
      return (
        isNonEmptyIdentity(event.failureCode) &&
        typeof event.venueOrderTerminal === 'boolean'
      )
        ? { ...event }
        : null;
    default:
      return { ...event };
  }
}

function eventFingerprint(event: SpotLifecycleEvent): string {
  switch (event.type) {
    case 'PREPARED':
      return JSON.stringify([
        event.type,
        event.eventId,
        event.sequence,
        event.originalClientOrderId,
        event.targetQuantity,
      ]);
    case 'OUTCOME_AMBIGUOUS':
      return JSON.stringify([
        event.type,
        event.eventId,
        event.sequence,
        event.cause,
      ]);
    case 'ORDER_ACKNOWLEDGED':
    case 'FILL_OBSERVED':
    case 'ORDER_CANCELLED':
      return JSON.stringify([
        event.type,
        event.eventId,
        event.sequence,
        event.venueOrderId,
        event.cumulativeFilledQuantity,
      ]);
    case 'FLATTEN_FILL_OBSERVED':
      return JSON.stringify([
        event.type,
        event.eventId,
        event.sequence,
        event.cumulativeFlattenedQuantity,
      ]);
    case 'FAILED':
      return JSON.stringify([
        event.type,
        event.eventId,
        event.sequence,
        event.failureCode,
        event.venueOrderTerminal,
      ]);
    case 'FLATTEN_REQUIRED':
      return JSON.stringify([
        event.type,
        event.eventId,
        event.sequence,
        event.sourceOrderTerminal,
      ]);
    default:
      return JSON.stringify([event.type, event.eventId, event.sequence]);
  }
}

function freezeEvent(event: SpotLifecycleEvent): Readonly<SpotLifecycleEvent> {
  return Object.freeze({ ...event });
}

function freezeState(
  state: Omit<SpotLifecycleState, 'processedEventIds' | 'eventLog'> & {
    readonly processedEventIds: readonly string[];
    readonly eventLog: readonly Readonly<SpotLifecycleEvent>[];
  },
): Readonly<SpotLifecycleState> {
  return Object.freeze({
    ...state,
    processedEventIds: Object.freeze([...state.processedEventIds]),
    eventLog: Object.freeze([...state.eventLog]),
  });
}

function accepted(
  state: Readonly<SpotLifecycleState>,
): SpotLifecycleReducerResult {
  return Object.freeze({ applied: true as const, state });
}

function rejected(
  state: Readonly<SpotLifecycleState> | null,
  reason: SpotLifecycleIgnoreReason | SpotLifecycleRejectReason,
): SpotLifecycleReducerResult {
  return Object.freeze({ applied: false as const, state, reason });
}

function residualQuantity(
  state: Pick<
    SpotLifecycleState,
    'cumulativeFilledQuantity' | 'cumulativeFlattenedQuantity'
  >,
): string {
  return subtractSpotDecimals(
    state.cumulativeFilledQuantity,
    state.cumulativeFlattenedQuantity,
  );
}

export function spotResidualQuantity(
  state: Pick<
    SpotLifecycleState,
    'cumulativeFilledQuantity' | 'cumulativeFlattenedQuantity'
  >,
): string {
  return residualQuantity(state);
}

function nextLifecycleForFill(
  state: Readonly<SpotLifecycleState>,
  cumulativeFilledQuantity: string,
): SpotLifecycle {
  if (state.lifecycle === 'CANCEL_PENDING') {
    return compareSpotDecimals(
      cumulativeFilledQuantity,
      state.targetQuantity,
    ) === 0
      ? 'FILLED'
      : 'CANCEL_PENDING';
  }
  if (
    state.lifecycle === 'CANCELLED' ||
    state.lifecycle === 'FLATTEN_REQUIRED' ||
    state.lifecycle === 'FLATTEN_PENDING'
  ) {
    return state.lifecycle;
  }
  return compareSpotDecimals(
    cumulativeFilledQuantity,
    state.targetQuantity,
  ) === 0
    ? 'FILLED'
    : compareSpotDecimals(cumulativeFilledQuantity, '0') > 0
      ? 'PARTIALLY_FILLED'
      : 'ACKNOWLEDGED';
}

function fillTransitionAllowed(lifecycle: SpotLifecycle): boolean {
  return [
    'SUBMITTING',
    'UNKNOWN',
    'ACKNOWLEDGED',
    'PARTIALLY_FILLED',
    'FILLED',
    'CANCEL_PENDING',
    'CANCELLED',
    'FLATTEN_REQUIRED',
    'FLATTEN_PENDING',
  ].includes(lifecycle);
}

function withEvent(
  state: Readonly<SpotLifecycleState>,
  event: SpotLifecycleEvent,
  changes: Partial<SpotLifecycleState>,
): Readonly<SpotLifecycleState> {
  const frozenEvent = freezeEvent(event);
  return freezeState({
    ...state,
    ...changes,
    revision: state.revision + 1,
    lastSequence: event.sequence,
    processedEventIds: [...state.processedEventIds, event.eventId],
    eventLog: [...state.eventLog, frozenEvent],
  });
}

function venueOrderIdAfter(
  state: Readonly<SpotLifecycleState>,
  observedVenueOrderId: string | null,
): string | null {
  return observedVenueOrderId ?? state.venueOrderId;
}

function applyFill(
  state: Readonly<SpotLifecycleState>,
  event: Extract<
    SpotLifecycleEvent,
    { readonly type: 'ORDER_ACKNOWLEDGED' | 'FILL_OBSERVED' }
  >,
): SpotLifecycleReducerResult {
  if (!fillTransitionAllowed(state.lifecycle)) {
    return rejected(state, 'INVALID_TRANSITION');
  }
  if (
    compareSpotDecimals(
      event.cumulativeFilledQuantity,
      state.cumulativeFilledQuantity,
    ) < 0
  ) {
    return rejected(state, 'FILL_REGRESSION');
  }
  if (
    compareSpotDecimals(
      event.cumulativeFilledQuantity,
      state.targetQuantity,
    ) > 0
  ) {
    return rejected(state, 'FILL_EXCEEDS_TARGET');
  }
  if (
    state.venueOrderId !== null &&
    event.venueOrderId !== null &&
    state.venueOrderId !== event.venueOrderId
  ) {
    return rejected(state, 'INVALID_EVENT');
  }
  return accepted(withEvent(state, event, {
    lifecycle: nextLifecycleForFill(
      state,
      event.cumulativeFilledQuantity,
    ),
    cumulativeFilledQuantity: event.cumulativeFilledQuantity,
    venueOrderId: venueOrderIdAfter(state, event.venueOrderId),
    ambiguityCause: null,
    ambiguityOperation: null,
    lifecycleBeforeAmbiguity: null,
  }));
}

/**
 * Reduce one observation. Duplicate identity with identical content is
 * ignored; identity/sequence reuse with different content fails closed.
 */
export function reduceSpotLifecycle(
  state: Readonly<SpotLifecycleState> | null,
  event: SpotLifecycleEvent,
): SpotLifecycleReducerResult {
  const normalizedEvent = normalizeEvent(event);
  if (normalizedEvent === null) return rejected(state, 'INVALID_EVENT');
  event = normalizedEvent;

  if (state === null) {
    if (event.type !== 'PREPARED' || event.sequence !== 1) {
      return rejected(null, 'INVALID_TRANSITION');
    }
    const frozenEvent = freezeEvent(event);
    return accepted(freezeState({
      lifecycle: 'PREPARED',
      originalClientOrderId: event.originalClientOrderId,
      targetQuantity: event.targetQuantity,
      cumulativeFilledQuantity: '0',
      cumulativeFlattenedQuantity: '0',
      venueOrderId: null,
      ambiguityCause: null,
      ambiguityOperation: null,
      lifecycleBeforeAmbiguity: null,
      lastFailureCode: null,
      revision: 1,
      lastSequence: 1,
      processedEventIds: [event.eventId],
      eventLog: [frozenEvent],
    }));
  }

  const priorById = state.eventLog.find(
    (prior) => prior.eventId === event.eventId,
  );
  if (priorById !== undefined) {
    return rejected(
      state,
      eventFingerprint(priorById) === eventFingerprint(event)
        ? 'DUPLICATE_EVENT'
        : 'EVENT_ID_CONFLICT',
    );
  }
  const priorBySequence = state.eventLog.find(
    (prior) => prior.sequence === event.sequence,
  );
  if (priorBySequence !== undefined) {
    return rejected(state, 'EVENT_SEQUENCE_CONFLICT');
  }
  if (event.sequence < state.lastSequence) {
    return rejected(state, 'STALE_EVENT');
  }
  if (event.sequence !== state.lastSequence + 1) {
    return rejected(state, 'EVENT_SEQUENCE_GAP');
  }
  if (event.type === 'PREPARED') {
    return rejected(state, 'INVALID_TRANSITION');
  }

  switch (event.type) {
    case 'SUBMIT_STARTED':
      return state.lifecycle === 'PREPARED'
        ? accepted(withEvent(state, event, {
            lifecycle: 'SUBMITTING',
            ambiguityCause: null,
            ambiguityOperation: null,
            lifecycleBeforeAmbiguity: null,
            lastFailureCode: null,
          }))
        : rejected(state, 'INVALID_TRANSITION');

    case 'OUTCOME_AMBIGUOUS':
      return (
        state.lifecycle === 'SUBMITTING' ||
        state.lifecycle === 'CANCEL_PENDING'
      )
        ? accepted(withEvent(state, event, {
            lifecycle: 'UNKNOWN',
            ambiguityCause: event.cause,
            ambiguityOperation:
              state.lifecycle === 'SUBMITTING' ? 'SUBMIT' : 'CANCEL',
            lifecycleBeforeAmbiguity: state.lifecycle,
          }))
        : rejected(state, 'INVALID_TRANSITION');

    case 'ORDER_ACKNOWLEDGED':
    case 'FILL_OBSERVED':
      return applyFill(state, event);

    case 'ORDER_PROVEN_ABSENT':
      if (
        state.lifecycle !== 'UNKNOWN' ||
        state.ambiguityOperation !== 'SUBMIT' ||
        state.lifecycleBeforeAmbiguity !== 'SUBMITTING' ||
        compareSpotDecimals(state.cumulativeFilledQuantity, '0') !== 0 ||
        compareSpotDecimals(state.cumulativeFlattenedQuantity, '0') !== 0
      ) {
        return rejected(state, 'INVALID_TRANSITION');
      }
      return accepted(withEvent(state, event, {
        lifecycle: 'PREPARED',
        venueOrderId: null,
        ambiguityCause: null,
        ambiguityOperation: null,
        lifecycleBeforeAmbiguity: null,
      }));

    case 'CANCEL_REQUESTED':
      return (
        state.lifecycle === 'ACKNOWLEDGED' ||
        state.lifecycle === 'PARTIALLY_FILLED'
      )
        ? accepted(withEvent(state, event, {
            lifecycle: 'CANCEL_PENDING',
          }))
        : rejected(state, 'INVALID_TRANSITION');

    case 'ORDER_CANCELLED':
      if (
        ![
          'SUBMITTING',
          'UNKNOWN',
          'ACKNOWLEDGED',
          'PARTIALLY_FILLED',
          'CANCEL_PENDING',
        ].includes(state.lifecycle)
      ) {
        return rejected(state, 'INVALID_TRANSITION');
      }
      if (
        compareSpotDecimals(
          event.cumulativeFilledQuantity,
          state.cumulativeFilledQuantity,
        ) < 0
      ) {
        return rejected(state, 'FILL_REGRESSION');
      }
      if (
        compareSpotDecimals(
          event.cumulativeFilledQuantity,
          state.targetQuantity,
        ) > 0
      ) {
        return rejected(state, 'FILL_EXCEEDS_TARGET');
      }
      if (
        state.venueOrderId !== null &&
        event.venueOrderId !== null &&
        state.venueOrderId !== event.venueOrderId
      ) {
        return rejected(state, 'INVALID_EVENT');
      }
      return accepted(withEvent(state, event, {
        lifecycle: 'CANCELLED',
        cumulativeFilledQuantity: event.cumulativeFilledQuantity,
        venueOrderId: venueOrderIdAfter(state, event.venueOrderId),
        ambiguityCause: null,
        ambiguityOperation: null,
        lifecycleBeforeAmbiguity: null,
      }));

    case 'FLATTEN_REQUIRED':
      return (
        ['PARTIALLY_FILLED', 'FILLED', 'CANCELLED'].includes(
          state.lifecycle,
        ) &&
        event.sourceOrderTerminal &&
        compareSpotDecimals(residualQuantity(state), '0') > 0
      )
        ? accepted(withEvent(state, event, {
            lifecycle: 'FLATTEN_REQUIRED',
          }))
        : rejected(state, 'INVALID_TRANSITION');

    case 'FLATTEN_STARTED':
      return state.lifecycle === 'FLATTEN_REQUIRED'
        ? accepted(withEvent(state, event, {
            lifecycle: 'FLATTEN_PENDING',
          }))
        : rejected(state, 'INVALID_TRANSITION');

    case 'FLATTEN_FILL_OBSERVED':
      if (state.lifecycle !== 'FLATTEN_PENDING') {
        return rejected(state, 'INVALID_TRANSITION');
      }
      if (
        compareSpotDecimals(
          event.cumulativeFlattenedQuantity,
          state.cumulativeFlattenedQuantity,
        ) < 0
      ) {
        return rejected(state, 'FLATTEN_REGRESSION');
      }
      if (
        compareSpotDecimals(
          event.cumulativeFlattenedQuantity,
          state.cumulativeFilledQuantity,
        ) > 0
      ) {
        return rejected(state, 'FLATTEN_EXCEEDS_FILL');
      }
      return accepted(withEvent(state, event, {
        lifecycle:
          compareSpotDecimals(
            event.cumulativeFlattenedQuantity,
            state.cumulativeFilledQuantity,
          ) === 0
            ? 'FLAT'
            : 'FLATTEN_PENDING',
        cumulativeFlattenedQuantity:
          event.cumulativeFlattenedQuantity,
      }));

    case 'FLAT_CONFIRMED':
      if (
        !['CANCELLED', 'FLATTEN_REQUIRED', 'FLATTEN_PENDING'].includes(
          state.lifecycle,
        )
      ) {
        return rejected(state, 'INVALID_TRANSITION');
      }
      return compareSpotDecimals(residualQuantity(state), '0') === 0
        ? accepted(withEvent(state, event, { lifecycle: 'FLAT' }))
        : rejected(state, 'RESIDUAL_EXPOSURE');

    case 'FAILED':
      if (state.lifecycle === 'FLAT' || state.lifecycle === 'FAILED') {
        return rejected(state, 'INVALID_TRANSITION');
      }
      if (state.lifecycle === 'UNKNOWN') {
        return rejected(state, 'UNRESOLVED_AMBIGUITY');
      }
      if (!event.venueOrderTerminal) {
        return rejected(state, 'UNRESOLVED_VENUE_ORDER');
      }
      return accepted(withEvent(state, event, {
        lifecycle:
          compareSpotDecimals(residualQuantity(state), '0') > 0
            ? 'FLATTEN_REQUIRED'
            : 'FAILED',
        lastFailureCode: event.failureCode,
      }));
  }
}

/**
 * Replay in recorded sequence order. Identical duplicate events are inert;
 * every conflicting, stale, gapped, or illegal observation stops replay.
 */
export function replaySpotLifecycle(
  events: readonly SpotLifecycleEvent[],
): SpotLifecycleReplayResult {
  if (events.length === 0) {
    return Object.freeze({
      ok: false as const,
      state: null,
      eventIndex: 0,
      reason: 'EMPTY_REPLAY' as const,
    });
  }

  let state: Readonly<SpotLifecycleState> | null = null;
  let duplicateCount = 0;
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const result = reduceSpotLifecycle(state, events[eventIndex]);
    if (result.applied) {
      state = result.state;
      continue;
    }
    if (result.reason === 'DUPLICATE_EVENT') {
      duplicateCount += 1;
      state = result.state;
      continue;
    }
    return Object.freeze({
      ok: false as const,
      state: result.state,
      eventIndex,
      reason: result.reason,
    });
  }

  if (state === null) {
    return Object.freeze({
      ok: false as const,
      state: null,
      eventIndex: 0,
      reason: 'EMPTY_REPLAY' as const,
    });
  }
  return Object.freeze({
    ok: true as const,
    state,
    duplicateCount,
  });
}

export const replaySpotLifecycleEvents = replaySpotLifecycle;
