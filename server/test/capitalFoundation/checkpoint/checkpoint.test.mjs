import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyCapitalCheckpointEvent,
  createCapitalCheckpointEvent,
  createEmptyCapitalCheckpointState,
  projectRestartSafety,
  replayCapitalCheckpointEvents,
  restoreCapitalCheckpoint,
  serializeCapitalCheckpoint,
} from '../../../dist/capitalFoundation/checkpoint/index.js';
import { assessCapitalTruth, validateCapitalJsonValue } from '../../../dist/capitalFoundation/contracts/index.js';
import { canonicalJson } from '../../../dist/foundation/contracts/index.js';

const NOW = 1_900_000_000_000;
const STREAM = 'capital:test:position-1';

function truth({ stale = false, divergent = false } = {}) {
  return assessCapitalTruth({
    source: {
      sourceTimeMs: stale ? NOW - 10_000 : NOW - 10,
      receivedAtMs: NOW - 5,
      maxAgeMs: 1_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceId: 'checkpoint.test',
    },
    evaluatedAtMs: NOW,
    requiredValuePresent: true,
    divergent,
  });
}

const reservation = {
  id: 'reservation-1', allocationDecisionId: 'allocation-1', considerationId: 'consideration-1',
  amount: '100', consumedAmount: '25', valuationAsset: 'USDT', state: 'ACTIVE',
  createdAtMs: NOW - 2_000, expiresAtMs: NOW + 500, releasedAtMs: null,
  revision: 1, idempotencyKey: 'reservation:key:1',
};
const plan = {
  id: 'plan-1', reservationId: reservation.id, revision: 1, digest: 'plan-digest-1', stages: [],
  activeStage: 'HOLD', remainingReservedAmount: '75', createdAtMs: NOW - 1_900, expiresAtMs: NOW + 5_000,
};
const mandate = {
  id: 'mandate-1', revision: 1, digest: 'mandate-digest-1', considerationId: 'consideration-1',
  allocationDecisionId: 'allocation-1', reservationId: reservation.id, stagedPlanId: plan.id,
  stagedPlanRevision: 1, stagedPlanDigest: plan.digest, proposalIntakeDigest: 'proposal-digest-1',
  configRevision: 'cfg-capital-1', approvalId: 'approval-1', riskDecision: null,
  targetMaximumExposure: '100', valuationAsset: 'USDT', createdAtMs: NOW - 1_800, expiresAtMs: NOW + 5_000,
};
const approval = {
  id: 'approval-1', operatorIdentityReference: 'operator:test', proposalId: 'proposal-1', proposalRevision: null,
  proposalIntakeDigest: 'proposal-digest-1', mandateId: mandate.id, mandateRevision: 1,
  mandateDigest: mandate.digest, stagedPlanId: plan.id, stagedPlanRevision: 1, stagedPlanDigest: plan.digest,
  strategy: 'BASIS', symbols: ['BTCUSDT'], instruments: ['BTCUSDT:SPOT', 'BTCUSDT:PERP'],
  allowedActionClasses: ['REDUCE', 'EXIT', 'RECOVERY'], maximumNotional: '100', valuationAsset: 'USDT',
  mode: 'MANUAL_ARMED', configRevision: 'cfg-capital-1', issuedAtMs: NOW - 1_700,
  expiresAtMs: NOW + 5_000, revokedAtMs: null, revocationReasonReference: null,
  stageLimits: [], reasonReference: 'operator-review-1', useScopeKey: 'approval:scope:1',
};
const thesis = {
  id: 'thesis-1', revision: 1, strategy: 'BASIS', proposalId: 'proposal-1', originalEvidenceIds: ['evidence-1'],
  intelligenceThesisPacketId: 'intel-thesis-1', openedAtMs: NOW - 1_600, expectedHorizonMs: 60_000,
  maximumHoldingHorizonMs: 120_000, targetConditions: ['basis_converges'], invalidationConditions: ['basis_widens'],
  stopAddingConditions: ['evidence_stale'], configRevision: 'cfg-capital-1',
};
const reconciliation = {
  id: 'recon-1', externalPlanId: 'external-plan-1', correlationId: 'execution-correlation-1', status: 'EXACT',
  observedAtMs: NOW - 100, sequence: 4, revision: 'recon-revision-4', reasonCodes: [], truth: truth(),
};
const position = {
  id: 'position-1', revision: 1, mandateId: mandate.id, thesis, state: 'ACTIVE', capitalLifecycle: 'ACTIVE',
  legs: [{ id: 'leg-spot', instrumentId: 'BTCUSDT:SPOT', symbol: 'BTCUSDT', side: 'LONG', quantity: '1',
    quoteExposure: '100', valuationAsset: 'USDT', externalLifecycle: 'FILLED', truth: truth() }],
  totalGrossExposure: '100', netDirectionalExposure: '0', hedgeRatio: '1', oneLegExposure: '0', oneLegSinceMs: null,
  executionReference: null, reconciliationReference: reconciliation, outstandingActionIntentIds: ['intent-reduce-1'],
  openedAtMs: NOW - 1_500, lastTransitionAtMs: NOW - 1_000, truth: truth(),
};
const intent = {
  id: 'intent-reduce-1', positionId: position.id, sourcePositionRevision: 1, sourceThesisId: thesis.id,
  sourceThesisRevision: 1, kind: 'REDUCE', riskEffect: 'RISK_REDUCING',
  target: { kind: 'DELTA', valuationAsset: 'USDT', quoteNotional: '-25', baseQuantity: null, targetHedgeRatio: null },
  urgency: 'URGENT', hardDeadlineMs: NOW + 1_000, why: ['reduce_test'], supportingEvidenceIds: ['evidence-1'],
  conflictingEvidenceIds: [], requiredFutureGates: ['MULTI_LEG_RISK', 'RECONCILIATION'], completeness: 'COMPLETE',
  blockingFacts: [], idempotencyKey: 'intent:key:1', correlationKey: 'intent:correlation:1',
  economicCostOfWaiting: '1', expectedCostOfActing: '0.5', invalidationConditions: [], createdAtMs: NOW - 500,
};
const economics = {
  id: 'economics-1', positionId: position.id, revision: 1,
  attribution: { components: [], valuationAsset: 'USDT', netKnown: '0', netEstimatedRange: null,
    completeness: 'PARTIAL', accountingIdentityProven: false, includedComponentIds: [],
    missingComponentKinds: ['TRADING_COMMISSIONS'], divergentReasons: [], evaluatedAtMs: NOW - 100 },
};
const lifecycle = { id: 'lifecycle-position-1', aggregateId: position.id, state: 'ACTIVE', revision: 1,
  lastTransitionAtMs: NOW - 1_000, correlationId: 'capital-lifecycle-1' };
