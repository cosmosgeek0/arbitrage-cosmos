import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMutationReconciliationHandoff,
  evaluateSyntheticSubmissionBoundary,
  prepareMutationObservationAppend,
  prepareSyntheticSubmissionObservationAppend,
} from '../../../dist/liveEdge/adapters/durableMutationJournal/index.js';
import {
  T0,
  foundationReconciliationObservation as canonicalReconciliationObservation,
  inputFixture,
  l03SubmittedAttempt,
  observationId,
  persist,
  privateLineage,
  submittingPersisted,
} from './fixtures.mjs';

function submitted() {
  const current = submittingPersisted();
  return persist(prepareSyntheticSubmissionObservationAppend(
    current,
    evaluateSyntheticSubmissionBoundary(current, T0 + 3),
    l03SubmittedAttempt(current),
    T0 + 4,
  ));
}

function append(current, observation) {
  const result = prepareMutationObservationAppend(current, observation);
  assert.equal(result.kind, 'PREPARED');
  return persist(result.prepared);
}

function orderObservation(current, status, cumulative, time, label) {
  const lineage = privateLineage(current, `reconciliation-order:${label}`, {
    observationKind: 'ORDER', exchangeEventTimeMs: time, receiptTimeMs: time + 1,
    fact: {
      status,
      cumulativeFilledQuantity: cumulative,
      venueOrderId: '1001',
      exchangeEventTimeMs: time,
      connectionGeneration: 1,
    },
  });
  const input = {
    kind: 'PRIVATE_ORDER_OBSERVED',
    occurredAtMs: time,
    receivedAtMs: time + 1,
    sourceRevision: lineage.privateEventRevision,
    payload: {
      product: current.snapshot.identity.product,
      accountRealmId: current.snapshot.identity.accountRealmId,
      symbol: current.snapshot.identity.symbol,
      clientOrderId: current.snapshot.identity.clientOrderId,
      status,
      cumulativeFilledQuantity: cumulative,
      venueOrderId: '1001',
      exchangeEventTimeMs: time,
      connectionGeneration: 1,
      ...lineage,
    },
  };
  return { observationId: observationId(current, input), ...input };
}

function reconciliationObservation(current, overrides = {}) {
  return canonicalReconciliationObservation(current, overrides);
}

test('reconciliation handoff is deterministic identity-only evidence with no query/retry authority', () => {
  const current = submitted();
  const handoff = buildMutationReconciliationHandoff(current);
  assert.equal(handoff.ownerTarget, 'FOUNDATION_RECONCILIATION');
  assert.equal(handoff.clientOrderId, current.snapshot.identity.clientOrderId);
  assert.equal(handoff.queryIdentityOnly, true);
  assert.equal(handoff.queryAuthorized, false);
  assert.equal(handoff.retryAuthorized, false);
  assert.equal(handoff.reconciliationAuthority, 'NONE');
  assert.equal(handoff.externalActionAuthorization, 'NONE');
  assert.equal(Object.isFrozen(handoff), true);
});

test('an exact complete Foundation result reconciles a fully observed fill without inventing external refs', () => {
  let current = submitted();
  current = append(current, orderObservation(current, 'FILLED', '1', T0 + 10, 'filled-order'));
  const fillLineage = privateLineage(current, 'reconciliation-fill:fill-1', {
    observationKind: 'FILL', exchangeEventTimeMs: T0 + 10, receiptTimeMs: T0 + 11,
    fact: {
      tradeId: '5001',
      fillQuantity: '1',
      cumulativeFilledQuantity: '1',
      venueOrderId: '1001',
      exchangeEventTimeMs: T0 + 10,
      connectionGeneration: 1,
    },
  });
  const fillInput = {
    kind: 'PRIVATE_FILL_OBSERVED',
    occurredAtMs: T0 + 10,
    receivedAtMs: T0 + 11,
    sourceRevision: fillLineage.privateEventRevision,
    payload: {
      product: current.snapshot.identity.product,
      accountRealmId: current.snapshot.identity.accountRealmId,
      symbol: current.snapshot.identity.symbol,
      clientOrderId: current.snapshot.identity.clientOrderId,
      tradeId: '5001',
      fillQuantity: '1',
      cumulativeFilledQuantity: '1',
      venueOrderId: '1001',
      exchangeEventTimeMs: T0 + 10,
      connectionGeneration: 1,
      ...fillLineage,
    },
  };
  current = append(current, { observationId: observationId(current, fillInput), ...fillInput });
  const reconciled = append(current, reconciliationObservation(current));
  assert.equal(reconciled.snapshot.projection.lifecycle, 'RECONCILED');
  assert.equal(reconciled.snapshot.projection.reconciled, true);
  assert.equal(reconciled.snapshot.projection.reconciliationStatus, 'EXACT');
  assert.equal(reconciled.snapshot.projection.reconciliationEffect, 'FILLED');
  assert.equal(reconciled.snapshot.projection.cumulativeFilledQuantity, '1');
  assert.deepEqual(reconciled.snapshot.projection.externalTruthRefs, []);
  assert.equal(reconciled.snapshot.projection.recoveryRequired, false);
});

