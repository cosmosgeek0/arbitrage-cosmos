import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessCapitalTruth,
  capitalDigest,
  deriveAllocationDecisionId,
  deriveCapitalConfigRevision,
  deriveCapitalMandateId,
  deriveCapitalReservationId,
  deriveOpportunityConsiderationId,
  deriveReconciliationReferenceId,
} from '../../../dist/capitalFoundation/contracts/index.js';
import { projectActivePosition } from '../../../dist/capitalFoundation/positions/index.js';
import {
  RESERVATION_COMMAND_KINDS,
  RESERVATION_OUTCOMES,
  reduceReservationBook,
} from '../../../dist/capitalFoundation/allocation/index.js';

const NOW = 1_800_000_000_000;
const CLAIM = 'capital-claim:closure-proof';

function currentTruth(evaluatedAtMs = NOW, overrides = {}) {
  return assessCapitalTruth({
    source: {
      sourceTimeMs: evaluatedAtMs - 2,
      receivedAtMs: evaluatedAtMs - 1,
      maxAgeMs: 1_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceId: 'reservation-closure-test',
      ...(overrides.source ?? {}),
    },
    evaluatedAtMs,
    requiredValuePresent: true,
    revision: `closure-truth-${evaluatedAtMs}`,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'source')),
  });
}

function reservationBook(key = 'primary') {
  const considerationId = deriveOpportunityConsiderationId({ closureTest: key });
  const allocationDecisionId = deriveAllocationDecisionId({ considerationId, closureTest: key });
  const capitalClaimKey = key === 'primary' ? CLAIM : `${CLAIM}:${key}`;
  const reservationId = deriveCapitalReservationId({ allocationDecisionId, capitalClaimKey });
  const reservation = {
    id: reservationId,
    allocationDecisionId,
    considerationId,
    amount: '100',
    consumedAmount: '60',
    valuationAsset: 'USDT',
    state: 'ACTIVE',
    createdAtMs: NOW - 100,
    expiresAtMs: NOW + 10_000,
    releasedAtMs: null,
    revision: 2,
    idempotencyKey: `reserve-${key}`,
  };
  const managed = {
    reservation,
    capitalClaimKey,
    unconsumedReleased: false,
    closedExposureReleased: false,
    policyRevision: 'cfg-reservation-policy',
    policyReservationTtlMs: 10_000,
    decisionValidUntilMs: NOW + 10_000,
    allocationReplayReceiptDigest: capitalDigest({ allocationDecisionId }),
    lastTransitionAtMs: NOW - 3,
  };
  return { reservations: [managed], mutations: [] };
}

function mandateFor(managed, overrides = {}) {
  const semantic = {
    id: 'pending',
    revision: 1,
    considerationId: managed.reservation.considerationId,
    allocationDecisionId: managed.reservation.allocationDecisionId,
    reservationId: managed.reservation.id,
    stagedPlanId: `staged-plan:${managed.reservation.id}`,
    stagedPlanRevision: 1,
    stagedPlanDigest: capitalDigest({ plan: managed.reservation.id }),
    proposalIntakeDigest: capitalDigest({ proposal: managed.reservation.considerationId }),
    configRevision: deriveCapitalConfigRevision('reservation-closure-test', { version: 1 }),
    approvalId: null,
    riskDecision: null,
    targetMaximumExposure: '100',
    valuationAsset: managed.reservation.valuationAsset,
    createdAtMs: NOW - 90,
    expiresAtMs: NOW + 5_000,
    ...overrides,
  };
  semantic.id = deriveCapitalMandateId({
    considerationId: semantic.considerationId,
    allocationDecisionId: semantic.allocationDecisionId,
    reservationId: semantic.reservationId,
    proposalIntakeDigest: semantic.proposalIntakeDigest,
  });
  return { ...semantic, digest: capitalDigest(semantic) };
}