const revocation = { id: 'revocation-1', approvalId: approval.id, revision: 1, revokedAtMs: NOW - 50, reasonReference: 'operator-revoked' };

const records = [
  ['RESERVATION_UPSERTED', reservation], ['STAGED_PLAN_UPSERTED', plan], ['MANDATE_UPSERTED', mandate],
  ['APPROVAL_UPSERTED', approval], ['THESIS_UPSERTED', thesis], ['POSITION_UPSERTED', position],
  ['RECONCILIATION_UPSERTED', reconciliation], ['ACTION_INTENT_UPSERTED', intent],
  ['ECONOMICS_UPSERTED', economics], ['LIFECYCLE_REVISED', lifecycle], ['APPROVAL_REVOKED', revocation],
];
const events = records.map(([kind, record], index) => createCapitalCheckpointEvent({
  streamId: STREAM, sequence: index + 1, kind, occurredAtMs: NOW - 2_000 + index * 100,
  correlationId: `checkpoint-event-${index + 1}`, record,
}));

test('checkpoint events use guarded number-free payloads and deterministic IDs', () => {
  assert.deepEqual(validateCapitalJsonValue(events[0].payload), []);
  assert.equal(events[0].id, createCapitalCheckpointEvent({
    streamId: STREAM, sequence: 1, kind: 'RESERVATION_UPSERTED', occurredAtMs: NOW - 2_000,
    correlationId: 'checkpoint-event-1', record: reservation,
  }).id);
  assert.equal(JSON.stringify(events[0].payload).includes('"amount":"100"'), true);
});

test('deterministic replay tolerates reordering and exact duplicates', () => {
  const left = replayCapitalCheckpointEvents(STREAM, events);
  const right = replayCapitalCheckpointEvents(STREAM, [...events].reverse().concat(events[3]));
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  assert.equal(canonicalJson(left.value), canonicalJson(right.value));
  assert.equal(left.value.revision, records.length);
});

