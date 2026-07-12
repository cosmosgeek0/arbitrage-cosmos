import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateSyntheticSubmissionBoundary,
  MUTATION_JOURNAL_LIMITS,
  prepareMutationObservationAppend,
  prepareSyntheticSubmissionObservationAppend,
  reconstructPersistedMutationJournal,
} from '../../../dist/liveEdge/adapters/durableMutationJournal/index.js';
import {
  T0,
  foundationReconciliationObservation,
  inputFixture,
  l03AttemptContentRevision,
  l03HttpAttempt,
  l03SubmittedAttempt,
  observationId,
  persist,
  privateLineage,
  submittingPersisted,
} from './fixtures.mjs';

function submissionObserved(input) {
  const submitting = submittingPersisted(input);
  const decision = evaluateSyntheticSubmissionBoundary(submitting, T0 + 3);
  return persist(prepareSyntheticSubmissionObservationAppend(
    submitting,
    decision,
    l03SubmittedAttempt(submitting),
    T0 + 4,
  ));
}

function httpObservation(label = 'http-ack', overrides = {}) {
  const current = overrides.__current ?? submittingPersisted();
  const {
    __current: _ignored,
    classification = 'ACKNOWLEDGED',
    httpStatus = 200,
    ambiguityCause = null,
    venueOrderId = '1001',
    responseContentRevision = `sha256:${label.charCodeAt(0).toString(16).padStart(2, '0').repeat(32)}`,
  } = overrides;
  const l03RequestAttempt = l03HttpAttempt(current, {
    classification,
    httpStatus,
    ambiguityCause,
  });
  const sourceRevision = l03AttemptContentRevision(l03RequestAttempt);
  const input = {
    kind: 'HTTP_OBSERVED',
    occurredAtMs: T0 + 6,
    // Equal local receipt cuts permit both legal append permutations while
    // preserving the exchange-event-before-receipt relationship.
    receivedAtMs: T0 + 7,
    sourceRevision,
    payload: {
      l03RequestAttempt,
      partialMixed: classification === 'PARTIAL_MIXED',
      venueOrderId,
      responseContentRevision: l03RequestAttempt.httpStatus === null
        ? null
        : responseContentRevision,
    },
  };
  return { observationId: observationId(current, input), ...input };
}

function privateOrder(label = 'private-new', overrides = {}) {
  const current = overrides.__current ?? submittingPersisted();
  const {
    __current: _ignored,
    __receivedAtMs = null,
    ...payloadOverrides
  } = overrides;
  const exchangeEventTimeMs = overrides.exchangeEventTimeMs ?? T0 + 5;
  const receivedAtMs = __receivedAtMs ?? exchangeEventTimeMs + 2;
  const connectionGeneration = overrides.connectionGeneration ?? 1;
  const status = overrides.status ?? 'NEW';
  const cumulativeFilledQuantity = overrides.cumulativeFilledQuantity ?? '0';
  const venueOrderId = overrides.venueOrderId === undefined ? '1001' : overrides.venueOrderId;
  const lineage = privateLineage(current, `order:${label}`, {
    observationKind: 'ORDER', exchangeEventTimeMs, receiptTimeMs: receivedAtMs,
    generation: connectionGeneration,
    fact: {
      status, cumulativeFilledQuantity, venueOrderId,
      exchangeEventTimeMs, connectionGeneration,
    },
  });
  const input = {
    kind: 'PRIVATE_ORDER_OBSERVED',
    occurredAtMs: exchangeEventTimeMs,
    receivedAtMs,
    sourceRevision: lineage.privateEventRevision,
    payload: {
      product: current.snapshot.identity.product,
      accountRealmId: current.snapshot.identity.accountRealmId,
      symbol: current.snapshot.identity.symbol,
      clientOrderId: current.snapshot.identity.clientOrderId,
      status,
      cumulativeFilledQuantity,
      venueOrderId,
      exchangeEventTimeMs,
      connectionGeneration,
      ...lineage,
      ...payloadOverrides,
    },
  };
  return { observationId: observationId(current, input), ...input };
}