function closedPosition(mandate, overrides = {}) {
  const projectedAtMs = overrides.projectedAtMs ?? NOW;
  const externalPlanId = overrides.externalPlanId ?? 'external-plan:closure-proof';
  const correlationId = overrides.correlationId ?? 'execution-correlation:closure-proof';
  const executionObservedAtMs = overrides.executionObservedAtMs ?? NOW - 1;
  const reconciliationObservedAtMs = overrides.reconciliationObservedAtMs ?? NOW;
  const evidenceTruth = overrides.truth ?? currentTruth(projectedAtMs);
  return projectActivePosition({
    revision: overrides.revision ?? 4,
    mandateId: mandate.id,
    thesis: {
      id: `thesis:${mandate.id}`,
      revision: 1,
      strategy: 'BASIS',
      proposalId: `proposal:${mandate.considerationId}`,
      originalEvidenceIds: ['closure-evidence'],
      intelligenceThesisPacketId: 'closure-thesis-packet',
      openedAtMs: NOW - 80,
      expectedHorizonMs: 60_000,
      maximumHoldingHorizonMs: 120_000,
      targetConditions: ['basis-converged'],
      invalidationConditions: ['position-closed'],
      stopAddingConditions: ['exit-requested'],
      configRevision: mandate.configRevision,
    },
    sourceState: 'CLOSED',
    sourceCapitalLifecycle: 'CLOSED',
    legs: [
      {
        id: 'leg:perpetual', instrumentId: 'BINANCE:PERPETUAL:BTCUSDT', symbol: 'BTCUSDT',
        side: 'SHORT', quantity: '0', quoteExposure: '0', valuationAsset: mandate.valuationAsset,
        externalLifecycle: 'FILLED', truth: evidenceTruth,
      },
      {
        id: 'leg:spot', instrumentId: 'BINANCE:SPOT:BTCUSDT', symbol: 'BTCUSDT',
        side: 'LONG', quantity: '0', quoteExposure: '0', valuationAsset: mandate.valuationAsset,
        externalLifecycle: 'FILLED', truth: evidenceTruth,
      },
    ],
    oneLegSinceMs: null,
    executionState: {
      externalPlanId,
      correlationId,
      lifecycle: 'CLOSED',
      observedAtMs: executionObservedAtMs,
      sequence: 10,
      revision: 'execution-r10',
      truth: evidenceTruth,
    },
    reconciliationState: {
      externalPlanId,
      correlationId,
      status: 'EXACT',
      observedAtMs: reconciliationObservedAtMs,
      sequence: 11,
      revision: 'reconciliation-r11',
      reasonCodes: [],
      truth: evidenceTruth,
    },
    outstandingActionIntentIds: [],
    openedAtMs: NOW - 80,
    lastTransitionAtMs: NOW - 2,
    truth: evidenceTruth,
    projectedAtMs,
  }).position;
}

function closureFixture() {
  const book = reservationBook();
  const managed = book.reservations[0];
  const mandate = mandateFor(managed);
  const position = closedPosition(mandate);
  return {
    book,
    closure: {
      reservationId: managed.reservation.id,
      allocationDecisionId: managed.reservation.allocationDecisionId,
      considerationId: managed.reservation.considerationId,
      capitalClaimKey: managed.capitalClaimKey,
      reservationRevision: managed.reservation.revision,
      consumedAmount: managed.reservation.consumedAmount,
      mandate,
      position,
    },
  };
}

function close(book, closure, commandId = 'close-reservation') {
  return reduceReservationBook(book, {
    kind: 'CLOSE_RELEASE',
    commandId,
    reservationId: book.reservations[0].reservation.id,
    nowMs: NOW,
    closure,
  });
}

test('reservation command and outcome vocabularies are immutable', () => {
  assert.equal(Object.isFrozen(RESERVATION_COMMAND_KINDS), true);
  assert.equal(Object.isFrozen(RESERVATION_OUTCOMES), true);
});

test('current canonical mandate, closed position, execution, and exact reconciliation release once', () => {
  const { book, closure } = closureFixture();
  const result = close(book, closure);
  assert.equal(result.mutation.status, 'APPLIED');
  assert.equal(result.mutation.releasedAmount, '100');
  assert.equal(result.book.reservations[0].reservation.state, 'RELEASED');
  assert.equal(result.book.reservations[0].closedExposureReleased, true);

  const replay = reduceReservationBook(result.book, {
    kind: 'CLOSE_RELEASE', commandId: 'close-reservation-again',
    reservationId: closure.reservationId, nowMs: NOW + 1, closure,
  });
  assert.equal(replay.mutation.status, 'NOOP_ALREADY_TERMINAL');
  assert.equal(replay.mutation.releasedAmount, '0');
});

