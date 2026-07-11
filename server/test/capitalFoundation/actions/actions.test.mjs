import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessCapitalTruth,
  deriveActivePositionId,
  derivePositionThesisId,
  normalizeExactDecimal,
} from '../../../dist/capitalFoundation/contracts/index.js';
import {
  planEconomicAction,
  resultingExposure,
  targetExposureChange,
} from '../../../dist/capitalFoundation/actions/index.js';

const NOW = 1_800_000_000_000;

function truth(overrides = {}) {
  return assessCapitalTruth({
    source: {
      sourceTimeMs: NOW - 10,
      receivedAtMs: NOW - 5,
      maxAgeMs: 1_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceId: 'actions-test',
      ...overrides,
    },
    evaluatedAtMs: NOW,
    requiredValuePresent: true,
  });
}

function decision(kind, overrides = {}) {
  return {
    kind,
    why: ['supervisor selected economic response'],
    triggerCodes: ['THESIS_CHECK'],
    supportingEvidenceIds: ['evidence-2', 'evidence-1'],
    conflictingEvidenceIds: [],
    requiredFutureGates: [],
    blockingFacts: [],
    urgency: 'ELEVATED',
    hardDeadlineMs: NOW + 5_000,
    economicCostOfWaiting: '4.25',
    expectedCostOfActing: '1.5',
    invalidationConditions: ['position revision changes'],
    ...overrides,
  };
}

function input(nextDecision, posture = 'OPEN', truthValue = truth()) {
  return {
    position: {
      positionId: deriveActivePositionId({ p: 1 }),
      positionRevision: 7,
      thesisId: derivePositionThesisId({ t: 1 }),
      thesisRevision: 3,
      valuationAsset: 'USDT',
      currentTotalExposure: '100',
      currentNetDirectionalExposure: '20',
      currentBaseQuantity: '0.002',
      currentHedgeRatio: '1',
      completeness: 'COMPLETE',
      truthReasonCodes: [],
    },
    decision: nextDecision,
    controlPosture: { posture, truth: truthValue, revision: 'control-2', reasonCodes: posture === 'OPEN' ? [] : [posture] },
    nowMs: NOW,
    idempotencyKey: 'position-1:revision-7:decision',
    correlationKey: 'cor-actions-1',
  };
}

function unwrap(result) {
  assert.equal(result.ok, true, result.ok ? '' : `${result.failure.code}: ${result.failure.message}`);
  return result.value;
}

function addDecision(overrides = {}) {
  return decision('ADD_STAGE', {
    targetTotalExposure: '125',
    targetBaseQuantity: '0.0025',
    targetHedgeRatio: '1',
    authority: {
      currentStageSequence: 2,
      authorizedStageSequence: 3,
      authorizedStage: 'ADD',
      maximumAdditionalExposure: '30',
      maximumTotalExposure: '130',
      freshEvidence: true,
      reservationAvailable: true,
      approvalValidated: true,
      futureRiskRecheckRequired: true,
      adversePriceMoveIsSoleReason: false,
    },
    ...overrides,
  });
}

test('HOLD preserves exact exposure and states why, trigger, wait cost, act cost, gates, and invalidation', () => {
  const intent = unwrap(planEconomicAction(input(decision('HOLD'))));
  assert.equal(intent.kind, 'HOLD');
  assert.equal(intent.riskEffect, 'NO_CHANGE');
  assert.deepEqual(intent.target, { kind: 'TOTAL', valuationAsset: 'USDT', quoteNotional: '100', baseQuantity: '0.002', targetHedgeRatio: '1' });
  assert.ok(intent.why.includes('TRIGGER:THESIS_CHECK'));
  assert.equal(intent.economicCostOfWaiting, '4.25');
  assert.equal(intent.expectedCostOfActing, '1.5');
  assert.deepEqual(intent.invalidationConditions, ['position revision changes']);
});

