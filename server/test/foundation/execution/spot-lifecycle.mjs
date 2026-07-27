#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SPOT_LIFECYCLE_STATES,
  reduceSpotLifecycle,
  replaySpotLifecycle,
  spotResidualQuantity,
} from '../../../dist/foundation/execution/spotLifecycle.js';
import {
  decideSpotAttempt,
} from '../../../dist/foundation/execution/spotAttemptPolicy.js';
import {
  createRequestAttempt,
  reduceRequestAttempt,
} from '../../../dist/liveEdge/adapters/binanceSignedKernel/ambiguity.js';

const CLIENT_ORDER_ID = `cx-${'a'.repeat(24)}-0`;
const REQUEST_ID = `lrq_${'b'.repeat(32)}`;

function prepared(sequence = 1, eventId = 'spot-event-1') {
  return {
    type: 'PREPARED',
    eventId,
    sequence,
    originalClientOrderId: CLIENT_ORDER_ID,
    targetQuantity: '10',
  };
}

function reduceApplied(state, event) {
  const result = reduceSpotLifecycle(state, event);
  assert.equal(result.applied, true, result.applied ? '' : result.reason);
  return result.state;
}

test('exports the exact closed Spot lifecycle state set', () => {
  assert.deepEqual(SPOT_LIFECYCLE_STATES, [
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
  ]);
});

test('captures cumulative fills through ambiguity, cancellation, and flattening', () => {
  const events = [
    prepared(),
    { type: 'SUBMIT_STARTED', eventId: 'spot-event-2', sequence: 2 },
    {
      type: 'OUTCOME_AMBIGUOUS',
      eventId: 'spot-event-3',
      sequence: 3,
      cause: 'CANONICAL_ATTEMPT_UNKNOWN',
    },
    {
      type: 'ORDER_ACKNOWLEDGED',
      eventId: 'spot-event-4',
      sequence: 4,
      venueOrderId: 'venue-order-1',
      cumulativeFilledQuantity: '0',
    },
    {
      type: 'FILL_OBSERVED',
      eventId: 'spot-event-5',
      sequence: 5,
      venueOrderId: 'venue-order-1',
      cumulativeFilledQuantity: '4',
    },
    { type: 'CANCEL_REQUESTED', eventId: 'spot-event-6', sequence: 6 },
    {
      type: 'ORDER_CANCELLED',
      eventId: 'spot-event-7',
      sequence: 7,
      venueOrderId: 'venue-order-1',
      cumulativeFilledQuantity: '6',
    },
    {
      type: 'FLATTEN_REQUIRED',
      eventId: 'spot-event-8',
      sequence: 8,
      sourceOrderTerminal: true,
    },
    { type: 'FLATTEN_STARTED', eventId: 'spot-event-9', sequence: 9 },
    {
      type: 'FLATTEN_FILL_OBSERVED',
      eventId: 'spot-event-10',
      sequence: 10,
      cumulativeFlattenedQuantity: '6',
    },
  ];

  const seen = [];
  let state = null;
  for (const event of events) {
    state = reduceApplied(state, event);
    seen.push(state.lifecycle);
  }

  assert.deepEqual(seen, [
    'PREPARED',
    'SUBMITTING',
    'UNKNOWN',
    'ACKNOWLEDGED',
    'PARTIALLY_FILLED',
    'CANCEL_PENDING',
    'CANCELLED',
    'FLATTEN_REQUIRED',
    'FLATTEN_PENDING',
    'FLAT',
  ]);
  assert.equal(state.cumulativeFilledQuantity, '6');
  assert.equal(state.cumulativeFlattenedQuantity, '6');
  assert.equal(spotResidualQuantity(state), '0');
  assert.equal(state.originalClientOrderId, CLIENT_ORDER_ID);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.eventLog), true);
});