test('closure rejects unrelated and cross-reservation mandate or position chains', () => {
  const { book, closure } = closureFixture();
  const foreignBook = reservationBook('foreign');
  const foreignMandate = mandateFor(foreignBook.reservations[0]);
  const foreignPosition = closedPosition(foreignMandate, {
    externalPlanId: 'external-plan:foreign', correlationId: 'execution-correlation:foreign',
  });
  const hostile = [
    { name: 'foreign mandate and position', closure: { ...closure, mandate: foreignMandate, position: foreignPosition } },
    { name: 'foreign position under current mandate evidence', closure: { ...closure, position: foreignPosition } },
    { name: 'cross-reservation mandate', closure: { ...closure, mandate: foreignMandate } },
    { name: 'stale mandate digest', closure: { ...closure, mandate: { ...closure.mandate, valuationAsset: 'USDC' } } },
  ];
  for (const attempt of hostile) {
    const result = close(book, attempt.closure, `reject-${attempt.name}`);
    assert.equal(result.mutation.status, 'REJECTED', attempt.name);
    assert.equal(result.mutation.releasedAmount, '0', attempt.name);
    assert.ok(result.mutation.reasonCodes.includes('CLOSURE_RECONCILIATION_PROOF_REQUIRED'), attempt.name);
    assert.equal(result.book.reservations[0].closedExposureReleased, false, attempt.name);
  }
});

test('closure rejects nonzero, nonterminal, unbound, stale, or forged position evidence', () => {
  const { book, closure } = closureFixture();
  const reconciliation = closure.position.reconciliationReference;
  const foreignPlanId = 'external-plan:unrelated-reconciliation';
  const forgedReconciliation = {
    ...reconciliation,
    externalPlanId: foreignPlanId,
    id: deriveReconciliationReferenceId({
      externalPlanId: foreignPlanId,
      correlationId: reconciliation.correlationId,
      revision: reconciliation.revision,
      sequence: reconciliation.sequence,
    }),
  };
  const staleTruth = currentTruth(NOW - 2_000, { source: { maxAgeMs: 10 } });
  const futureTruth = currentTruth(NOW + 1);
  const hostilePositions = [
    ['aggregate exposure remains', { ...closure.position, totalGrossExposure: '0.1' }],
    ['leg exposure remains', { ...closure.position, legs: [{ ...closure.position.legs[0], quantity: '0.1', quoteExposure: '0.1' }, ...closure.position.legs.slice(1)] }],
    ['lifecycle is not closed', { ...closure.position, capitalLifecycle: 'ACTIVE' }],
    ['execution plan is not closed', { ...closure.position, executionReference: { ...closure.position.executionReference, lifecycle: 'RECONCILING' } }],
    ['reconciliation is not exact', { ...closure.position, reconciliationReference: { ...reconciliation, status: 'DIVERGED' } }],
    ['reconciliation belongs to another plan', { ...closure.position, reconciliationReference: forgedReconciliation }],
    ['reconciliation ID is forged', { ...closure.position, reconciliationReference: { ...reconciliation, id: 'crecon_forged' } }],
    ['reconciliation truth is stale', { ...closure.position, reconciliationReference: { ...reconciliation, truth: staleTruth } }],
    ['reconciliation truth is future-evaluated', { ...closure.position, reconciliationReference: { ...reconciliation, truth: futureTruth } }],
    ['position truth is malformed', { ...closure.position, truth: { source: null } }],
    ['pending action remains', { ...closure.position, outstandingActionIntentIds: ['intent:still-live'] }],
  ];
  for (const [name, position] of hostilePositions) {
    assert.doesNotThrow(() => close(book, { ...closure, position }, `reject-${name}`), name);
    const result = close(book, { ...closure, position }, `reject-result-${name}`);
    assert.equal(result.mutation.status, 'REJECTED', name);
    assert.equal(result.mutation.releasedAmount, '0', name);
    assert.ok(result.mutation.reasonCodes.includes('CLOSURE_RECONCILIATION_PROOF_REQUIRED'), name);
  }
});

test('legacy self-asserted closure fields cannot substitute for the mandate-position chain', () => {
  const { book, closure } = closureFixture();
  const legacy = {
    reservationId: closure.reservationId,
    allocationDecisionId: closure.allocationDecisionId,
    considerationId: closure.considerationId,
    capitalClaimKey: closure.capitalClaimKey,
    reservationRevision: closure.reservationRevision,
    consumedAmount: closure.consumedAmount,
    positionId: closure.position.id,
    positionRevision: closure.position.revision,
    positionState: 'CLOSED',
    reconciliation: closure.position.reconciliationReference,
    remainingExposure: '0',
  };
  const result = close(book, legacy, 'reject-legacy-closure');
  assert.equal(result.mutation.status, 'REJECTED');
  assert.equal(result.mutation.releasedAmount, '0');
  assert.ok(result.mutation.reasonCodes.includes('CLOSURE_RECONCILIATION_PROOF_REQUIRED'));
});