test('ADD_STAGE emits only the next authorized exact total and every external gate', () => {
  const intent = unwrap(planEconomicAction(input(addDecision())));
  assert.equal(intent.kind, 'ADD_STAGE');
  assert.equal(intent.riskEffect, 'RISK_INCREASING');
  assert.equal(intent.target.quoteNotional, '125');
  assert.equal(targetExposureChange(intent, '100'), '25');
  assert.equal(resultingExposure(intent, '100'), '125');
  assert.deepEqual(intent.requiredFutureGates, [
    'EXECUTION_COORDINATOR',
    'FRESH_ACCOUNT_TRUTH',
    'FRESH_MARKET_EVIDENCE',
    'MULTI_LEG_RISK',
    'OPERATOR_APPROVAL',
    'RECONCILIATION',
  ]);
});

test('ADD_STAGE rejects skips, excess, missing authority, and accidental averaging down', () => {
  const cases = [
    [addDecision({ authority: { ...addDecision().authority, authorizedStageSequence: 4 } }), 'NEXT_AUTHORIZED_STAGE_REQUIRED'],
    [addDecision({ targetTotalExposure: '131' }), 'ADD_STAGE_LIMIT_EXCEEDED'],
    [addDecision({ authority: { ...addDecision().authority, freshEvidence: false } }), 'FRESH_EVIDENCE_REQUIRED'],
    [addDecision({ authority: { ...addDecision().authority, reservationAvailable: false } }), 'RESERVATION_REQUIRED'],
    [addDecision({ authority: { ...addDecision().authority, approvalValidated: false } }), 'APPROVAL_REQUIRED'],
    [addDecision({ authority: { ...addDecision().authority, futureRiskRecheckRequired: false } }), 'FUTURE_RISK_RECHECK_REQUIRED'],
    [addDecision({ authority: { ...addDecision().authority, adversePriceMoveIsSoleReason: true } }), 'AVERAGING_DOWN_FORBIDDEN'],
  ];
  for (const [candidate, code] of cases) {
    const result = planEconomicAction(input(candidate));
    assert.equal(result.ok, false, `case ${code} must fail`);
    assert.equal(result.failure.code, code);
  }
});

test('ADD_STAGE rejects incomplete position truth while reductions remain representable', () => {
  const addInput = input(addDecision());
  addInput.position.completeness = 'DIVERGENT';
  addInput.position.truthReasonCodes = ['RECONCILIATION_DIVERGENT'];
  const blocked = planEconomicAction(addInput);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.failure.code, 'COMPLETE_POSITION_TRUTH_REQUIRED');
  const reduceInput = input(decision('REDUCE', { targetTotalExposure: '40', targetNetDirectionalExposure: '10', targetBaseQuantity: null, targetHedgeRatio: null }));
  reduceInput.position.completeness = 'PARTIAL';
  reduceInput.position.truthReasonCodes = ['ONE_LEG_TRUTH_PARTIAL'];
  const reduction = unwrap(planEconomicAction(reduceInput));
  assert.equal(reduction.completeness, 'PARTIAL');
  assert.ok(reduction.blockingFacts.includes('ONE_LEG_TRUTH_PARTIAL'));
});

test('pause, kill, stale, and unknown control truth freeze ADD without fabricating flatness', () => {
  const stale = truth({ sourceTimeMs: NOW - 2_000 });
  for (const context of [
    input(addDecision(), 'PAUSED_NEW_EXPOSURE'),
    input(addDecision(), 'KILL_NEW_EXPOSURE'),
    input(addDecision(), 'OPEN', stale),
    input(addDecision(), 'UNKNOWN'),
  ]) {
    const intent = unwrap(planEconomicAction(context));
    assert.equal(intent.kind, 'FREEZE_NEW_ACTIONS');
    assert.equal(intent.riskEffect, 'NO_CHANGE');
    assert.equal(intent.target.quoteNotional, '100');
    assert.ok(intent.blockingFacts.includes('RISK_INCREASE_BLOCKED_BY_CONTROL'));
  }
});