function privateFill(label = 'private-fill', overrides = {}) {
  const current = overrides.__current ?? submittingPersisted();
  const {
    __current: _ignored,
    __receivedAtMs = null,
    ...payloadOverrides
  } = overrides;
  const exchangeEventTimeMs = overrides.exchangeEventTimeMs ?? T0 + 8;
  const receivedAtMs = __receivedAtMs ?? exchangeEventTimeMs + 1;
  const connectionGeneration = overrides.connectionGeneration ?? 1;
  const tradeId = overrides.tradeId ?? '5001';
  const fillQuantity = overrides.fillQuantity ?? '0.4';
  const cumulativeFilledQuantity = overrides.cumulativeFilledQuantity ?? '0.4';
  const venueOrderId = overrides.venueOrderId === undefined ? '1001' : overrides.venueOrderId;
  const lineage = privateLineage(current, `fill:${label}`, {
    observationKind: 'FILL', exchangeEventTimeMs, receiptTimeMs: receivedAtMs,
    generation: connectionGeneration,
    fact: {
      tradeId, fillQuantity, cumulativeFilledQuantity, venueOrderId,
      exchangeEventTimeMs, connectionGeneration,
    },
  });
  const input = {
    kind: 'PRIVATE_FILL_OBSERVED',
    occurredAtMs: exchangeEventTimeMs,
    receivedAtMs,
    sourceRevision: lineage.privateEventRevision,
    payload: {
      product: current.snapshot.identity.product,
      accountRealmId: current.snapshot.identity.accountRealmId,
      symbol: current.snapshot.identity.symbol,
      clientOrderId: current.snapshot.identity.clientOrderId,
      tradeId,
      fillQuantity,
      cumulativeFilledQuantity,
      venueOrderId,
      exchangeEventTimeMs,
      connectionGeneration,
      ...lineage,
      ...payloadOverrides,
    },
  };
  return { observationId: observationId(current, input), ...input };
}

function append(current, observation) {
  const result = prepareMutationObservationAppend(current, observation);
  assert.equal(result.kind, 'PREPARED', JSON.stringify(result));
  return persist(result.prepared);
}

function appendAll(observations, input) {
  let current = submissionObserved(input);
  for (const observation of observations) current = append(current, observation);
  return current;
}

test('private event before HTTP and HTTP before private event converge semantically', () => {
  const http = httpObservation();
  const event = privateOrder();
  const eventFirst = appendAll([event, http]);
  const httpFirst = appendAll([http, event]);
  assert.notEqual(eventFirst.snapshot.headDigest, httpFirst.snapshot.headDigest);
  assert.equal(eventFirst.snapshot.outcomeRevision, httpFirst.snapshot.outcomeRevision);
  assert.deepEqual(eventFirst.snapshot.projection, httpFirst.snapshot.projection);
  assert.equal(eventFirst.snapshot.projection.lifecycle, 'NEW');
  assert.equal(eventFirst.snapshot.projection.httpAcknowledged, true);
  assert.equal(eventFirst.snapshot.projection.cumulativeFilledQuantity, '0');
});

test('acknowledgement never manufactures working or fill truth', () => {
  const acknowledged = appendAll([httpObservation()]);
  assert.equal(acknowledged.snapshot.projection.lifecycle, 'ACKNOWLEDGED');
  assert.equal(acknowledged.snapshot.projection.workingStatus, null);
  assert.equal(acknowledged.snapshot.projection.cumulativeFilledQuantity, '0');
  assert.equal(acknowledged.snapshot.projection.reconciled, false);
  assert.equal(acknowledged.snapshot.projection.recoveryRequired, true);
});

test('accepted PENDING_NEW remains non-working acknowledgement evidence', () => {
  const pending = appendAll([privateOrder('pending-new', {
    status: 'PENDING_NEW',
    cumulativeFilledQuantity: '0',
  })]);
  assert.equal(pending.snapshot.projection.workingStatus, 'PENDING_NEW');
  assert.equal(pending.snapshot.projection.lifecycle, 'ACKNOWLEDGED');
  assert.equal(pending.snapshot.projection.cumulativeFilledQuantity, '0');
  assert.equal(pending.snapshot.projection.recoveryRequired, true);
  assert.throws(() => prepareMutationObservationAppend(pending, privateOrder('pending-filled', {
    __current: pending,
    status: 'PENDING_NEW',
    cumulativeFilledQuantity: '0.1',
  })));
});