test('duplicate conflict and sequence gaps fail with typed reasons', () => {
  const initial = applyCapitalCheckpointEvent(createEmptyCapitalCheckpointState(STREAM), events[0]);
  assert.equal(initial.ok, true);
  const forged = { ...events[0], payload: { record: { id: 'other' } } };
  const duplicate = applyCapitalCheckpointEvent(initial.value, forged);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.failure.code, 'DUPLICATE_EVENT_CONFLICT');
  const gap = applyCapitalCheckpointEvent(initial.value, events[2]);
  assert.equal(gap.ok, false);
  assert.equal(gap.failure.code, 'EVENT_SEQUENCE_NOT_MONOTONIC');
});

test('terminal reservation and lifecycle revisions cannot be resurrected or regressed', () => {
  const released = { ...reservation, state: 'RELEASED', releasedAtMs: NOW, revision: 2 };
  const activeAgain = { ...reservation, state: 'ACTIVE', releasedAtMs: null, revision: 3, expiresAtMs: NOW + 10_000 };
  const base = replayCapitalCheckpointEvents(STREAM, [events[0], createCapitalCheckpointEvent({
    streamId: STREAM, sequence: 2, kind: 'RESERVATION_UPSERTED', occurredAtMs: NOW,
    correlationId: 'release', record: released,
  })]);
  assert.equal(base.ok, true);
  const result = applyCapitalCheckpointEvent(base.value, createCapitalCheckpointEvent({
    streamId: STREAM, sequence: 3, kind: 'RESERVATION_UPSERTED', occurredAtMs: NOW + 1,
    correlationId: 'resurrect', record: activeAgain,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'RESERVATION_RESURRECTION_FORBIDDEN');
});

test('expired approval cannot be refreshed under its old identity', () => {
  const expired = { ...approval, expiresAtMs: NOW - 1 };
  const first = createCapitalCheckpointEvent({ streamId: 'capital:test:approval-expiry', sequence: 1,
    kind: 'APPROVAL_UPSERTED', occurredAtMs: NOW - 2, correlationId: 'approval-expired', record: expired });
  const state = applyCapitalCheckpointEvent(createEmptyCapitalCheckpointState('capital:test:approval-expiry'), first);
  assert.equal(state.ok, true);
  const refreshed = createCapitalCheckpointEvent({ streamId: 'capital:test:approval-expiry', sequence: 2,
    kind: 'APPROVAL_UPSERTED', occurredAtMs: NOW, correlationId: 'approval-refresh', record: { ...approval, expiresAtMs: NOW + 5_000 } });
  const result = applyCapitalCheckpointEvent(state.value, refreshed);
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'APPROVAL_RESURRECTION_FORBIDDEN');
});

test('checkpoint serialization is byte deterministic and restore verifies replay', () => {
  const state = replayCapitalCheckpointEvents(STREAM, events);
  assert.equal(state.ok, true);
  const first = serializeCapitalCheckpoint(state.value);
  const second = serializeCapitalCheckpoint(state.value);
  assert.equal(first, second);
  const restored = restoreCapitalCheckpoint({ serialized: first, nowMs: NOW, correlationId: 'restore-1',
    accountTruth: truth(), reconciliationTruth: truth(), reconciliationReferences: [reconciliation] });
  assert.equal(restored.ok, true);
  assert.equal(canonicalJson(restored.value.checkpointState), canonicalJson(state.value));
  const tampered = JSON.parse(first); tampered.revision += 1;
  const rejected = restoreCapitalCheckpoint({ serialized: JSON.stringify(tampered), nowMs: NOW,
    correlationId: 'restore-tampered', accountTruth: truth(), reconciliationTruth: truth(), reconciliationReferences: [] });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.failure.code, 'CHECKPOINT_CHECKSUM_MISMATCH');
});

test('restart blocks increases on stale truth while exposed capital remains visible and reducible', () => {
  const state = replayCapitalCheckpointEvents(STREAM, events);
  const projection = projectRestartSafety(state.value, { nowMs: NOW + 1_000, correlationId: 'restart-stale',
    accountTruth: truth({ stale: true }), reconciliationTruth: truth({ stale: true }), reconciliationReferences: [reconciliation] });
  assert.equal(projection.safety.canOpenOrIncrease, false);
  assert.equal(projection.safety.supervisionContinues, true);
  assert.deepEqual(projection.safety.visiblePositionIds, [position.id]);
  assert.deepEqual(projection.safety.effectiveExpiredReservationIds, [reservation.id]);
  assert.deepEqual(projection.safety.allowedRiskReducingOrNeutralIntentIds, [intent.id]);
  assert.deepEqual(projection.safety.usableApprovalIds, []);
});