test('pause and kill never suppress exact reduce, exit, hedge, or emergency targets', () => {
  const candidates = [
    decision('REDUCE', { targetTotalExposure: '40', targetNetDirectionalExposure: '10', targetBaseQuantity: '0.0008', targetHedgeRatio: '1' }),
    decision('REQUEST_HEDGE', { targetQuoteDelta: '-20', targetBaseQuantity: '-0.0004', targetHedgeRatio: '1' }),
    decision('REQUEST_EXIT'),
    decision('REQUEST_EMERGENCY_UNWIND', { urgency: 'EMERGENCY', hardDeadlineMs: NOW }),
  ];
  for (const candidate of candidates) {
    const intent = unwrap(planEconomicAction(input(candidate, 'KILL_NEW_EXPOSURE')));
    assert.equal(intent.riskEffect, 'RISK_REDUCING');
    assert.ok(intent.requiredFutureGates.includes('EXECUTION_COORDINATOR'));
    assert.ok(intent.requiredFutureGates.includes('RECONCILIATION'));
  }
});

test('reduction must be below current exposure and a hedge must be proven risk-reducing', () => {
  const noReduction = planEconomicAction(input(decision('REDUCE', { targetTotalExposure: '100', targetNetDirectionalExposure: '20', targetBaseQuantity: null, targetHedgeRatio: null })));
  assert.equal(noReduction.ok, false);
  assert.equal(noReduction.failure.code, 'REDUCTION_TARGET_INVALID');
  const unsafeHedge = planEconomicAction(input(decision('REQUEST_HEDGE', { targetQuoteDelta: '20', targetBaseQuantity: null, targetHedgeRatio: '1' })));
  assert.equal(unsafeHedge.ok, false);
  assert.equal(unsafeHedge.failure.code, 'RISK_REDUCING_HEDGE_REQUIRED');
});

test('risk-reducing labels are derived from exposure geometry, never caller assertion', () => {
  const oversizedHedge = planEconomicAction(input(decision('REQUEST_HEDGE', {
    targetQuoteDelta: '-50', targetBaseQuantity: '-0.001', targetHedgeRatio: '1',
  })));
  assert.equal(oversizedHedge.ok, false);
  assert.equal(oversizedHedge.failure.code, 'RISK_REDUCING_HEDGE_REQUIRED');

  const directionalReduction = planEconomicAction(input(decision('REDUCE', {
    targetTotalExposure: '99', targetNetDirectionalExposure: '1000', targetBaseQuantity: '1000', targetHedgeRatio: '999',
  })));
  assert.equal(directionalReduction.ok, false);
  assert.equal(directionalReduction.failure.code, 'REDUCTION_INCREASES_DIRECTIONAL_RISK');
});

test('NO_ACTION_UNKNOWN retains unknown exposure instead of representing it as zero', () => {
  const intent = unwrap(planEconomicAction(input(decision('NO_ACTION_UNKNOWN', { unknownReasonCodes: ['RECONCILIATION_DIVERGENT'] }))));
  assert.deepEqual(intent.target, { kind: 'UNKNOWN', valuationAsset: 'USDT', reasonCodes: ['RECONCILIATION_DIVERGENT'] });
  assert.equal(targetExposureChange(intent, '100'), null);
  assert.equal(resultingExposure(intent, '100'), null);
});

test('exit and emergency unwind target exact zero without defining order mechanics', () => {
  for (const kind of ['REQUEST_EXIT', 'REQUEST_EMERGENCY_UNWIND']) {
    const intent = unwrap(planEconomicAction(input(decision(kind))));
    assert.equal(intent.target.quoteNotional, '0');
    assert.equal(targetExposureChange(intent, '100'), '-100');
    assert.equal('orders' in intent, false);
    assert.equal('sequence' in intent, false);
    assert.equal('retries' in intent, false);
  }
});

test('replay is byte-equivalent and output is frozen', () => {
  const first = unwrap(planEconomicAction(input(addDecision())));
  const second = unwrap(planEconomicAction(input(addDecision())));
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.id, second.id);
  assert.equal(normalizeExactDecimal(first.target.quoteNotional), first.target.quoteNotional);
});