test('normalizes exact decimal strings and preserves sub-JS precision', () => {
  let state = reduceApplied(null, {
    ...prepared(),
    targetQuantity: '0.0000000000000000030',
  });
  state = reduceApplied(state, {
    type: 'SUBMIT_STARTED',
    eventId: 'precision-event-2',
    sequence: 2,
  });
  state = reduceApplied(state, {
    type: 'FILL_OBSERVED',
    eventId: 'precision-event-3',
    sequence: 3,
    venueOrderId: 'venue-order-precision',
    cumulativeFilledQuantity: '0.0000000000000000020',
  });
  const unprovenFlatten = reduceSpotLifecycle(state, {
    type: 'FLATTEN_REQUIRED',
    eventId: 'precision-event-4',
    sequence: 4,
    sourceOrderTerminal: false,
  });
  assert.equal(unprovenFlatten.applied, false);
  assert.equal(unprovenFlatten.reason, 'INVALID_TRANSITION');
  assert.equal(unprovenFlatten.state, state);
  state = reduceApplied(state, {
    type: 'FLATTEN_REQUIRED',
    eventId: 'precision-event-4',
    sequence: 4,
    sourceOrderTerminal: true,
  });
  state = reduceApplied(state, {
    type: 'FLATTEN_STARTED',
    eventId: 'precision-event-5',
    sequence: 5,
  });
  state = reduceApplied(state, {
    type: 'FLATTEN_FILL_OBSERVED',
    eventId: 'precision-event-6',
    sequence: 6,
    cumulativeFlattenedQuantity: '0.0000000000000000010',
  });

  assert.equal(state.targetQuantity, '0.000000000000000003');
  assert.equal(
    state.cumulativeFilledQuantity,
    '0.000000000000000002',
  );
  assert.equal(
    state.cumulativeFlattenedQuantity,
    '0.000000000000000001',
  );
  assert.equal(
    spotResidualQuantity(state),
    '0.000000000000000001',
  );
  assert.equal(
    state.eventLog[0].targetQuantity,
    '0.000000000000000003',
  );
  assert.equal(
    state.eventLog[2].cumulativeFilledQuantity,
    '0.000000000000000002',
  );
  assert.equal(state.lifecycle, 'FLATTEN_PENDING');
});

test('full fill and zero-exposure failure are distinct terminal outcomes', () => {
  let filled = reduceApplied(null, prepared());
  filled = reduceApplied(filled, {
    type: 'SUBMIT_STARTED',
    eventId: 'spot-event-2',
    sequence: 2,
  });
  filled = reduceApplied(filled, {
    type: 'FILL_OBSERVED',
    eventId: 'spot-event-3',
    sequence: 3,
    venueOrderId: 'venue-order-filled',
    cumulativeFilledQuantity: '10',
  });
  assert.equal(filled.lifecycle, 'FILLED');

  let failed = reduceApplied(
    null,
    prepared(1, 'failed-event-1'),
  );
  failed = reduceApplied(failed, {
    type: 'SUBMIT_STARTED',
    eventId: 'failed-event-2',
    sequence: 2,
  });
  failed = reduceApplied(failed, {
    type: 'FAILED',
    eventId: 'failed-event-3',
    sequence: 3,
    failureCode: 'DEFINITIVE_REJECTION',
    venueOrderTerminal: true,
  });
  assert.equal(failed.lifecycle, 'FAILED');
  assert.equal(failed.lastFailureCode, 'DEFINITIVE_REJECTION');
});

test('failure with a known fill cannot bypass terminal venue proof before flattening', () => {
  let state = reduceApplied(null, prepared());
  state = reduceApplied(state, {
    type: 'SUBMIT_STARTED',
    eventId: 'spot-event-2',
    sequence: 2,
  });
  state = reduceApplied(state, {
    type: 'FILL_OBSERVED',
    eventId: 'spot-event-3',
    sequence: 3,
    venueOrderId: 'venue-order-partial',
    cumulativeFilledQuantity: '3',
  });
  const unresolved = reduceSpotLifecycle(state, {
    type: 'FAILED',
    eventId: 'spot-event-4',
    sequence: 4,
    failureCode: 'LOCAL_FAILURE',
    venueOrderTerminal: false,
  });
  assert.equal(unresolved.applied, false);
  assert.equal(unresolved.reason, 'UNRESOLVED_VENUE_ORDER');
  assert.equal(unresolved.state, state);

  state = reduceApplied(state, {
    type: 'FAILED',
    eventId: 'spot-event-4',
    sequence: 4,
    failureCode: 'VENUE_ORDER_TERMINAL',
    venueOrderTerminal: true,
  });
  assert.equal(state.lifecycle, 'FLATTEN_REQUIRED');
  assert.equal(state.cumulativeFilledQuantity, '3');
  assert.equal(spotResidualQuantity(state), '3');
});