test('fresh restart can increase only without reconciliation conflict', () => {
  const state = replayCapitalCheckpointEvents(STREAM, events);
  const safe = projectRestartSafety(state.value, { nowMs: NOW, correlationId: 'restart-fresh',
    accountTruth: truth(), reconciliationTruth: truth(), reconciliationReferences: [reconciliation] });
  assert.equal(safe.safety.canOpenOrIncrease, true);
  const divergent = { ...reconciliation, status: 'DIVERGED', reasonCodes: ['VENUE_CHECKPOINT_MISMATCH'] };
  const conflicted = projectRestartSafety(state.value, { nowMs: NOW, correlationId: 'restart-conflict',
    accountTruth: truth(), reconciliationTruth: truth(), reconciliationReferences: [divergent] });
  assert.equal(conflicted.safety.canOpenOrIncrease, false);
  assert.deepEqual(conflicted.safety.recoveryRequiredPositionIds, [position.id]);
  assert.equal(conflicted.effectivePositions[0].state, 'RECOVERY_REQUIRED');
});

test('financial numbers cannot cross checkpoint events as numeric values', () => {
  const bad = createCapitalCheckpointEvent({ streamId: 'capital:test:bad', sequence: 1,
    kind: 'RESERVATION_UPSERTED', occurredAtMs: NOW, correlationId: 'bad-money', record: { ...reservation, amount: 100 } });
  const applied = applyCapitalCheckpointEvent(createEmptyCapitalCheckpointState('capital:test:bad'), bad);
  assert.equal(applied.ok, false);
  assert.equal(applied.failure.code, 'CHECKPOINT_RECORD_INVALID');
});

test('nested financial numbers cannot hide behind integer tags or crash restore', () => {
  const streamId = 'capital:test:nested-money';
  const unsafe = { ...position, totalGrossExposure: '0', oneLegExposure: '0',
    legs: [{ ...position.legs[0], quantity: 1, quoteExposure: 100 }] };
  const event = createCapitalCheckpointEvent({ streamId, sequence: 1, kind: 'POSITION_UPSERTED',
    occurredAtMs: NOW, correlationId: 'nested-money', record: unsafe });
  assert.deepEqual(validateCapitalJsonValue(event.payload), []);
  const applied = applyCapitalCheckpointEvent(createEmptyCapitalCheckpointState(streamId), event);
  assert.equal(applied.ok, false);
  assert.equal(applied.failure.code, 'CHECKPOINT_RECORD_INVALID');
  assert.match(applied.failure.message, /FINANCIAL_FIELD_INVALID/);
});

test('event time cannot regress and an already-expired active reservation is rejected', () => {
  const streamId = 'capital:test:temporal-monotonicity';
  const first = createCapitalCheckpointEvent({ streamId, sequence: 1, kind: 'RESERVATION_UPSERTED',
    occurredAtMs: NOW - 1_000, correlationId: 'temporal-1', record: reservation });
  const initial = applyCapitalCheckpointEvent(createEmptyCapitalCheckpointState(streamId), first);
  assert.equal(initial.ok, true);
  const retrograde = createCapitalCheckpointEvent({ streamId, sequence: 2, kind: 'RESERVATION_UPSERTED',
    occurredAtMs: NOW - 1_001, correlationId: 'temporal-2', record: { ...reservation, revision: 2, expiresAtMs: NOW + 5_000 } });
  const regressed = applyCapitalCheckpointEvent(initial.value, retrograde);
  assert.equal(regressed.ok, false);
  assert.equal(regressed.failure.code, 'EVENT_TIME_NOT_MONOTONIC');

  const expiredStream = 'capital:test:already-expired';
  const alreadyExpired = createCapitalCheckpointEvent({ streamId: expiredStream, sequence: 1,
    kind: 'RESERVATION_UPSERTED', occurredAtMs: NOW, correlationId: 'expired-active',
    record: { ...reservation, expiresAtMs: NOW - 1 } });
  const expiredResult = applyCapitalCheckpointEvent(createEmptyCapitalCheckpointState(expiredStream), alreadyExpired);
  assert.equal(expiredResult.ok, false);
  assert.equal(expiredResult.failure.code, 'RESERVATION_ALREADY_EXPIRED');
});

