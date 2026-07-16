import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkpointExchangeTwin,
  createExchangeTwinState,
  reduceExchangeTwinEvent,
  restoreExchangeTwin,
  runExchangeTwinScenario,
} from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  T0,
  baselineEvents,
  cancelArrivalEvidence,
  cancelFixture,
  event,
  orderByFixtureId,
  orderFixture,
  scenarioInput,
} from './fixtures.mjs';

function checkpointRoundTrip(state) {
  const restored = restoreExchangeTwin(checkpointExchangeTwin(state));
  assert.deepEqual(
    JSON.parse(JSON.stringify(restored)),
    JSON.parse(JSON.stringify(state)),
  );
  assert.equal(restored.stateRevision, state.stateRevision);
  assert.equal(restored.outcomeRevision, state.outcomeRevision);
  assert.ok(Object.isFrozen(restored));
  return restored;
}

function nextSequence(state) {
  return Math.max(0, ...state.processedEvents.map((candidate) => candidate.sequence)) + 1;
}

function latestTime(state) {
  return Math.max(T0, ...state.processedEvents.map((candidate) => candidate.occurredAtMs));
}

function crashAndRestart(state, label) {
  const sequence = nextSequence(state);
  const occurredAtMs = latestTime(state) + 10;
  const crashId = `crash-durable-${label.toLowerCase().replaceAll('_', '-')}-0001`;
  const crashed = reduceExchangeTwinEvent(state, event('CRASH', sequence, occurredAtMs, {
    crashId,
    dropLocalDeliveries: true,
    dropPendingCommands: true,
  }));
  return reduceExchangeTwinEvent(crashed, event('RESTART', sequence + 1, occurredAtMs + 10, {
    crashId,
  }));
}

function reconcile(state, fixtureId, suffix) {
  const order = orderByFixtureId(state, fixtureId);
  const sequence = nextSequence(state);
  return reduceExchangeTwinEvent(state, event(
    'RECONCILIATION_OBSERVATION',
    sequence,
    latestTime(state) + 10,
    {
      fixtureId,
      ownerObservationRevision: `owner-durable-${suffix}:${'7'.repeat(24)}`,
      observedVenueRevision: order.venueRevision,
      observedStatus: order.venueStatus,
      observedFilledQuantity: order.filledQuantity,
    },
  ));
}

function notDispatchedState() {
  const fixture = orderFixture({ fixtureId: 'fixture-durable-not-dispatched-0001' });
  return {
    label: 'NOT_DISPATCHED',
    fixture,
    state: createExchangeTwinState(scenarioInput({ fixture, events: [] })),
    venueStatus: 'NOT_ARRIVED',
    dispatched: false,
  };
}

function blockedState() {
  const fixture = orderFixture({ fixtureId: 'fixture-durable-blocked-0001' });
  const events = baselineEvents(fixture).map((candidate) => candidate.kind === 'SYMBOL_STATUS'
    ? event('SYMBOL_STATUS', candidate.sequence, candidate.occurredAtMs, {
      ...candidate.payload,
      status: 'HALT',
      evidenceRevision: `symbol-durable-blocked:${'1'.repeat(24)}`,
    })
    : candidate);
  return {
    label: 'BLOCKED',
    fixture,
    state: runExchangeTwinScenario(scenarioInput({ fixture, events })),
    venueStatus: 'BLOCKED',
    dispatched: true,
  };
}

function expiredState() {
  const fixture = orderFixture({
    fixtureId: 'fixture-durable-expired-0001',
    price: '100',
    quantity: '0.02',
    timeInForce: 'IOC',
  });
  const events = baselineEvents(fixture, {
    asks: [{ price: '100', quantity: '0.01' }],
  });
  return {
    label: 'EXPIRED',
    fixture,
    state: runExchangeTwinScenario(scenarioInput({ fixture, events })),
    venueStatus: 'EXPIRED',
    dispatched: true,
  };
}