test('PENDING_NEW after a terminal event is a named lifecycle regression', () => {
  const canceled = privateOrder('pending-regression-canceled', {
    status: 'CANCELED',
    cumulativeFilledQuantity: '0',
    exchangeEventTimeMs: T0 + 10,
  });
  const pending = privateOrder('pending-regression-pending', {
    status: 'PENDING_NEW',
    cumulativeFilledQuantity: '0',
    exchangeEventTimeMs: T0 + 11,
  });
  const state = appendAll([canceled, pending]);
  assert.equal(state.snapshot.projection.lifecycle, 'CONFLICT');
  assert.ok(state.snapshot.projection.conflictCodes.includes('TERMINAL_TO_WORKING_REGRESSION'));
});

test('accepted private future skew uses local receipt for journal causality and replay', () => {
  const input = inputFixture({
    bindings: {
      sourceExchangeEventAtMs: null,
      sourceLocalReceiveAtMs: null,
      exchangeClockCalibrationRevision: null,
    },
  });
  const current = submissionObserved(input);
  const skewed = privateOrder('future-skew', {
    __current: current,
    status: 'NEW',
    cumulativeFilledQuantity: '0',
    exchangeEventTimeMs: T0 + 20,
    __receivedAtMs: T0 + 15,
  });
  const appended = append(current, skewed);
  assert.equal(appended.snapshot.projection.lifecycle, 'NEW');
  const replayed = reconstructPersistedMutationJournal(
    appended.snapshot.entries,
    appended.acknowledgement,
  );
  assert.ok(replayed);
  assert.equal(replayed.snapshot.outcomeRevision, appended.snapshot.outcomeRevision);

  assert.throws(() => prepareMutationObservationAppend(appended, privateOrder('too-far-future', {
    __current: appended,
    status: 'NEW',
    cumulativeFilledQuantity: '0',
    exchangeEventTimeMs: T0 + 3_000,
    __receivedAtMs: T0 + 15,
  })));
});

test('terminal private event before HTTP acknowledgement converges without false fill', () => {
  const terminal = privateOrder('terminal-before-http', {
    status: 'CANCELED',
    cumulativeFilledQuantity: '0',
  });
  const http = httpObservation('late-http');
  const eventFirst = appendAll([terminal, http]);
  const httpFirst = appendAll([http, terminal]);
  assert.equal(eventFirst.snapshot.outcomeRevision, httpFirst.snapshot.outcomeRevision);
  assert.deepEqual(eventFirst.snapshot.projection, httpFirst.snapshot.projection);
  assert.equal(eventFirst.snapshot.projection.lifecycle, 'CANCELED');
  assert.equal(eventFirst.snapshot.projection.cumulativeFilledQuantity, '0');
  assert.equal(eventFirst.snapshot.projection.reconciled, false);
});

test('fill-before-cancel exchange truth converges across delayed arrival permutations', () => {
  const canceled = privateOrder('cancel-race', {
    status: 'CANCELED',
    cumulativeFilledQuantity: '1',
    exchangeEventTimeMs: T0 + 9,
    __receivedAtMs: T0 + 11,
  });
  const fill = privateFill('fill-race', {
    tradeId: '5101',
    fillQuantity: '1',
    cumulativeFilledQuantity: '1',
    exchangeEventTimeMs: T0 + 8,
    __receivedAtMs: T0 + 11,
  });
  const cancelFirst = appendAll([canceled, fill]);
  const fillFirst = appendAll([fill, canceled]);
  assert.equal(cancelFirst.snapshot.outcomeRevision, fillFirst.snapshot.outcomeRevision);
  assert.deepEqual(cancelFirst.snapshot.projection, fillFirst.snapshot.projection);
  assert.equal(cancelFirst.snapshot.projection.cumulativeFilledQuantity, '1');
  assert.equal(cancelFirst.snapshot.projection.terminalStatus, 'CANCELED');
  assert.deepEqual(cancelFirst.snapshot.projection.tradeIds, ['5101']);
  assert.equal(cancelFirst.snapshot.projection.recoveryRequired, true);
});

