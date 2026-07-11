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
      activeStageAuthority: stageBinding(),
    },
    decision: nextDecision,
    controlPosture: { posture, truth: truthValue, revision: 'control-2', reasonCodes: posture === 'OPEN' ? [] : [posture] },
    nowMs: NOW,
    idempotencyKey: 'position-1:revision-7:decision',
    correlationKey: 'cor-actions-1',
  };
}

function stageBinding(overrides = {}) {
  return {
    activeStage: 'CONFIRM',
    planId: 'staged-plan-actions-1',
    planRevision: 4,
    planDigest: 'staged-plan-actions-digest-4',
    reservationId: 'reservation-actions-1',
    reservationRevision: 3,
    approvalId: 'approval-actions-1',
    approvalRevision: 2,
    ...overrides,
  };
}

function stageAuthorization(overrides = {}) {
  return {
    from: 'CONFIRM',
    to: 'ADD',
    authorizedForExternalRiskEvaluation: true,
    executionReady: false,
    reservationConsumption: '25',
    requiredFutureGates: ['OPERATOR_APPROVAL', 'MULTI_LEG_RISK', 'FRESH_ACCOUNT_TRUTH', 'FRESH_MARKET_EVIDENCE'],
    evaluatedAtMs: NOW,
    planId: 'staged-plan-actions-1',
    planRevision: 4,
    planDigest: 'staged-plan-actions-digest-4',
    reservationId: 'reservation-actions-1',
    reservationRevision: 3,
    reservationAvailable: '30',
    approvalId: 'approval-actions-1',
    approvalRevision: 2,
    ...overrides,
  };
}

function unwrap(result) {
  assert.equal(result.ok, true, result.ok ? '' : `${result.failure.code}: ${result.failure.message}`);
  return result.value;
}

function assertDeterministicFrozenFailure(makeResult, expectedCode) {
  const first = makeResult();
  const replay = makeResult();
  assert.equal(first.ok, false, `${expectedCode} must return a typed failure`);
  assert.equal(first.failure.code, expectedCode);
  assert.equal(first.failure.safeCurrentState, 'EXPOSURE_UNCHANGED');
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.failure), true);
  assert.equal(JSON.stringify(first), JSON.stringify(replay));
  assert.equal('value' in first, false);
}