test('blind resubmit from UNKNOWN is illegal until absence is explicitly proven', () => {
  let state = reduceApplied(null, prepared());
  state = reduceApplied(state, {
    type: 'SUBMIT_STARTED',
    eventId: 'spot-event-2',
    sequence: 2,
  });
  state = reduceApplied(state, {
    type: 'OUTCOME_AMBIGUOUS',
    eventId: 'spot-event-3',
    sequence: 3,
    cause: 'CANONICAL_ATTEMPT_UNKNOWN',
  });

  const blind = reduceSpotLifecycle(state, {
    type: 'SUBMIT_STARTED',
    eventId: 'spot-event-4',
    sequence: 4,
  });
  assert.equal(blind.applied, false);
  assert.equal(blind.reason, 'INVALID_TRANSITION');

  state = reduceApplied(state, {
    type: 'ORDER_PROVEN_ABSENT',
    eventId: 'spot-event-4',
    sequence: 4,
  });
  assert.equal(state.lifecycle, 'PREPARED');
  state = reduceApplied(state, {
    type: 'SUBMIT_STARTED',
    eventId: 'spot-event-5',
    sequence: 5,
  });
  assert.equal(state.lifecycle, 'SUBMITTING');
  assert.equal(state.originalClientOrderId, CLIENT_ORDER_ID);
});

test('ambiguous cancel preserves the known order and cannot reopen submission', () => {
  let state = reduceApplied(null, prepared());
  state = reduceApplied(state, {
    type: 'SUBMIT_STARTED',
    eventId: 'cancel-event-2',
    sequence: 2,
  });
  state = reduceApplied(state, {
    type: 'ORDER_ACKNOWLEDGED',
    eventId: 'cancel-event-3',
    sequence: 3,
    venueOrderId: 'venue-order-cancel',
    cumulativeFilledQuantity: '0',
  });
  state = reduceApplied(state, {
    type: 'CANCEL_REQUESTED',
    eventId: 'cancel-event-4',
    sequence: 4,
  });
  state = reduceApplied(state, {
    type: 'OUTCOME_AMBIGUOUS',
    eventId: 'cancel-event-5',
    sequence: 5,
    cause: 'CANONICAL_ATTEMPT_UNKNOWN',
  });

  assert.equal(state.lifecycle, 'UNKNOWN');
  assert.equal(state.ambiguityOperation, 'CANCEL');
  assert.equal(state.lifecycleBeforeAmbiguity, 'CANCEL_PENDING');
  assert.equal(state.venueOrderId, 'venue-order-cancel');

  const absent = reduceSpotLifecycle(state, {
    type: 'ORDER_PROVEN_ABSENT',
    eventId: 'cancel-event-6',
    sequence: 6,
  });
  assert.equal(absent.applied, false);
  assert.equal(absent.reason, 'INVALID_TRANSITION');
  assert.equal(absent.state, state);

  const resubmit = reduceSpotLifecycle(state, {
    type: 'SUBMIT_STARTED',
    eventId: 'cancel-event-6',
    sequence: 6,
  });
  assert.equal(resubmit.applied, false);
  assert.equal(resubmit.reason, 'INVALID_TRANSITION');
  assert.equal(resubmit.state, state);
});

test('unresolved submit ambiguity cannot be converted into terminal failure', () => {
  let state = reduceApplied(null, prepared());
  state = reduceApplied(state, {
    type: 'SUBMIT_STARTED',
    eventId: 'unknown-event-2',
    sequence: 2,
  });
  state = reduceApplied(state, {
    type: 'OUTCOME_AMBIGUOUS',
    eventId: 'unknown-event-3',
    sequence: 3,
    cause: 'CANONICAL_ATTEMPT_UNKNOWN',
  });
  assert.equal(state.ambiguityOperation, 'SUBMIT');
  assert.equal(state.lifecycleBeforeAmbiguity, 'SUBMITTING');

  const failed = reduceSpotLifecycle(state, {
    type: 'FAILED',
    eventId: 'unknown-event-4',
    sequence: 4,
    failureCode: 'LOCAL_TIMEOUT',
    venueOrderTerminal: true,
  });
  assert.equal(failed.applied, false);
  assert.equal(failed.reason, 'UNRESOLVED_AMBIGUITY');
  assert.equal(failed.state, state);
});