test('fill exchange truth after cancel/expiry/rejection is a named conflict in either arrival order', () => {
  for (const status of ['CANCELED', 'EXPIRED', 'REJECTED']) {
    const terminal = privateOrder(`terminal-before-fill-${status}`, {
      status,
      cumulativeFilledQuantity: status === 'REJECTED' ? '0' : '0.4',
      exchangeEventTimeMs: T0 + 9,
      __receivedAtMs: T0 + 11,
    });
    const fill = privateFill(`late-fill-${status}`, {
      tradeId: status === 'CANCELED' ? '5201' : status === 'EXPIRED' ? '5202' : '5203',
      fillQuantity: '0.6',
      cumulativeFilledQuantity: '1',
      exchangeEventTimeMs: T0 + 10,
      __receivedAtMs: T0 + 11,
    });
    for (const observations of [[terminal, fill], [fill, terminal]]) {
      const state = appendAll(observations);
      assert.equal(state.snapshot.projection.lifecycle, 'CONFLICT', status);
      assert.ok(
        state.snapshot.projection.conflictCodes.includes('FILL_AFTER_TERMINAL_EFFECT_CONFLICT'),
        status,
      );
      assert.equal(state.snapshot.projection.cumulativeFilledQuantity, '1');
      assert.equal(state.snapshot.projection.recoveryRequired, true);
    }
  }
});

test('partial fill and later cancel retain actual fill and require reconciliation', () => {
  const partialOrder = privateOrder('partial-order', {
    status: 'PARTIALLY_FILLED',
    cumulativeFilledQuantity: '0.4',
    exchangeEventTimeMs: T0 + 8,
  });
  const canceled = privateOrder('canceled-order', {
    status: 'CANCELED',
    cumulativeFilledQuantity: '0.4',
    exchangeEventTimeMs: T0 + 10,
  });
  const state = appendAll([privateFill(), partialOrder, canceled]);
  assert.equal(state.snapshot.projection.lifecycle, 'CANCELED');
  assert.equal(state.snapshot.projection.cumulativeFilledQuantity, '0.4');
  assert.deepEqual(state.snapshot.projection.tradeIds, ['5001']);
  assert.equal(state.snapshot.projection.reconciled, false);
  assert.equal(state.snapshot.projection.recoveryRequired, true);
});

test('same observation replay is idempotent while identity reuse with changed content conflicts', () => {
  const observation = privateOrder();
  const current = appendAll([observation]);
  const duplicate = prepareMutationObservationAppend(current, observation);
  assert.equal(duplicate.kind, 'EXACT_DUPLICATE');
  assert.equal(duplicate.persisted.snapshot.headDigest, current.snapshot.headDigest);

  const validChangedObservation = privateOrder('private-changed', {
    __current: current,
    status: 'PARTIALLY_FILLED',
    cumulativeFilledQuantity: '0.2',
  });
  const changed = prepareMutationObservationAppend(current, {
    ...validChangedObservation,
    observationId: observation.observationId,
  });
  assert.equal(changed.kind, 'IDENTITY_CONFLICT');
  assert.ok(changed.preparedConflict);
  const poisoned = persist(changed.preparedConflict);
  assert.equal(poisoned.snapshot.projection.lifecycle, 'CONFLICT');
  assert.ok(poisoned.snapshot.projection.conflictCodes.includes('OBSERVATION_ID_CONTENT_CONFLICT'));
  const replayed = reconstructPersistedMutationJournal(
    poisoned.snapshot.entries,
    poisoned.acknowledgement,
  );
  assert.ok(replayed);
  assert.ok(replayed.snapshot.projection.conflictCodes.includes('OBSERVATION_ID_CONTENT_CONFLICT'));
});

test('private evidence is realm/product/symbol/client-order bound and observation IDs are content-derived', () => {
  const current = submissionObserved();
  const valid = privateOrder('identity-bound', { __current: current });
  const foreign = {
    ...valid,
    payload: { ...valid.payload, accountRealmId: 'account-realm:foreign' },
  };
  const { observationId: _foreignPriorId, ...foreignIdentityMaterial } = foreign;
  assert.throws(() => observationId(current, foreignIdentityMaterial), TypeError);
  foreign.observationId = valid.observationId;
  assert.throws(() => prepareMutationObservationAppend(current, foreign), TypeError);
  assert.throws(() => prepareMutationObservationAppend(current, {
    ...valid,
    observationId: `l06obs_${'0'.repeat(64)}`,
  }), TypeError);

  for (const payload of [
    { ...valid.payload, connectionGeneration: 2 },
    { ...valid.payload, privateContentRevision: `spot_content_${'0'.repeat(32)}` },
    { ...valid.payload, privateReceiptTimeMs: valid.payload.privateReceiptTimeMs + 1 },
  ]) {
    assert.throws(() => observationId(current, {
      kind: valid.kind,
      occurredAtMs: valid.occurredAtMs,
      receivedAtMs: valid.receivedAtMs,
      sourceRevision: valid.sourceRevision,
      payload,
    }), TypeError);
  }
});