function addDecision(overrides = {}) {
  return decision('ADD_STAGE', {
    targetTotalExposure: '125',
    targetBaseQuantity: '0.0025',
    targetHedgeRatio: '1',
    authority: stageAuthorization(),
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
  assert.equal(intent.stageTransitionAuthorization.planId, 'staged-plan-actions-1');
  assert.equal(intent.stageTransitionAuthorization.planRevision, 4);
  assert.equal(intent.stageTransitionAuthorization.planDigest, 'staged-plan-actions-digest-4');
  assert.equal(intent.stageTransitionAuthorization.reservationId, 'reservation-actions-1');
  assert.equal(intent.stageTransitionAuthorization.approvalId, 'approval-actions-1');
  assert.equal(intent.directionalReductionGeometry, null);
  assert.deepEqual(intent.requiredFutureGates, [
    'EXECUTION_COORDINATOR',
    'FRESH_ACCOUNT_TRUTH',
    'FRESH_MARKET_EVIDENCE',
    'MULTI_LEG_RISK',
    'OPERATOR_APPROVAL',
    'RECONCILIATION',
  ]);
});

test('position and thesis revisions must be positive safe integers before any action or freeze is emitted', () => {
  for (const field of ['positionRevision', 'thesisRevision']) {
    const expectedCode = field === 'positionRevision' ? 'POSITION_REVISION_INVALID' : 'THESIS_REVISION_INVALID';
    for (const hostileRevision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const makeResult = () => {
        const candidate = input(addDecision(), 'KILL_NEW_EXPOSURE');
        candidate.position[field] = hostileRevision;
        return planEconomicAction(candidate);
      };
      assertDeterministicFrozenFailure(makeResult, expectedCode);
    }
  }
});

test('every ADD authority revision is positive and safe on both the active binding and transition authorization', () => {
  for (const field of ['planRevision', 'reservationRevision', 'approvalRevision']) {
    for (const hostileRevision of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assertDeterministicFrozenFailure(() => {
        const candidate = input(addDecision());
        candidate.position.activeStageAuthority = stageBinding({ [field]: hostileRevision });
        return planEconomicAction(candidate);
      }, 'ACTIVE_STAGE_BINDING_INVALID');

      assertDeterministicFrozenFailure(() => planEconomicAction(input(addDecision({
        authority: stageAuthorization({ [field]: hostileRevision }),
      }))), 'STAGE_AUTHORITY_REVISION_INVALID');
    }
  }
});

test('action identity boundaries reject blank or oversized IDs with typed frozen failures', () => {
  const cases = [
    [candidate => { candidate.position.positionId = ' '; }, 'POSITION_ID_INVALID'],
    [candidate => { candidate.position.positionId = ' position-1'; }, 'POSITION_ID_INVALID'],
    [candidate => { candidate.position.positionId = 'p'.repeat(257); }, 'POSITION_ID_INVALID'],
    [candidate => { candidate.position.thesisId = ''; }, 'THESIS_ID_INVALID'],
    [candidate => { candidate.position.thesisId = 'thesis-9 '; }, 'THESIS_ID_INVALID'],
    [candidate => { candidate.position.thesisId = 't'.repeat(257); }, 'THESIS_ID_INVALID'],
    [candidate => { candidate.idempotencyKey = ''; }, 'IDEMPOTENCY_KEY_REQUIRED'],
    [candidate => { candidate.idempotencyKey = ' idem-key'; }, 'IDEMPOTENCY_KEY_REQUIRED'],
    [candidate => { candidate.correlationKey = 'correlation-key '; }, 'CORRELATION_KEY_REQUIRED'],
    [candidate => { candidate.correlationKey = 'c'.repeat(129); }, 'CORRELATION_KEY_REQUIRED'],
    [candidate => { candidate.controlPosture.revision = ' '; }, 'CONTROL_POSTURE_REVISION_INVALID'],
    [candidate => { candidate.controlPosture.revision = 'control-2 '; }, 'CONTROL_POSTURE_REVISION_INVALID'],
  ];
  for (const [mutate, expectedCode] of cases) {
    assertDeterministicFrozenFailure(() => {
      const candidate = input(decision('HOLD'));
      mutate(candidate);
      return planEconomicAction(candidate);
    }, expectedCode);
  }

  assertDeterministicFrozenFailure(() => {
    const candidate = input(addDecision());
    candidate.position.activeStageAuthority = stageBinding({ planId: ' staged-plan-actions-1' });
    return planEconomicAction(candidate);
  }, 'ACTIVE_STAGE_BINDING_INVALID');
  assertDeterministicFrozenFailure(() => planEconomicAction(input(addDecision({
    authority: stageAuthorization({ approvalId: 'approval-actions-1 ' }),
  }))), 'STAGE_AUTHORITY_IDENTITY_INVALID');

  assert.doesNotThrow(() => unwrap(planEconomicAction(input(decision('HOLD')))), 'legitimate lowercase and colon-delimited IDs remain valid');
});

test('action provenance and reason arrays reject padded or malformed entries instead of silently canonicalizing them', () => {
  const cases = [
    [candidate => { candidate.decision.why = [' supervisor selected economic response']; }, 'WHY_INVALID'],
    [candidate => { candidate.decision.triggerCodes = ['THESIS_CHECK ']; }, 'TRIGGER_INVALID'],
    [candidate => { candidate.decision.supportingEvidenceIds = ['venue:fill:1', ' venue:fill:1']; }, 'SUPPORTING_EVIDENCE_ID_INVALID'],
    [candidate => { candidate.decision.conflictingEvidenceIds = ['venue:fill:2 ']; }, 'CONFLICTING_EVIDENCE_ID_INVALID'],
    [candidate => { candidate.decision.blockingFacts = [' risk:blocked']; }, 'BLOCKING_FACT_INVALID'],
    [candidate => { candidate.decision.invalidationConditions = ['position revision changes ']; }, 'INVALIDATION_CONDITION_INVALID'],
    [candidate => { candidate.position.truthReasonCodes = [' position:truth']; }, 'POSITION_TRUTH_REASON_INVALID'],
    [candidate => { candidate.controlPosture.reasonCodes = ['operator:pause ']; }, 'CONTROL_POSTURE_REASON_INVALID'],
    [candidate => { candidate.controlPosture.truth = { ...candidate.controlPosture.truth, reasons: [' stale:control'] }; }, 'CONTROL_TRUTH_REASON_INVALID'],
    [candidate => { candidate.controlPosture.truth = { ...candidate.controlPosture.truth, evidenceReferences: ['control:evidence ' ] }; }, 'CONTROL_TRUTH_EVIDENCE_INVALID'],
    [candidate => { candidate.decision.supportingEvidenceIds = 'venue:fill:1'; }, 'SUPPORTING_EVIDENCE_ID_INVALID'],
    [candidate => { candidate.decision.why = ['x'.repeat(257)]; }, 'WHY_INVALID'],
  ];
  for (const [mutate, expectedCode] of cases) {
    assertDeterministicFrozenFailure(() => {
      const candidate = input(decision('HOLD'));
      mutate(candidate);
      return planEconomicAction(candidate);
    }, expectedCode);
  }

  assertDeterministicFrozenFailure(() => planEconomicAction(input(decision('NO_ACTION_UNKNOWN', {
    unknownReasonCodes: [' reconciliation:unknown'],
  }))), 'UNKNOWN_REASON_INVALID');

  const canonical = unwrap(planEconomicAction(input(decision('NO_ACTION_UNKNOWN', {
    why: ['supervisor:reason:lowercase'],
    triggerCodes: ['thesis:check'],
    supportingEvidenceIds: ['binance:fill:abc-123'],
    conflictingEvidenceIds: ['market:evidence:def-456'],
    blockingFacts: ['risk:fact'],
    invalidationConditions: ['position:revision:changes'],
    unknownReasonCodes: ['reconciliation:unknown'],
  }))));
  assert.deepEqual(canonical.supportingEvidenceIds, ['binance:fill:abc-123']);
  assert.deepEqual(canonical.conflictingEvidenceIds, ['market:evidence:def-456']);
  assert.deepEqual(canonical.target.reasonCodes, ['reconciliation:unknown']);
  assert.ok(canonical.why.includes('supervisor:reason:lowercase'));
});

test('ADD_STAGE rejects self-asserted flags, stale authority, mismatched bindings, missing gates, and inexact targets', () => {
  const cases = [
    [input(addDecision({ authority: {
      freshEvidence: true,
      reservationAvailable: true,
      approvalValidated: true,
      futureRiskRecheckRequired: true,
    } })), 'STAGE_TRANSITION_NOT_AUTHORIZED'],
    [input(addDecision({ authority: stageAuthorization({ evaluatedAtMs: NOW - 1 }) })), 'STAGE_TRANSITION_AUTHORIZATION_STALE'],
    [input(addDecision({ authority: stageAuthorization({ authorizedForExternalRiskEvaluation: false }) })), 'STAGE_TRANSITION_NOT_AUTHORIZED'],
    [input(addDecision({ authority: stageAuthorization({ executionReady: true }) })), 'STAGE_TRANSITION_NOT_AUTHORIZED'],
    [input(addDecision({ authority: stageAuthorization({ from: 'PROBE' }) })), 'STAGE_TRANSITION_NOT_AUTHORIZED'],
    [input(addDecision({ authority: stageAuthorization({ to: 'HOLD' }) })), 'STAGE_TRANSITION_NOT_AUTHORIZED'],
    [input(addDecision({ authority: stageAuthorization({ planId: 'other-plan' }) })), 'STAGE_PLAN_BINDING_MISMATCH'],
    [input(addDecision({ authority: stageAuthorization({ planRevision: 5 }) })), 'STAGE_PLAN_BINDING_MISMATCH'],
    [input(addDecision({ authority: stageAuthorization({ planDigest: 'forged-plan-digest' }) })), 'STAGE_PLAN_BINDING_MISMATCH'],
    [input(addDecision({ authority: stageAuthorization({ reservationId: 'other-reservation' }) })), 'STAGE_AUTHORITY_REFERENCE_MISMATCH'],
    [input(addDecision({ authority: stageAuthorization({ reservationRevision: 4 }) })), 'STAGE_AUTHORITY_REFERENCE_MISMATCH'],
    [input(addDecision({ authority: stageAuthorization({ approvalId: 'other-approval' }) })), 'STAGE_AUTHORITY_REFERENCE_MISMATCH'],
    [input(addDecision({ authority: stageAuthorization({ approvalRevision: 3 }) })), 'STAGE_AUTHORITY_REFERENCE_MISMATCH'],
    [input(addDecision({ authority: stageAuthorization({ requiredFutureGates: ['OPERATOR_APPROVAL', 'MULTI_LEG_RISK', 'FRESH_ACCOUNT_TRUTH'] }) })), 'STAGE_AUTHORITY_FUTURE_GATES_INVALID'],
    [input(addDecision({ authority: stageAuthorization({ requiredFutureGates: ['OPERATOR_APPROVAL', 'MULTI_LEG_RISK', 'FRESH_ACCOUNT_TRUTH', 'FRESH_MARKET_EVIDENCE', 'FRESH_MARKET_EVIDENCE'] }) })), 'STAGE_AUTHORITY_FUTURE_GATES_INVALID'],
    [input(addDecision({ authority: stageAuthorization({ reservationAvailable: '24.999' }) })), 'STAGE_RESERVATION_AUTHORITY_INVALID'],
    [input(addDecision({ targetTotalExposure: '124.999' })), 'ADD_STAGE_TARGET_NOT_AUTHORIZED'],
  ];
  const missingBinding = input(addDecision());
  missingBinding.position.activeStageAuthority = null;
  cases.push([missingBinding, 'ACTIVE_STAGE_BINDING_REQUIRED']);
  for (const [candidateInput, code] of cases) {
    const result = planEconomicAction(candidateInput);
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

test('ADD re-ages cached control truth at planning time and freezes authority that has since become stale', () => {
  const cachedAtEarlierClock = assessCapitalTruth({
    source: {
      sourceTimeMs: NOW - 10,
      receivedAtMs: NOW - 5,
      maxAgeMs: 1_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceId: 'cached-control-truth',
    },
    evaluatedAtMs: NOW,
    requiredValuePresent: true,
  });
  assert.equal(cachedAtEarlierClock.freshness.state, 'FRESH');
  const later = input(addDecision(), 'OPEN', cachedAtEarlierClock);
  later.nowMs = NOW + 1_001;
  later.decision.authority = stageAuthorization({ evaluatedAtMs: later.nowMs });
  const intent = unwrap(planEconomicAction(later));
  assert.equal(intent.kind, 'FREEZE_NEW_ACTIONS');
  assert.equal(intent.target.quoteNotional, '100');
  assert.ok(intent.blockingFacts.includes('CONTROL_TRUTH:STALE'));
  assert.equal(intent.stageTransitionAuthorization, null);
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

test('REDUCE emits exact signed target geometry and binds it into the deterministic intent identity', () => {
  const first = unwrap(planEconomicAction(input(decision('REDUCE', {
    targetTotalExposure: '40',
    targetNetDirectionalExposure: '-5',
    targetBaseQuantity: '0.0008',
    targetHedgeRatio: '1',
  }))));
  assert.deepEqual(first.directionalReductionGeometry, {
    currentTotalExposure: '100',
    targetTotalExposure: '40',
    currentNetDirectionalExposure: '20',
    targetNetDirectionalExposure: '-5',
    absoluteDirectionalExposureReduction: '15',
  });
  assert.equal(first.stageTransitionAuthorization, null);
  assert.equal(Object.isFrozen(first.directionalReductionGeometry), true);

  const changedSignedTarget = unwrap(planEconomicAction(input(decision('REDUCE', {
    targetTotalExposure: '40',
    targetNetDirectionalExposure: '5',
    targetBaseQuantity: '0.0008',
    targetHedgeRatio: '1',
  }))));
  assert.deepEqual(changedSignedTarget.target, first.target);
  assert.notEqual(changedSignedTarget.id, first.id);
  assert.equal(changedSignedTarget.directionalReductionGeometry.targetNetDirectionalExposure, '5');
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
  assert.equal(Object.isFrozen(first.stageTransitionAuthorization), true);
  assert.equal(Object.isFrozen(first.stageTransitionAuthorization.requiredFutureGates), true);
  assert.equal(first.id, second.id);
  assert.equal(normalizeExactDecimal(first.target.quoteNotional), first.target.quoteNotional);
});