test('ACKNOWLEDGED, NEW, PARTIALLY_FILLED, non-exact, and unknown results never reconcile', () => {
  for (const [status, effect, quantity] of [
    ['EXACT', 'ACKNOWLEDGED', '0'],
    ['EXACT', 'NEW', '0'],
    ['EXACT', 'PARTIALLY_FILLED', '0.4'],
    ['PENDING', 'UNKNOWN', null],
    ['PARTIAL', 'PARTIAL_MIXED', '0.4'],
    ['UNAVAILABLE', 'UNKNOWN', null],
  ]) {
    const current = submitted();
    const next = append(current, reconciliationObservation(current, {
      label: `${status}-${effect}`,
      status,
      effect,
      cumulativeFilledQuantity: quantity,
      venueOrderId: quantity === null ? null : '1001',
    }));
    assert.equal(next.snapshot.projection.reconciled, false, `${status}/${effect}`);
    assert.equal(next.snapshot.projection.recoveryRequired, true, `${status}/${effect}`);
    if (effect === 'PARTIAL_MIXED') {
      assert.equal(next.snapshot.projection.partialMixed, false);
      assert.equal(next.snapshot.projection.reconciliationEffect, 'UNKNOWN');
      assert.equal(next.snapshot.projection.lifecycle, 'SUBMITTING');
    }
  }
});

test('not-found/absence-like owner evidence remains UNKNOWN because venue retention is bounded', () => {
  const current = submitted();
  const next = append(current, reconciliationObservation(current, {
    label: 'query-not-found',
    status: 'EXACT',
    effect: 'UNKNOWN',
    cumulativeFilledQuantity: null,
    venueOrderId: null,
  }));
  assert.equal(next.snapshot.projection.reconciled, false);
  assert.equal(next.snapshot.projection.lifecycle, 'SUBMITTING');
  assert.equal(next.snapshot.projection.recoveryRequired, true);
});

test('owner result must bind exact journal head/version/outcome, realm, client ID, and private cut', () => {
  const current = submitted();
  const base = reconciliationObservation(current, {
    effect: 'REJECTED_NO_EFFECT_PROVEN',
    cumulativeFilledQuantity: '0',
    venueOrderId: null,
  });
  const payloadAttacks = [
    { mutationId: `l06mut_${'0'.repeat(64)}` },
    { product: 'MARGIN' },
    { accountRealmId: 'account-realm:other' },
    { clientOrderId: 'foreign-id' },
    { journalVersion: current.snapshot.journalVersion - 1 },
    { journalHeadDigest: `l06head_${'0'.repeat(64)}` },
    { journalOutcomeRevision: `l06outcome_${'0'.repeat(64)}` },
    { privateSourceCutRevision: `l05pcut_${'0'.repeat(64)}` },
  ];
  for (const attack of payloadAttacks) {
    assert.throws(() => prepareMutationObservationAppend(current, {
      ...base,
      payload: { ...base.payload, ...attack },
    }), undefined, JSON.stringify(attack));
  }
});