test('USD-M private observations consume an exact content-bound L05 marker', () => {
  const input = inputFixture({
    identity: {
      product: 'USD_M_PERPETUAL',
      contractId: 'USDM_ORDER_POST',
      signerProfile: 'USDM_HMAC_SHA256',
    },
  });
  const current = submissionObserved(input);
  const valid = privateOrder('usdm-owner-marker', { __current: current });
  const next = append(current, valid);
  assert.equal(next.snapshot.projection.lifecycle, 'NEW');
  assert.match(valid.payload.privateEventRevision, /^usdm_event_[0-9a-f]{32}$/);
  assert.throws(() => observationId(current, {
    kind: valid.kind,
    occurredAtMs: valid.occurredAtMs,
    receivedAtMs: valid.receivedAtMs,
    sourceRevision: valid.sourceRevision,
    payload: { ...valid.payload, privateSemanticCategory: 'FILL' },
  }), TypeError);
});

test('older compatible observations cannot regress cumulative fill and real regression conflicts', () => {
  const newer = privateOrder('newer', {
    status: 'PARTIALLY_FILLED',
    cumulativeFilledQuantity: '0.7',
    exchangeEventTimeMs: T0 + 20,
  });
  const older = privateOrder('older', {
    status: 'PARTIALLY_FILLED',
    cumulativeFilledQuantity: '0.4',
    exchangeEventTimeMs: T0 + 10,
    __receivedAtMs: T0 + 23,
  });
  const compatible = appendAll([newer, older]);
  assert.equal(compatible.snapshot.projection.cumulativeFilledQuantity, '0.7');
  assert.equal(compatible.snapshot.projection.conflictCodes.includes('CUMULATIVE_FILL_REGRESSION'), false);

  const regressed = privateOrder('regressed', {
    status: 'PARTIALLY_FILLED',
    cumulativeFilledQuantity: '0.3',
    exchangeEventTimeMs: T0 + 30,
  });
  const conflicted = append(compatible, regressed);
  assert.equal(conflicted.snapshot.projection.lifecycle, 'CONFLICT');
  assert.ok(conflicted.snapshot.projection.conflictCodes.includes('CUMULATIVE_FILL_REGRESSION'));
});

test('fill-only and fill-to-order cumulative regressions remain named conflicts', () => {
  const firstFill = privateFill('cumulative-0-8', {
    tradeId: '6101',
    fillQuantity: '0.4',
    cumulativeFilledQuantity: '0.8',
    exchangeEventTimeMs: T0 + 20,
  });
  const laterFill = privateFill('cumulative-0-4', {
    tradeId: '6102',
    fillQuantity: '0.1',
    cumulativeFilledQuantity: '0.4',
    exchangeEventTimeMs: T0 + 30,
  });
  const fillRegression = appendAll([firstFill, laterFill]);
  assert.ok(fillRegression.snapshot.projection.conflictCodes.includes('CUMULATIVE_FILL_REGRESSION'));

  const laterOrder = privateOrder('order-cumulative-0-4', {
    status: 'PARTIALLY_FILLED',
    cumulativeFilledQuantity: '0.4',
    exchangeEventTimeMs: T0 + 30,
  });
  const crossFactRegression = appendAll([firstFill, laterOrder]);
  assert.ok(crossFactRegression.snapshot.projection.conflictCodes.includes('CUMULATIVE_FILL_REGRESSION'));
});

test('forked L03 terminal observations and ACK plus rejection are durable conflicts', () => {
  const acknowledged = httpObservation('ack-fork', {
    classification: 'ACKNOWLEDGED',
    httpStatus: 200,
    venueOrderId: '1001',
  });
  const rejected = httpObservation('reject-fork', {
    classification: 'REJECTED_RESPONSE',
    httpStatus: 400,
    venueOrderId: null,
  });
  const state = appendAll([acknowledged, rejected]);
  assert.equal(state.snapshot.projection.lifecycle, 'CONFLICT');
  assert.ok(state.snapshot.projection.conflictCodes.includes('L03_ATTEMPT_REVISION_FORK'));
  assert.ok(state.snapshot.projection.conflictCodes.includes('HTTP_ACK_REJECTION_CONFLICT'));
});