test('duplicate events are inert and deterministic replay reproduces state', () => {
  const events = [
    prepared(),
    { type: 'SUBMIT_STARTED', eventId: 'spot-event-2', sequence: 2 },
    {
      type: 'ORDER_ACKNOWLEDGED',
      eventId: 'spot-event-3',
      sequence: 3,
      venueOrderId: 'venue-order-replay',
      cumulativeFilledQuantity: '0',
    },
    {
      type: 'FILL_OBSERVED',
      eventId: 'spot-event-4',
      sequence: 4,
      venueOrderId: 'venue-order-replay',
      cumulativeFilledQuantity: '2',
    },
  ];

  const first = replaySpotLifecycle(events);
  assert.equal(first.ok, true);
  const withDuplicate = replaySpotLifecycle([
    ...events,
    { ...events[2] },
  ]);
  assert.equal(withDuplicate.ok, true);
  assert.equal(withDuplicate.duplicateCount, 1);
  assert.deepEqual(withDuplicate.state, first.state);

  const conflict = reduceSpotLifecycle(first.state, {
    type: 'FAILED',
    eventId: 'spot-event-3',
    sequence: 5,
    failureCode: 'CONFLICT',
    venueOrderTerminal: true,
  });
  assert.equal(conflict.applied, false);
  assert.equal(conflict.reason, 'EVENT_ID_CONFLICT');
  assert.equal(conflict.state, first.state);
});

test('fill regressions and overfills fail closed without mutating state', () => {
  let state = reduceApplied(null, prepared());
  state = reduceApplied(state, {
    type: 'SUBMIT_STARTED',
    eventId: 'spot-event-2',
    sequence: 2,
  });
  state = reduceApplied(state, {
    type: 'FILL_OBSERVED',
    eventId: 'spot-event-3',
    sequence: 3,
    venueOrderId: 'venue-order-quantity',
    cumulativeFilledQuantity: '4',
  });

  const regression = reduceSpotLifecycle(state, {
    type: 'FILL_OBSERVED',
    eventId: 'spot-event-4',
    sequence: 4,
    venueOrderId: 'venue-order-quantity',
    cumulativeFilledQuantity: '3',
  });
  assert.equal(regression.applied, false);
  assert.equal(regression.reason, 'FILL_REGRESSION');
  assert.equal(regression.state, state);

  const overfill = reduceSpotLifecycle(state, {
    type: 'FILL_OBSERVED',
    eventId: 'spot-event-4',
    sequence: 4,
    venueOrderId: 'venue-order-quantity',
    cumulativeFilledQuantity: '11',
  });
  assert.equal(overfill.applied, false);
  assert.equal(overfill.reason, 'FILL_EXCEEDS_TARGET');
  assert.equal(overfill.state, state);
});

test('canonical timeout, 5xx, and disconnect observations all query the original ID', () => {
  const ambiguousEvents = [
    { outcome: 'TIMEOUT', httpStatus: null, disconnected: false },
    { outcome: 'SUCCESS', httpStatus: 503, disconnected: false },
    { outcome: 'AMBIGUOUS', httpStatus: null, disconnected: true },
  ];

  for (const transportEvent of ambiguousEvents) {
    let attempt = createRequestAttempt({
      requestId: REQUEST_ID,
      clientOrderId: CLIENT_ORDER_ID,
    });
    const submitted = reduceRequestAttempt(attempt, { kind: 'SUBMIT' });
    assert.equal(submitted.applied, true);
    attempt = submitted.state;
    const observed = reduceRequestAttempt(attempt, {
      kind: 'TRANSPORT_OBSERVED',
      ...transportEvent,
    });
    assert.equal(observed.applied, true);
    attempt = observed.state;

    const policy = decideSpotAttempt({
      canonicalAttempt: attempt,
      killSwitchEngaged: false,
    });
    assert.equal(policy.action, 'QUERY_ORIGINAL_CLIENT_ID');
    assert.equal(policy.queryClientOrderId, CLIENT_ORDER_ID);
    assert.equal(policy.originalClientOrderId, CLIENT_ORDER_ID);
    assert.equal(policy.automaticResubmission, false);

    const duplicateSubmit = reduceRequestAttempt(attempt, {
      kind: 'SUBMIT',
    });
    assert.equal(duplicateSubmit.applied, false);
    assert.equal(
      duplicateSubmit.reasonCode,
      'DUPLICATE_SUBMIT_BLOCKED',
    );
  }
});

test('kill switch is checked before every canonical new-order decision', () => {
  const attempt = createRequestAttempt({
    requestId: REQUEST_ID,
    clientOrderId: CLIENT_ORDER_ID,
  });
  assert.equal(
    decideSpotAttempt({
      canonicalAttempt: attempt,
      killSwitchEngaged: true,
    }).action,
    'STOPPED_BY_KILL_SWITCH',
  );
  assert.equal(
    decideSpotAttempt({
      canonicalAttempt: attempt,
      killSwitchEngaged: false,
    }).action,
    'SUBMIT_NEW_ORDER',
  );
});