test('restart requires exactly one fresh exact reconciliation reference per exposed position', () => {
  const state = replayCapitalCheckpointEvents(STREAM, events);
  assert.equal(state.ok, true);
  const base = { nowMs: NOW, correlationId: 'restart-reconciliation-proof',
    accountTruth: truth(), reconciliationTruth: truth() };

  const missing = projectRestartSafety(state.value, { ...base, reconciliationReferences: [] });
  assert.equal(missing.safety.canOpenOrIncrease, false);
  assert.deepEqual(missing.safety.recoveryRequiredPositionIds, [position.id]);
  assert.ok(missing.safety.reasonCodes.includes('POSITION_RECONCILIATION_REFERENCE_MISSING'));

  const stale = { ...reconciliation, id: 'recon-stale', truth: truth({ stale: true }) };
  const staleResult = projectRestartSafety(state.value, { ...base, reconciliationReferences: [stale] });
  assert.equal(staleResult.safety.canOpenOrIncrease, false);
  assert.ok(staleResult.safety.reasonCodes.includes('POSITION_RECONCILIATION_TRUTH_NOT_FRESH'));

  const divergent = { ...reconciliation, id: 'recon-divergent', status: 'DIVERGED', sequence: 5,
    revision: 'recon-revision-5', reasonCodes: ['VENUE_CHECKPOINT_MISMATCH'] };
  for (const references of [[reconciliation, divergent], [divergent, reconciliation]]) {
    const duplicate = projectRestartSafety(state.value, { ...base, reconciliationReferences: references });
    assert.equal(duplicate.safety.canOpenOrIncrease, false);
    assert.deepEqual(duplicate.safety.recoveryRequiredPositionIds, [position.id]);
    assert.ok(duplicate.safety.reasonCodes.includes('POSITION_RECONCILIATION_REFERENCE_DUPLICATE'));
  }
});

test('restart projects only outstanding intents and only current bound manual approval', () => {
  const state = replayCapitalCheckpointEvents(STREAM, events.slice(0, -1));
  assert.equal(state.ok, true);
  const extraIntent = { ...intent, id: 'intent-not-outstanding', kind: 'ADD_STAGE', riskEffect: 'RISK_INCREASING',
    target: { kind: 'DELTA', valuationAsset: 'USDT', quoteNotional: '10', baseQuantity: null, targetHedgeRatio: null },
    idempotencyKey: 'intent:key:not-outstanding', correlationKey: 'intent:correlation:not-outstanding' };
  const extended = applyCapitalCheckpointEvent(state.value, createCapitalCheckpointEvent({ streamId: STREAM,
    sequence: state.value.lastSequence + 1, kind: 'ACTION_INTENT_UPSERTED', occurredAtMs: NOW,
    correlationId: 'intent-not-outstanding', record: extraIntent }));
  assert.equal(extended.ok, true);
  const input = { nowMs: NOW, correlationId: 'restart-bindings', accountTruth: truth(),
    reconciliationTruth: truth(), reconciliationReferences: [reconciliation] };
  const safe = projectRestartSafety(extended.value, input);
  assert.deepEqual(safe.safety.blockedRiskIncreasingIntentIds, []);
  assert.deepEqual(safe.safety.allowedRiskReducingOrNeutralIntentIds, [intent.id]);
  assert.deepEqual(safe.safety.usableApprovalIds, [approval.id]);

  const advisory = projectRestartSafety({ ...extended.value,
    approvals: [{ ...approval, mode: 'ADVISORY' }] }, input);
  assert.deepEqual(advisory.safety.usableApprovalIds, []);
  const staleBinding = projectRestartSafety({ ...extended.value,
    approvals: [{ ...approval, mandateDigest: 'different-mandate-digest' }] }, input);
  assert.deepEqual(staleBinding.safety.usableApprovalIds, []);
});

test('closed positions with positive exposure fail closed into recovery supervision', () => {
  const state = replayCapitalCheckpointEvents(STREAM, events);
  assert.equal(state.ok, true);
  const projection = projectRestartSafety({ ...state.value,
    positions: [{ ...position, state: 'CLOSED', capitalLifecycle: 'CLOSED' }] }, {
    nowMs: NOW, correlationId: 'restart-closed-exposure', accountTruth: truth(),
    reconciliationTruth: truth(), reconciliationReferences: [reconciliation],
  });
  assert.equal(projection.safety.canOpenOrIncrease, false);
  assert.deepEqual(projection.safety.recoveryRequiredPositionIds, [position.id]);
  assert.deepEqual(projection.safety.visiblePositionIds, [position.id]);
  assert.equal(projection.effectivePositions[0].state, 'RECOVERY_REQUIRED');
  assert.ok(projection.safety.reasonCodes.includes('CLOSED_POSITION_HAS_EXPOSURE'));
});