test('timeout, disconnect, 408, and 5xx stay explicit while HTTP partial-mixed remains contract-gapped', () => {
  const tuples = [
    ['TRANSPORT_TIMEOUT', null],
    ['TRANSPORT_DISCONNECTED', null],
    ['HTTP_408', 408],
    ['HTTP_5XX', 500],
  ];
  for (const [index, [cause, status]] of tuples.entries()) {
    const state = appendAll([httpObservation(`amb-${index}`, {
      classification: 'AMBIGUOUS',
      httpStatus: status,
      ambiguityCause: cause,
      venueOrderId: null,
    })]);
    assert.equal(state.snapshot.projection.lifecycle, 'UNKNOWN', cause);
    assert.ok(state.snapshot.projection.ambiguityCauses.includes(cause));
    assert.equal(state.snapshot.projection.recoveryRequired, true);
  }
  const usdmInput = inputFixture({
    identity: {
      product: 'USD_M_PERPETUAL',
      contractId: 'USDM_ORDER_POST',
      contractState: 'CURRENT',
      signerProfile: 'USDM_HMAC_SHA256',
    },
  });
  const usdmContext = submittingPersisted(usdmInput);
  const usdmState = appendAll([httpObservation('amb-usdm-503', {
    __current: usdmContext,
    classification: 'AMBIGUOUS',
    httpStatus: 503,
    ambiguityCause: 'HTTP_5XX',
    venueOrderId: null,
  })], usdmInput);
  assert.equal(usdmState.snapshot.projection.lifecycle, 'UNKNOWN');
  assert.ok(usdmState.snapshot.projection.ambiguityCauses.includes('HTTP_5XX'));
  const current = submissionObserved();
  assert.throws(() => prepareMutationObservationAppend(current, httpObservation('partial-mixed', {
    classification: 'PARTIAL_MIXED',
    httpStatus: 409,
    ambiguityCause: 'CANCEL_REPLACE_PARTIAL',
    venueOrderId: null,
  })));
});

test('ambiguous and rejected HTTP outcomes retain private axes but stay UNKNOWN until exact owner reconciliation', () => {
  const responseCases = [
    ['timeout', 'AMBIGUOUS', null, 'TRANSPORT_TIMEOUT'],
    ['disconnect', 'AMBIGUOUS', null, 'TRANSPORT_DISCONNECTED'],
    ['http-408', 'AMBIGUOUS', 408, 'HTTP_408'],
    ['http-5xx', 'AMBIGUOUS', 500, 'HTTP_5XX'],
    ['http-4xx', 'REJECTED_RESPONSE', 400, null],
  ];
  const privateCases = [
    ['NEW', '0'],
    ['FILLED', '1'],
    ['CANCELED', '0'],
  ];
  for (const [label, classification, httpStatus, ambiguityCause] of responseCases) {
    for (const [status, cumulativeFilledQuantity] of privateCases) {
      const response = httpObservation(`${label}-${status}`, {
        classification,
        httpStatus,
        ambiguityCause,
        venueOrderId: null,
      });
      const ownerEvent = privateOrder(`${label}-${status}`, {
        status,
        cumulativeFilledQuantity,
        exchangeEventTimeMs: T0 + 5,
        __receivedAtMs: T0 + 7,
      });
      for (const observations of [[response, ownerEvent], [ownerEvent, response]]) {
        const state = appendAll(observations);
        assert.equal(state.snapshot.projection.lifecycle, 'UNKNOWN', `${label}/${status}`);
        assert.equal(state.snapshot.projection.workingStatus, status, `${label}/${status}`);
        assert.equal(state.snapshot.projection.cumulativeFilledQuantity, cumulativeFilledQuantity);
        assert.equal(state.snapshot.projection.recoveryRequired, true);
        assert.equal(state.snapshot.projection.reconciled, false);
        if (ambiguityCause !== null) {
          assert.ok(state.snapshot.projection.ambiguityCauses.includes(ambiguityCause));
        }
        if (classification === 'REJECTED_RESPONSE') {
          assert.equal(state.snapshot.projection.httpRejectedResponseSeen, true);
          assert.equal(state.snapshot.projection.conflictCodes.length, 0);
        }
      }
    }
  }
});