test('closed reconciliation projection commitment rejects component tampering', () => {
  const current = submitted();
  const base = reconciliationObservation(current, {
    effect: 'REJECTED_NO_EFFECT_PROVEN',
    cumulativeFilledQuantity: '0',
    venueOrderId: null,
  });
  const componentAttacks = [
    ['expectedSubmittedQuantityProjection', '0'],
    ['expectedFilledQuantityProjection', '1'],
    ['observedOrderFilledQuantityProjection', '1'],
    ['observedTradeFilledQuantityProjection', '1'],
    ['observedFilledQuantityProjection', '1'],
    ['observedRemainderQuantityProjection', '0'],
  ];
  for (const [field, value] of componentAttacks) {
    const attacked = {
      ...base,
      payload: {
        ...base.payload,
        matchingLeg: { ...base.payload.matchingLeg, [field]: value },
      },
    };
    assert.throws(() => prepareMutationObservationAppend(current, attacked), TypeError, field);
  }
  assert.throws(() => prepareMutationObservationAppend(current, {
    ...base,
    payload: {
      ...base.payload,
      projectionContentRevision: `l06foundation_projection_${'0'.repeat(64)}`,
    },
  }), TypeError);
});

test('exact reconciliation duplicate replay stays idempotent after later telemetry advances the head', () => {
  const current = submitted();
  const input = reconciliationObservation(current, {
    effect: 'REJECTED_NO_EFFECT_PROVEN',
    cumulativeFilledQuantity: '0',
    venueOrderId: null,
  });
  const reconciled = append(current, input);
  const telemetryInput = {
    kind: 'TELEMETRY_DEGRADED',
    occurredAtMs: T0 + 40,
    receivedAtMs: T0 + 40,
    sourceRevision: 'telemetry-source:reconciliation-replay',
    payload: { subsystem: 'TRACE', reasonCode: 'TRACE_DEGRADED' },
  };
  const telemetry = append(reconciled, {
    observationId: observationId(reconciled, telemetryInput),
    ...telemetryInput,
  });
  const duplicate = prepareMutationObservationAppend(telemetry, input);
  assert.equal(duplicate.kind, 'EXACT_DUPLICATE');
  assert.equal(duplicate.persisted.snapshot.headDigest, telemetry.snapshot.headDigest);
});

test('known venue identity cannot disappear from an exact complete owner result', () => {
  let current = submitted();
  current = append(current, orderObservation(current, 'FILLED', '1', T0 + 10, 'known-venue-fill'));
  assert.throws(() => reconciliationObservation(current, {
    label: 'missing-known-venue',
    effect: 'FILLED',
    cumulativeFilledQuantity: '1',
    venueOrderId: null,
  }), TypeError);
});

test('different exact complete reconciliation effects remain a durable named conflict', () => {
  const submittedState = submitted();
  const canceled = append(submittedState, reconciliationObservation(submittedState, {
    label: 'exact-canceled',
    effect: 'CANCELED',
    resultRevision: `foundation-reconciliation-result:${'4'.repeat(24)}`,
    cumulativeFilledQuantity: '0',
    venueOrderId: '1001',
  }));
  const filledOwnerEvent = append(canceled, orderObservation(
    canceled,
    'FILLED',
    '1',
    T0 + 32,
    'later-filled-owner-event',
  ));
  const conflicting = append(filledOwnerEvent, reconciliationObservation(filledOwnerEvent, {
    label: 'exact-filled',
    effect: 'FILLED',
    resultRevision: `foundation-reconciliation-result:${'5'.repeat(24)}`,
    cumulativeFilledQuantity: '1',
    venueOrderId: '1001',
    observedAtMs: T0 + 35,
  }));
  assert.equal(conflicting.snapshot.projection.lifecycle, 'CONFLICT');
  assert.ok(conflicting.snapshot.projection.conflictCodes.includes('RECONCILIATION_EFFECT_CONFLICT'));
});

test('exact owner terminal effects cannot overwrite contradictory private terminal truth', () => {
  const cases = [
    ['CANCELED', 'FILLED', '1'],
    ['EXPIRED', 'CANCELED', '0'],
    ['REJECTED', 'EXPIRED', '0'],
    ['FILLED', 'CANCELED', '1'],
  ];
  for (const [privateStatus, ownerEffect, quantity] of cases) {
    let current = submitted();
    current = append(current, orderObservation(
      current,
      privateStatus,
      quantity,
      T0 + 10,
      `private-${privateStatus}-owner-${ownerEffect}`,
    ));
    const contradicted = append(current, reconciliationObservation(current, {
      label: `private-${privateStatus}-owner-${ownerEffect}`,
      effect: ownerEffect,
      cumulativeFilledQuantity: quantity,
      venueOrderId: '1001',
      observedAtMs: T0 + 30,
    }));
    assert.equal(contradicted.snapshot.projection.lifecycle, 'CONFLICT');
    assert.equal(contradicted.snapshot.projection.reconciled, false);
    assert.ok(contradicted.snapshot.projection.conflictCodes.includes(
      'RECONCILIATION_TERMINAL_STATUS_CONFLICT',
    ));
  }
});