function canceledState() {
  const fixture = orderFixture({
    fixtureId: 'fixture-durable-canceled-0001',
    price: '99',
    quantity: '0.01',
  });
  const venueState = runExchangeTwinScenario(scenarioInput({
    fixture,
    events: baselineEvents(fixture, {
      bids: [{ price: '98', quantity: '0.1' }],
      asks: [{ price: '100', quantity: '0.1' }],
    }),
  }));
  const cancel = cancelFixture(fixture, {
    cancelFixtureId: 'cancel-durable-canceled-0001',
    rateAtMs: T0 + 50,
  });
  const dispatch = event('CANCEL_DISPATCH', 9, T0 + 45, {
    fixtureId: fixture.fixtureId,
    cancelFixture: cancel,
  });
  const arrival = event(
    'CANCEL_ARRIVAL',
    10,
    T0 + 50,
    cancelArrivalEvidence(cancel, fixture.fixtureId, T0 + 50),
  );
  return {
    label: 'CANCELED',
    fixture,
    state: reduceExchangeTwinEvent(reduceExchangeTwinEvent(venueState, dispatch), arrival),
    venueStatus: 'CANCELED',
    dispatched: true,
  };
}

function observedState() {
  const fixture = orderFixture({ fixtureId: 'fixture-durable-observed-0001' });
  const venueState = runExchangeTwinScenario(scenarioInput({ fixture }));
  return {
    label: 'OBSERVED_RECONCILED',
    fixture,
    state: reconcile(venueState, fixture.fixtureId, 'initial-observed'),
    venueStatus: 'FILLED',
    dispatched: true,
  };
}

test('every durable order state survives checkpoint, crash, restart and reconciliation exactly', () => {
  for (const row of [
    notDispatchedState(),
    blockedState(),
    expiredState(),
    canceledState(),
    observedState(),
  ]) {
    const before = checkpointRoundTrip(row.state);
    const beforeOrder = orderByFixtureId(before, row.fixture.fixtureId);
    assert.equal(beforeOrder.venueStatus, row.venueStatus, row.label);
    if (row.label === 'OBSERVED_RECONCILED') {
      assert.equal(beforeOrder.localTruth, 'OBSERVED', row.label);
      assert.equal(beforeOrder.recoveryRequired, false, row.label);
    }

    const restarted = checkpointRoundTrip(crashAndRestart(before, row.label));
    const restartedOrder = orderByFixtureId(restarted, row.fixture.fixtureId);
    assert.equal(restartedOrder.venueStatus, beforeOrder.venueStatus, row.label);
    assert.equal(restartedOrder.venueRevision, beforeOrder.venueRevision, row.label);
    assert.equal(restartedOrder.filledQuantity, beforeOrder.filledQuantity, row.label);
    assert.equal(restartedOrder.remainingQuantity, beforeOrder.remainingQuantity, row.label);
    assert.equal(restartedOrder.expiredQuantity, beforeOrder.expiredQuantity, row.label);
    assert.deepEqual(restartedOrder.fills, beforeOrder.fills, row.label);
    assert.deepEqual(restarted.book, before.book, row.label);
    assert.equal(restartedOrder.recoveryRequired, row.dispatched, row.label);

    if (row.dispatched) {
      assert.equal(restartedOrder.localTruth, 'RECOVERY_REQUIRED', row.label);
      const reconciled = checkpointRoundTrip(reconcile(
        restarted,
        row.fixture.fixtureId,
        `post-restart-${row.label.toLowerCase()}`,
      ));
      const reconciledOrder = orderByFixtureId(reconciled, row.fixture.fixtureId);
      assert.equal(reconciledOrder.localTruth, 'OBSERVED', row.label);
      assert.equal(reconciledOrder.recoveryRequired, false, row.label);
      assert.equal(reconciledOrder.venueStatus, beforeOrder.venueStatus, row.label);
      assert.equal(reconciledOrder.venueRevision, beforeOrder.venueRevision, row.label);
      assert.deepEqual(reconciledOrder.fills, beforeOrder.fills, row.label);
      assert.deepEqual(reconciled.book, before.book, row.label);
    } else {
      assert.equal(restartedOrder.localTruth, beforeOrder.localTruth, row.label);
    }
  }
});