test('exact current Foundation owner truth is the only boundary that clears ambiguous or 4xx-plus-fill UNKNOWN', () => {
  for (const [label, classification, httpStatus, ambiguityCause] of [
    ['timeout', 'AMBIGUOUS', null, 'TRANSPORT_TIMEOUT'],
    ['http-4xx', 'REJECTED_RESPONSE', 400, null],
  ]) {
    const response = httpObservation(`reconcile-${label}`, {
      classification,
      httpStatus,
      ambiguityCause,
      venueOrderId: null,
    });
    const filled = privateOrder(`reconcile-${label}-filled`, {
      status: 'FILLED',
      cumulativeFilledQuantity: '1',
      exchangeEventTimeMs: T0 + 5,
      __receivedAtMs: T0 + 7,
    });
    const unknown = appendAll([response, filled]);
    assert.equal(unknown.snapshot.projection.lifecycle, 'UNKNOWN');
    const owner = foundationReconciliationObservation(unknown, {
      label: `reconcile-${label}`,
      effect: 'FILLED',
      cumulativeFilledQuantity: '1',
      venueOrderId: '1001',
      observedAtMs: T0 + 30,
    });
    const reconciled = append(unknown, owner);
    assert.equal(reconciled.snapshot.projection.lifecycle, 'RECONCILED');
    assert.equal(reconciled.snapshot.projection.reconciled, true);
    assert.equal(reconciled.snapshot.projection.recoveryRequired, false);
  }
});

test('private-order family capacity cannot consume reserved reconciliation capacity', () => {
  let current = submissionObserved();
  for (let index = 0; index < MUTATION_JOURNAL_LIMITS.maximumPrivateOrderEntries; index += 1) {
    current = append(current, privateOrder(`bounded-${index}`, {
      __current: current,
      status: 'NEW',
      cumulativeFilledQuantity: '0',
      exchangeEventTimeMs: T0 + 20 + index,
    }));
  }
  assert.throws(() => prepareMutationObservationAppend(current, privateOrder('over-capacity', {
    __current: current,
    status: 'NEW',
    cumulativeFilledQuantity: '0',
    exchangeEventTimeMs: T0 + 100,
  })), RangeError);
  const owner = foundationReconciliationObservation(current, {
    label: 'capacity-reserved-reconciliation',
    status: 'PENDING',
    effect: 'UNKNOWN',
    cumulativeFilledQuantity: null,
    venueOrderId: '1001',
    observedAtMs: T0 + 200,
  });
  const reconciledEvidence = append(current, owner);
  assert.equal(reconciledEvidence.snapshot.projection.reconciliationStatus, 'PENDING');
  assert.equal(reconciledEvidence.snapshot.projection.recoveryRequired, true);
});

test('fill evidence rejects null venue IDs, zero fills, overfills, and unsafe exact decimals', () => {
  const current = submissionObserved();
  for (const payload of [
    { venueOrderId: null },
    { fillQuantity: '0' },
    { cumulativeFilledQuantity: '1.1' },
    { fillQuantity: '1e-1' },
    { cumulativeFilledQuantity: '-1' },
  ]) {
    assert.throws(() => prepareMutationObservationAppend(current, privateFill('bad-fill', payload)));
  }
  assert.throws(() => prepareMutationObservationAppend(current, privateOrder('rejected-positive-fill', {
    __current: current,
    status: 'REJECTED',
    cumulativeFilledQuantity: '0.1',
  })));
});

test('connection generation cannot make a later exchange status regress terminal truth', () => {
  const current = submissionObserved();
  const terminal = append(current, privateOrder('terminal-generation-1', {
    __current: current,
    status: 'FILLED',
    cumulativeFilledQuantity: '1',
    exchangeEventTimeMs: T0 + 10,
    connectionGeneration: 1,
  }));
  const regressed = append(terminal, privateOrder('working-generation-2', {
    __current: terminal,
    status: 'NEW',
    cumulativeFilledQuantity: '0',
    exchangeEventTimeMs: T0 + 11,
    connectionGeneration: 2,
  }));
  assert.equal(regressed.snapshot.projection.lifecycle, 'CONFLICT');
  assert.ok(regressed.snapshot.projection.conflictCodes.includes('TERMINAL_TO_WORKING_REGRESSION'));
});