test('no-effect owner posture cannot erase a fill and projects UNKNOWN when quantities disagree', () => {
  let current = submitted();
  current = append(current, orderObservation(current, 'PARTIALLY_FILLED', '0.4', T0 + 10, 'partial-order'));
  const contradicted = append(current, reconciliationObservation(current, {
    label: 'false-no-effect',
    effect: 'REJECTED_NO_EFFECT_PROVEN',
    cumulativeFilledQuantity: '0',
    venueOrderId: '1001',
  }));
  assert.equal(contradicted.snapshot.projection.lifecycle, 'PARTIALLY_FILLED');
  assert.equal(contradicted.snapshot.projection.reconciliationEffect, 'UNKNOWN');
  assert.equal(contradicted.snapshot.projection.reconciled, false);
  assert.equal(contradicted.snapshot.projection.cumulativeFilledQuantity, '0.4');
  assert.equal(contradicted.snapshot.projection.reconciled, false);
});

test('a later weaker owner result cannot erase an exact complete reconciliation', () => {
  let current = submitted();
  current = append(current, orderObservation(current, 'FILLED', '1', T0 + 10, 'strength-filled'));
  const exact = append(current, reconciliationObservation(current, {
    label: 'strength-exact',
    effect: 'FILLED',
    observedAtMs: T0 + 30,
  }));
  assert.equal(exact.snapshot.projection.reconciled, true);
  const weaker = append(exact, reconciliationObservation(exact, {
    label: 'strength-pending',
    status: 'PENDING',
    legStatus: 'PENDING',
    effect: 'UNKNOWN',
    observedAtMs: T0 + 40,
  }));
  assert.equal(weaker.snapshot.projection.lifecycle, 'CONFLICT');
  assert.ok(weaker.snapshot.projection.conflictCodes.includes('RECONCILIATION_STRENGTH_REGRESSION'));
  assert.equal(weaker.snapshot.projection.terminalStatus, 'FILLED');
  assert.equal(weaker.snapshot.projection.reconciled, false);
});

test('Foundation evaluation time and owner revision content cannot regress or fork', () => {
  const current = submitted();
  assert.throws(() => reconciliationObservation(current, {
    label: 'predates-head',
    status: 'PENDING',
    effect: 'UNKNOWN',
    observedAtMs: current.snapshot.entries.at(-1).receivedAtMs - 1,
  }), TypeError);

  const resultRevision = `foundation-reconciliation-result:${'9'.repeat(24)}`;
  const first = append(current, reconciliationObservation(current, {
    label: 'revision-first',
    status: 'PENDING',
    effect: 'UNKNOWN',
    resultRevision,
    observedAtMs: T0 + 30,
  }));
  const fork = append(first, reconciliationObservation(first, {
    label: 'revision-fork',
    status: 'UNAVAILABLE',
    effect: 'UNKNOWN',
    resultRevision,
    observedAtMs: T0 + 40,
  }));
  assert.ok(fork.snapshot.projection.conflictCodes.includes('RECONCILIATION_REVISION_CONFLICT'));
});

test('fractional binary64 quantities remain UNKNOWN until the director-owned bridge exists', () => {
  const input = inputFixture({ requestedQuantity: '0.5' });
  let current = submittingPersisted(input);
  current = persist(prepareSyntheticSubmissionObservationAppend(
    current,
    evaluateSyntheticSubmissionBoundary(current, T0 + 3),
    l03SubmittedAttempt(current),
    T0 + 4,
  ));
  current = append(current, orderObservation(current, 'FILLED', '0.5', T0 + 10, 'fractional-fill'));
  const owner = append(current, reconciliationObservation(current, {
    label: 'fractional-owner',
    effect: 'FILLED',
    cumulativeFilledQuantity: '0.5',
    observedAtMs: T0 + 30,
  }));
  assert.equal(owner.snapshot.projection.reconciliationEffect, 'UNKNOWN');
  assert.equal(owner.snapshot.projection.reconciled, false);
  assert.equal(owner.snapshot.projection.cumulativeFilledQuantity, '0.5');
});
