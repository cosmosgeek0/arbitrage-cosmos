import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessCapitalTruth,
  validatePositionActionIntent,
} from '../../../dist/capitalFoundation/contracts/index.js';
import { projectActivePosition } from '../../../dist/capitalFoundation/positions/index.js';
import {
  BASIS_FUNDING_DIRECTIONS,
  BASIS_RESOURCE_AVAILABILITIES,
  EXACT_EVIDENCE_SIGNAL_STATES,
  SUPERVISION_COUNT_UNIT,
  SUPERVISION_MILLISECONDS_UNIT,
  SUPERVISION_RATIO_UNIT,
  VOLUME_CALIBRATION_MODES,
  VOLUME_LEADERSHIP_STATES,
  deriveBasisSupervisionPolicyRevision,
  deriveCommonSupervisionPolicyRevision,
  deriveVolumeSupervisionPolicyRevision,
  superviseBasisPosition,
  superviseVolumePosition,
} from '../../../dist/capitalFoundation/supervision/index.js';

const NOW = 1_800_000_000_000;

function truth(overrides = {}) {
  return assessCapitalTruth({
    source: {
      sourceTimeMs: NOW - 100,
      receivedAtMs: NOW - 90,
      maxAgeMs: 1_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceId: overrides.sourceId ?? 'lane-f-supervision-test',
      ...(overrides.source ?? {}),
    },
    evaluatedAtMs: NOW,
    requiredValuePresent: overrides.requiredValuePresent ?? true,
    divergent: overrides.divergent ?? false,
    reasons: overrides.reasons ?? [],
    revision: overrides.revision ?? 'r1',
  });
}

/** Caller lies by retaining a cached FRESH report after changing source time. */
function forgedCachedFreshButOld(sourceId) {
  const cached = truth({ sourceId });
  return {
    ...cached,
    source: {
      ...cached.source,
      sourceTimeMs: NOW - 10_000,
      receivedAtMs: NOW - 9_900,
    },
  };
}

function authority(name) {
  return {
    revision: `unbound-${name}`,
    sourceId: `policy-${name}`,
    issuedAtMs: NOW - 10_000,
    effectiveFromMs: NOW - 5_000,
    effectiveUntilMs: NOW + 100_000,
  };
}

function exactBound(value, maximum = '1000000', unit = 'USDT') {
  return { value, minimum: '0', maximum, unit };
}

function integerBound(value, maximum = 10_000_000, unit = SUPERVISION_MILLISECONDS_UNIT) {
  return { value, minimum: 0, maximum, unit };
}

function bindPolicyRevision(policy, deriveRevision) {
  policy.authority = { ...policy.authority, revision: deriveRevision(policy) };
  return policy;
}

function thesis(strategy, overrides = {}) {
  return {
    id: `thesis-${strategy}`,
    revision: 2,
    strategy,
    proposalId: `proposal-${strategy}`,
    originalEvidenceIds: ['original-evidence'],
    intelligenceThesisPacketId: 'intelligence-thesis-1',
    openedAtMs: NOW - 10_000,
    expectedHorizonMs: 1_000_000,
    maximumHoldingHorizonMs: 2_000_000,
    targetConditions: ['target'],
    invalidationConditions: ['invalidated'],
    stopAddingConditions: ['stop-add'],
    configRevision: 'strategy-cfg-1',
    ...overrides,
  };
}

function leg(id, side, exposure = '100') {
  return {
    id,
    instrumentId: id,
    symbol: 'BTCUSDT',
    side,
    quantity: '1',
    quoteExposure: exposure,
    valuationAsset: 'USDT',
    externalLifecycle: 'FILLED',
    truth: truth(),
  };
}

function projectedPosition(strategy = 'BASIS', overrides = {}) {
  const legs = overrides.legs ?? (strategy === 'BASIS' ? [leg('spot', 'LONG'), leg('perp', 'SHORT')] : [leg('spot', 'LONG')]);
  const reconciliationStatus = overrides.reconciliationStatus ?? 'EXACT';
  return projectActivePosition({
    revision: 3,
    mandateId: `mandate-${strategy}`,
    thesis: overrides.thesis ?? thesis(strategy),
    sourceState: overrides.sourceState ?? 'ACTIVE',
    sourceCapitalLifecycle: overrides.sourceCapitalLifecycle ?? 'ACTIVE',
    legs,
    oneLegSinceMs: overrides.oneLegSinceMs ?? null,
    executionState: {
      externalPlanId: `plan-${strategy}`,
      correlationId: `cor-${strategy}`,
      lifecycle: overrides.executionLifecycle ?? 'HEDGED_OPEN',
      observedAtMs: NOW - 50,
      sequence: 2,
      revision: 'exec-2',
      truth: truth(),
    },
    reconciliationState: {
      externalPlanId: overrides.reconciliationExternalPlanId ?? `plan-${strategy}`,
      correlationId: `cor-${strategy}`,
      status: reconciliationStatus,
      observedAtMs: NOW - 40,
      sequence: 3,
      revision: 'recon-3',
      reasonCodes: reconciliationStatus === 'EXACT' ? [] : ['SYNTHETIC_RECON_ISSUE'],
      truth: truth({ divergent: reconciliationStatus === 'DIVERGED' }),
    },
    outstandingActionIntentIds: overrides.outstandingActionIntentIds ?? [],
    openedAtMs: NOW - 10_000,
    lastTransitionAtMs: NOW - 1_000,
    truth: truth(),
    projectedAtMs: NOW,
  }).position;
}

function commonPolicy() {
  return bindPolicyRevision({
    authority: authority('common'),
    valuationAsset: 'USDT',
    targetHedgeRatio: exactBound('1', '2', SUPERVISION_RATIO_UNIT),
    maximumHedgeRatioDrift: exactBound('0.05', '1', SUPERVISION_RATIO_UNIT),
    maximumOneLegExposure: exactBound('50', '1000'),
    maximumOneLegDurationMs: integerBound(1_000),
    emergencyOneLegDurationMs: integerBound(2_000),
    minimumExitCapacity: exactBound('150', '10000'),
    minimumAvailableDepth: exactBound('150', '10000'),
    maximumExecutableSpreadCost: exactBound('5', '100'),
    maximumProjectedExitCost: exactBound('10', '100'),
    maximumTotalGrossExposure: exactBound('1000', '10000'),
    reductionTargetExposure: exactBound('100', '10000'),
    maximumOutstandingIntents: integerBound(2, 100, SUPERVISION_COUNT_UNIT),
  }, deriveCommonSupervisionPolicyRevision);
}

function activeStageAuthority() {
  return {
    activeStage: 'ACTIVE',
    planId: 'staged-plan-1',
    planRevision: 3,
    planDigest: 'staged-plan-digest-3',
    reservationId: 'reservation-1',
    reservationRevision: 2,
    approvalId: 'approval-1',
    approvalRevision: 4,
  };
}

function stageTransitionAuthorization(overrides = {}) {
  return {
    from: 'ACTIVE',
    to: 'ADD',
    authorizedForExternalRiskEvaluation: true,
    executionReady: false,
    reservationConsumption: '100',
    requiredFutureGates: ['OPERATOR_APPROVAL', 'MULTI_LEG_RISK', 'FRESH_ACCOUNT_TRUTH', 'FRESH_MARKET_EVIDENCE'],
    evaluatedAtMs: NOW,
    planId: 'staged-plan-1',
    planRevision: 3,
    planDigest: 'staged-plan-digest-3',
    reservationId: 'reservation-1',
    reservationRevision: 2,
    reservationAvailable: '200',
    approvalId: 'approval-1',
    approvalRevision: 4,
    ...overrides,
  };
}

function common(position, overrides = {}) {
  const expectedLegs = position.thesis.strategy === 'BASIS'
    ? [{ instrumentId: 'spot', side: 'LONG' }, { instrumentId: 'perp', side: 'SHORT' }]
    : [{ instrumentId: 'spot', side: 'LONG' }];
  return {
    position,
    expectedLegs,
    market: {
      executableSpreadCost: '1',
      availableDepth: '500',
      exitCapacity: '500',
      projectedExitCost: '2',
      truth: truth(),
      evidenceIds: ['market-1'],
      ...(overrides.market ?? {}),
    },
    costs: {
      accruedKnownCost: '3',
      projectedAdditionalCost: '2',
      truth: truth(),
      sourceIds: ['cost-1'],
      ...(overrides.costs ?? {}),
    },
    thesisAssessment: {
      invalidated: false,
      targetReached: false,
      supportingEvidenceIds: ['support-1'],
      conflictingEvidenceIds: [],
      reasonCodes: [],
      truth: truth(),
      ...(overrides.thesisAssessment ?? {}),
    },
    controlPosture: {
      posture: 'OPEN',
      truth: truth(),
      revision: 'control-r1',
      reasonCodes: [],
      ...(overrides.controlPosture ?? {}),
    },
    policy: overrides.policy ?? commonPolicy(),
    activeStageAuthority: overrides.activeStageAuthority === undefined ? activeStageAuthority() : overrides.activeStageAuthority,
    nextStageAuthority: overrides.nextStageAuthority === undefined ? stageTransitionAuthorization() : overrides.nextStageAuthority,
    economicCostOfWaiting: '4',
    expectedCostOfActing: '2',
    nowMs: NOW,
  };
}

function basisPolicy() {
  return bindPolicyRevision({
    authority: authority('basis'),
    minimumRemainingEdge: exactBound('1', '100', SUPERVISION_RATIO_UNIT),
    minimumRemainingEdgeForAdd: exactBound('2', '100', SUPERVISION_RATIO_UNIT),
    maximumAdverseBasisMove: exactBound('0.02', '1', SUPERVISION_RATIO_UNIT),
    maximumAdverseFundingRate: exactBound('0.01', '1', SUPERVISION_RATIO_UNIT),
    fundingExitLeadTimeMs: integerBound(60_000),
    maximumBorrowRate: exactBound('0.02', '1', SUPERVISION_RATIO_UNIT),
    maximumHedgeDrift: exactBound('0.05', '1', SUPERVISION_RATIO_UNIT),
    minimumLiquidationDistance: exactBound('2', '100', SUPERVISION_RATIO_UNIT),
    minimumMarginDistance: exactBound('2', '100', SUPERVISION_RATIO_UNIT),
    maximumLiquidityDeterioration: exactBound('0.5', '1', SUPERVISION_RATIO_UNIT),
    requiredConvergingObservationsForAdd: integerBound(3, 10, SUPERVISION_COUNT_UNIT),
  }, deriveBasisSupervisionPolicyRevision);
}

function basisFacts(overrides = {}) {
  return {
    entryExecutableBasis: '0.04',
    currentExecutableBasis: '0.01',
    convergencePath: [
      { executableBasis: '0.03', observedAtMs: NOW - 300, truth: truth(), evidenceId: 'basis-path-1' },
      { executableBasis: '0.02', observedAtMs: NOW - 200, truth: truth(), evidenceId: 'basis-path-2' },
      { executableBasis: '0.01', observedAtMs: NOW - 100, truth: truth(), evidenceId: 'basis-path-3' },
    ],
    expectedRemainingEdgeAfterExitCosts: '10',
    funding: {
      rate: '0.0001', direction: 'PAID', nextFundingAtMs: NOW + 30_000, accruedFunding: '-0.1', truth: truth(), evidenceIds: ['funding-1'],
      ...(overrides.funding ?? {}),
    },
    borrow: {
      availability: 'AVAILABLE', rate: '0.001', accruedCost: '0.1', truth: truth(), evidenceIds: ['borrow-1'],
      ...(overrides.borrow ?? {}),
    },
    hedgeDrift: '0',
    liquidationDistance: '10',
    marginDistance: '10',
    spotLiquidityDeterioration: '0.1',
    perpetualLiquidityDeterioration: '0.1',
    truth: truth(),
    evidenceIds: ['basis-facts-1'],
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'funding' && key !== 'borrow')),
  };
}

function basisInput(overrides = {}) {
  const position = overrides.position ?? projectedPosition('BASIS');
  return {
    common: common(position, overrides.common ?? {}),
    basis: basisFacts(overrides.basis ?? {}),
    policy: overrides.policy ?? basisPolicy(),
  };
}

function signal(state, strength = null, overrides = {}) {
  return { state, strength, truth: truth(), evidenceIds: [`signal-${state}`], ...overrides };
}

function volumePolicy() {
  return bindPolicyRevision({
    authority: authority('volume'),
    minimumContinuationStrength: exactBound('0.5', '1', SUPERVISION_RATIO_UNIT),
    minimumAccelerationStrengthForAdd: exactBound('0.6', '1', SUPERVISION_RATIO_UNIT),
    maximumExhaustionStrength: exactBound('0.7', '1', SUPERVISION_RATIO_UNIT),
    maximumReversalStrength: exactBound('0.6', '1', SUPERVISION_RATIO_UNIT),
    maximumCrowdingStrength: exactBound('0.8', '1', SUPERVISION_RATIO_UNIT),
    maximumLiquidityDeterioration: exactBound('0.5', '1', SUPERVISION_RATIO_UNIT),
    requireSpotLeadershipForAdd: true,
    reduceOnPerpetualLeadership: true,
  }, deriveVolumeSupervisionPolicyRevision);
}

function volumeFacts(overrides = {}) {
  return {
    originalThesisStage: 'ACTIVE',
    continuation: signal('PRESENT', '0.9'),
    acceleration: signal('PRESENT', '0.8'),
    exhaustion: signal('ABSENT', '0'),
    reversal: signal('ABSENT', '0'),
    leadership: 'SPOT',
    liquidityDeterioration: '0.1',
    crowding: signal('ABSENT', '0'),
    funding: signal('UNKNOWN'),
    openInterest: signal('UNKNOWN'),
    falseFollowThrough: false,
    washLike: false,
    calibrationMode: 'MANUAL_ARMED',
    calibrationTruth: truth(),
    truth: truth(),
    evidenceIds: ['volume-facts-1'],
    ...overrides,
  };
}

function volumeInput(overrides = {}) {
  const position = overrides.position ?? projectedPosition('VOLUME');
  return {
    common: common(position, overrides.common ?? {}),
    volume: volumeFacts(overrides.volume ?? {}),
    policy: overrides.policy ?? volumePolicy(),
  };
}

test('Basis supervisor recommends only next-stage typed intent with all fresh authority', () => {
  const input = basisInput();
  const decision = superviseBasisPosition(input);
  assert.equal(decision.intent.kind, 'ADD_STAGE');
  assert.equal(decision.intent.target.quoteNotional, '300');
  assert.equal(decision.intent.riskEffect, 'RISK_INCREASING');
  assert.deepEqual(validatePositionActionIntent(decision.intent), []);
  assert.ok(decision.intent.requiredFutureGates.includes('MULTI_LEG_RISK'));
  assert.ok(decision.intent.requiredFutureGates.includes('EXECUTION_COORDINATOR'));
  assert.deepEqual(decision.intent.stageTransitionAuthorization, input.common.nextStageAuthority);
  assert.equal(decision.intent.directionalReductionGeometry, null);
  assert.ok(Object.isFrozen(decision.intent.stageTransitionAuthorization));
  assert.ok(Object.isFrozen(decision.intent.stageTransitionAuthorization.requiredFutureGates));
  input.common.nextStageAuthority.planDigest = 'mutated-after-supervision';
  assert.equal(decision.intent.stageTransitionAuthorization.planDigest, 'staged-plan-digest-3');
});

test('next-stage authority cannot exceed its exact additional cap or portfolio gross limit', () => {
  const tooMuchAdditional = superviseBasisPosition(basisInput({ common: { nextStageAuthority: stageTransitionAuthorization({
    reservationConsumption: '201',
    reservationAvailable: '200',
  }) } }));
  assert.notEqual(tooMuchAdditional.intent.kind, 'ADD_STAGE');
  assert.equal(tooMuchAdditional.checks.find((item) => item.code === 'NEXT_STAGE_AUTHORITY').status, 'BREACH');

  const abovePortfolio = superviseBasisPosition(basisInput({ common: { nextStageAuthority: stageTransitionAuthorization({
    reservationConsumption: '1000',
    reservationAvailable: '1000',
  }) } }));
  assert.notEqual(abovePortfolio.intent.kind, 'ADD_STAGE');
  assert.equal(abovePortfolio.checks.find((item) => item.code === 'NEXT_STAGE_AUTHORITY').status, 'BREACH');
});

test('same supervision input and injected time is byte-equivalent', () => {
  const input = basisInput();
  assert.deepEqual(superviseBasisPosition(input), superviseBasisPosition(input));
});

test('pause and kill block ADD but preserve active supervision', () => {
  for (const posture of ['PAUSED_NEW_EXPOSURE', 'KILL_NEW_EXPOSURE']) {
    const decision = superviseBasisPosition(basisInput({ common: { controlPosture: { posture, truth: truth(), revision: `control-${posture}`, reasonCodes: [posture] } } }));
    assert.equal(decision.intent.kind, 'HOLD', `${posture} must block an increasing intent without hiding exposure`);
    assert.equal(decision.intent.stageTransitionAuthorization, null);
    assert.equal(decision.priority, 'EXPOSED_CAPITAL');
  }
});

test('divergent reconciliation freezes new actions and demands reconciliation', () => {
  const position = projectedPosition('BASIS', { reconciliationStatus: 'DIVERGED' });
  const decision = superviseBasisPosition(basisInput({ position }));
  assert.equal(decision.intent.kind, 'FREEZE_NEW_ACTIONS');
  assert.equal(decision.intent.urgency, 'EMERGENCY');
  assert.ok(decision.intent.requiredFutureGates.includes('RECONCILIATION'));
});

test('one-leg exposure remains an emergency risk-reduction intent when reconciliation diverges', () => {
  const position = projectedPosition('BASIS', {
    legs: [leg('spot', 'LONG')],
    executionLifecycle: 'ONE_LEG_EXPOSED',
    oneLegSinceMs: NOW - 500,
    reconciliationStatus: 'DIVERGED',
  });
  const decision = superviseBasisPosition(basisInput({ position }));
  assert.equal(decision.intent.kind, 'REQUEST_EMERGENCY_UNWIND');
  assert.equal(decision.intent.riskEffect, 'RISK_REDUCING');
  assert.ok(decision.intent.why.includes('ONE_LEG_RECONCILIATION_UNCERTAIN'));
  assert.ok(decision.intent.requiredFutureGates.includes('RECONCILIATION'));
});

test('cross-plan external truth cannot degrade to ACTIVE plus HOLD', () => {
  const position = projectedPosition('BASIS', { reconciliationExternalPlanId: 'other-plan' });
  const decision = superviseBasisPosition(basisInput({ position }));
  assert.equal(position.state, 'RECOVERY_REQUIRED');
  assert.equal(decision.intent.kind, 'FREEZE_NEW_ACTIONS');
  assert.equal(decision.checks.find((item) => item.code === 'POSITION_TRUTH').status, 'BREACH');
});

test('exact one-leg exposure recommends hedge before unopened capital work', () => {
  const position = projectedPosition('BASIS', { legs: [leg('spot', 'LONG')], executionLifecycle: 'ONE_LEG_EXPOSED', oneLegSinceMs: NOW - 500 });
  const decision = superviseBasisPosition(basisInput({ position }));
  assert.equal(decision.intent.kind, 'REQUEST_HEDGE');
  assert.equal(decision.intent.target.kind, 'DELTA');
  assert.equal(decision.intent.target.quoteNotional, '-100');
  assert.equal(decision.intent.riskEffect, 'RISK_REDUCING');
});

test('overdue one-leg exposure escalates to emergency unwind', () => {
  const position = projectedPosition('BASIS', { legs: [leg('spot', 'LONG')], executionLifecycle: 'ONE_LEG_EXPOSED', oneLegSinceMs: NOW - 2_500 });
  const decision = superviseBasisPosition(basisInput({ position }));
  assert.equal(decision.intent.kind, 'REQUEST_EMERGENCY_UNWIND');
  assert.equal(decision.intent.target.quoteNotional, '0');
});

test('thesis invalidation recommends exit even under kill posture', () => {
  const decision = superviseBasisPosition(basisInput({ common: {
    thesisAssessment: { invalidated: true, targetReached: false, supportingEvidenceIds: [], conflictingEvidenceIds: ['invalidate-1'], reasonCodes: ['THESIS_BROKEN'], truth: truth() },
    controlPosture: { posture: 'KILL_NEW_EXPOSURE', truth: truth(), revision: 'kill-r1', reasonCodes: ['OPERATOR_KILL'] },
  } }));
  assert.equal(decision.intent.kind, 'REQUEST_EXIT');
  assert.equal(decision.intent.riskEffect, 'RISK_REDUCING');
});

test('reached thesis target exits and deteriorated depth reduces to an exact target', () => {
  const target = superviseBasisPosition(basisInput({ common: { thesisAssessment: { targetReached: true } } }));
  assert.equal(target.intent.kind, 'REQUEST_EXIT');
  assert.ok(target.intent.why.includes('THESIS_TARGET_REACHED'));
  const depth = superviseBasisPosition(basisInput({ common: { market: { availableDepth: '10' } } }));
  assert.equal(depth.intent.kind, 'REDUCE');
  assert.equal(depth.intent.target.quoteNotional, '100');
});

test('Basis borrow recall and margin survival limits escalate to emergency', () => {
  const recalled = superviseBasisPosition(basisInput({ basis: { borrow: { availability: 'RECALLED' } } }));
  assert.equal(recalled.intent.kind, 'REQUEST_EMERGENCY_UNWIND');
  const margin = superviseBasisPosition(basisInput({ basis: { marginDistance: '0.5' } }));
  assert.equal(margin.intent.kind, 'REQUEST_EMERGENCY_UNWIND');
});

test('Basis exhausted edge or adverse divergence requests exact exit', () => {
  const edge = superviseBasisPosition(basisInput({ basis: { expectedRemainingEdgeAfterExitCosts: '0' } }));
  assert.equal(edge.intent.kind, 'REQUEST_EXIT');
  const divergence = superviseBasisPosition(basisInput({ basis: { currentExecutableBasis: '0.1' } }));
  assert.equal(divergence.intent.kind, 'REQUEST_EXIT');
  assert.notEqual(edge.intent.why[0], divergence.intent.why[0]);
  assert.notEqual(edge.intent.idempotencyKey, divergence.intent.idempotencyKey, 'different evidence/authority must not collapse onto one idempotency key');
  assert.notEqual(edge.decisionKey, divergence.decisionKey, 'different decisions must have different semantic keys');
});

test('Basis hedge drift requests exact risk-reducing hedge', () => {
  const decision = superviseBasisPosition(basisInput({ basis: { hedgeDrift: '0.2' } }));
  assert.equal(decision.intent.kind, 'REQUEST_HEDGE');
  assert.equal(decision.intent.riskEffect, 'RISK_REDUCING');
});

test('Basis liquidity or adverse carry deterioration recommends reduction', () => {
  const liquidity = superviseBasisPosition(basisInput({ basis: { spotLiquidityDeterioration: '0.8' } }));
  assert.equal(liquidity.intent.kind, 'REDUCE');
  assert.equal(liquidity.intent.target.quoteNotional, '100');
  const funding = superviseBasisPosition(basisInput({ basis: { funding: { rate: '0.02' } } }));
  assert.equal(funding.intent.kind, 'REDUCE');
});

test('missing or stale Basis facts freeze increases without inventing facts', () => {
  const missing = superviseBasisPosition(basisInput({ basis: { truth: truth({ requiredValuePresent: false }) } }));
  assert.equal(missing.intent.kind, 'FREEZE_NEW_ACTIONS');
  assert.equal(missing.intent.completeness, 'UNKNOWN');
  assert.ok(missing.intent.blockingFacts.includes('BASIS_FACT_FRESHNESS'));

  const stale = superviseBasisPosition(basisInput({ basis: { truth: truth({ source: { sourceTimeMs: NOW - 10_000 } }) } }));
  assert.equal(stale.intent.kind, 'FREEZE_NEW_ACTIONS');
  assert.equal(stale.intent.completeness, 'STALE');
  assert.ok(stale.intent.blockingFacts.includes('BASIS_FACT_FRESHNESS'));
});

test('Volume supervisor has distinct calibrated continuation/acceleration ADD policy', () => {
  const decision = superviseVolumePosition(volumeInput());
  assert.equal(decision.intent.kind, 'ADD_STAGE');
  assert.equal(decision.intent.riskEffect, 'RISK_INCREASING');
  assert.deepEqual(validatePositionActionIntent(decision.intent), []);
});

test('uncalibrated or validate-only Volume can hold but never add', () => {
  for (const calibrationMode of ['OBSERVE_ONLY', 'VALIDATE_ONLY']) {
    const decision = superviseVolumePosition(volumeInput({ volume: { calibrationMode } }));
    assert.equal(decision.intent.kind, 'HOLD');
    assert.ok(decision.intent.why.includes('VOLUME_CALIBRATION_MODE_FORBIDS_ADD'));
  }
});

test('Volume reversal, wash, and false follow-through request exit', () => {
  const reversal = superviseVolumePosition(volumeInput({ volume: { reversal: signal('PRESENT', '0.9') } }));
  assert.equal(reversal.intent.kind, 'REQUEST_EXIT');
  const wash = superviseVolumePosition(volumeInput({ volume: { washLike: true } }));
  assert.equal(wash.intent.kind, 'REQUEST_EXIT');
  const falseFollow = superviseVolumePosition(volumeInput({ volume: { falseFollowThrough: true } }));
  assert.equal(falseFollow.intent.kind, 'REQUEST_EXIT');
});

test('Volume exhaustion, crowding, perp leadership, and liquidity deterioration reduce', () => {
  const cases = [
    { exhaustion: signal('PRESENT', '0.9') },
    { crowding: signal('PRESENT', '0.9') },
    { leadership: 'PERPETUAL' },
    { liquidityDeterioration: '0.9' },
  ];
  for (const facts of cases) assert.equal(superviseVolumePosition(volumeInput({ volume: facts })).intent.kind, 'REDUCE', JSON.stringify(facts));
});

test('unknown Volume continuation freezes increases instead of fabricating conviction', () => {
  const decision = superviseVolumePosition(volumeInput({ volume: { continuation: signal('UNKNOWN') } }));
  assert.equal(decision.intent.kind, 'FREEZE_NEW_ACTIONS');
  assert.ok(decision.intent.blockingFacts.includes('VOLUME_CONTINUATION'));
});

test('divergent Volume aggregate truth can never emit a risk-increasing intent', () => {
  const decision = superviseVolumePosition(volumeInput({ volume: { truth: truth({ divergent: true }) } }));
  assert.equal(decision.checks.find((item) => item.code === 'VOLUME_FACT_FRESHNESS').status, 'BREACH');
  assert.equal(decision.intent.kind, 'FREEZE_NEW_ACTIONS');
  assert.equal(decision.intent.riskEffect, 'NO_CHANGE');
  assert.equal(decision.intent.completeness, 'DIVERGENT');
});

test('supervision strategy vocabularies are frozen runtime authority surfaces', () => {
  for (const vocabulary of [
    BASIS_FUNDING_DIRECTIONS,
    BASIS_RESOURCE_AVAILABILITIES,
    EXACT_EVIDENCE_SIGNAL_STATES,
    VOLUME_LEADERSHIP_STATES,
    VOLUME_CALIBRATION_MODES,
  ]) {
    assert.equal(Object.isFrozen(vocabulary), true);
    assert.throws(() => vocabulary.push('FORGED_PASS'), TypeError);
  }
});

test('forged Basis funding and resource enum values become UNKNOWN and cannot authorize ADD', () => {
  for (const [code, basis] of [
    ['BASIS_FUNDING', { funding: { direction: 'FORGED_PAID' } }],
    ['BASIS_BORROW', { borrow: { availability: 'FORGED_AVAILABLE' } }],
  ]) {
    const decision = superviseBasisPosition(basisInput({ basis }));
    assert.equal(decision.checks.find((item) => item.code === code)?.status, 'UNKNOWN', code);
    assert.equal(decision.intent.kind, 'FREEZE_NEW_ACTIONS', code);
    assert.equal(decision.intent.riskEffect, 'NO_CHANGE', code);
    assert.equal(decision.intent.stageTransitionAuthorization, null, code);
  }
});

test('forged Volume enum and boolean values become UNKNOWN and cannot authorize ADD', () => {
  const permissiveLeadershipPolicy = volumePolicy();
  permissiveLeadershipPolicy.requireSpotLeadershipForAdd = false;
  permissiveLeadershipPolicy.reduceOnPerpetualLeadership = false;
  bindPolicyRevision(permissiveLeadershipPolicy, deriveVolumeSupervisionPolicyRevision);

  const cases = [
    ['VOLUME_CONTINUATION', { volume: { continuation: signal('FORGED_PRESENT', '0.9') } }],
    ['VOLUME_ACCELERATION', { volume: { acceleration: signal('FORGED_PRESENT', '0.8') } }],
    ['VOLUME_EXHAUSTION', { volume: { exhaustion: signal('FORGED_ABSENT', '0') } }],
    ['VOLUME_LEADERSHIP', { volume: { leadership: 'FORGED_SPOT' }, policy: permissiveLeadershipPolicy }],
    ['VOLUME_FUNDING_CONTEXT', { volume: { funding: signal('FORGED_CONTEXT', '0') } }],
    ['VOLUME_OPEN_INTEREST_CONTEXT', { volume: { openInterest: signal('FORGED_CONTEXT', '0') } }],
    ['VOLUME_FALSE_FOLLOW_THROUGH', { volume: { falseFollowThrough: 0 } }],
    ['VOLUME_WASH_LIKE', { volume: { washLike: 0 } }],
    ['VOLUME_CALIBRATION_MODE', { volume: { calibrationMode: 'FORGED_ARMED' } }],
  ];
  for (const [code, overrides] of cases) {
    const decision = superviseVolumePosition(volumeInput(overrides));
    assert.equal(decision.checks.find((item) => item.code === code)?.status, 'UNKNOWN', code);
    assert.equal(decision.intent.kind, 'FREEZE_NEW_ACTIONS', code);
    assert.equal(decision.intent.riskEffect, 'NO_CHANGE', code);
    assert.equal(decision.intent.stageTransitionAuthorization, null, code);
  }
});

test('Volume policy booleans require actual booleans even with a matching content revision', () => {
  for (const [field, value] of [
    ['requireSpotLeadershipForAdd', 0],
    ['reduceOnPerpetualLeadership', 'false'],
  ]) {
    const policy = volumePolicy();
    policy[field] = value;
    bindPolicyRevision(policy, deriveVolumeSupervisionPolicyRevision);
    const decision = superviseVolumePosition(volumeInput({ policy }));
    assert.equal(decision.checks.find((item) => item.code === 'VOLUME_POLICY')?.status, 'UNKNOWN', field);
    assert.equal(decision.intent.kind, 'FREEZE_NEW_ACTIONS', field);
  }
});

test('enum guards preserve legitimate permissive leadership and valid risk reduction', () => {
  const permissiveLeadershipPolicy = volumePolicy();
  permissiveLeadershipPolicy.requireSpotLeadershipForAdd = false;
  permissiveLeadershipPolicy.reduceOnPerpetualLeadership = false;
  bindPolicyRevision(permissiveLeadershipPolicy, deriveVolumeSupervisionPolicyRevision);
  assert.equal(superviseVolumePosition(volumeInput({
    volume: { leadership: 'MIXED' },
    policy: permissiveLeadershipPolicy,
  })).intent.kind, 'ADD_STAGE');

  const basisReduction = superviseBasisPosition(basisInput({
    basis: { funding: { direction: 'FORGED_PAID' }, marginDistance: '0.5' },
  }));
  assert.equal(basisReduction.intent.kind, 'REQUEST_EMERGENCY_UNWIND');
  assert.equal(basisReduction.intent.riskEffect, 'RISK_REDUCING');

  const volumeReduction = superviseVolumePosition(volumeInput({
    volume: { washLike: 0, reversal: signal('PRESENT', '0.9') },
  }));
  assert.equal(volumeReduction.intent.kind, 'REQUEST_EXIT');
  assert.equal(volumeReduction.intent.riskEffect, 'RISK_REDUCING');
});

test('maximum thesis horizon requests exit for both policies', () => {
  for (const strategy of ['BASIS', 'VOLUME']) {
    const position = projectedPosition(strategy, { thesis: thesis(strategy, { expectedHorizonMs: 1_000, maximumHoldingHorizonMs: 5_000 }) });
    const decision = strategy === 'BASIS' ? superviseBasisPosition(basisInput({ position })) : superviseVolumePosition(volumeInput({ position }));
    assert.equal(decision.intent.kind, 'REQUEST_EXIT');
    assert.ok(decision.intent.why.includes('MAXIMUM_HOLDING_HORIZON'));
  }
});

test('outstanding intent cap freezes duplicate action generation', () => {
  const position = projectedPosition('BASIS', { outstandingActionIntentIds: ['i1', 'i2', 'i3'] });
  const decision = superviseBasisPosition(basisInput({ position }));
  assert.equal(decision.intent.kind, 'FREEZE_NEW_ACTIONS');
  assert.ok(decision.intent.why.includes('OUTSTANDING_INTENT_LIMIT'));
});

test('expired policy fails closed and cannot authorize ADD', () => {
  const policy = commonPolicy();
  policy.authority = { ...policy.authority, effectiveUntilMs: NOW };
  const decision = superviseBasisPosition(basisInput({ common: { policy } }));
  assert.equal(decision.intent.kind, 'FREEZE_NEW_ACTIONS');
  assert.ok(decision.intent.blockingFacts.includes('POLICY_AUTHORITY'));
});

test('cached FRESH common, account, thesis, market, cost, and control truth is re-aged from source time', () => {
  const old = forgedCachedFreshButOld('forged-old-common');
  const baseline = projectedPosition('BASIS');
  const cases = [
    ['POSITION_TRUTH', { position: { ...baseline, truth: old } }],
    ['LEG_FRESHNESS', { position: { ...baseline, legs: [{ ...baseline.legs[0], truth: old }, baseline.legs[1]] } }],
    ['EXECUTION_REFERENCE', { position: { ...baseline, executionReference: { ...baseline.executionReference, truth: old } } }],
    ['RECONCILIATION', { position: { ...baseline, reconciliationReference: { ...baseline.reconciliationReference, truth: old } } }],
    ['MARKET_FRESHNESS', { common: { market: { truth: old } } }],
    ['CURRENT_AND_PROJECTED_COST', { common: { costs: { truth: old } } }],
    ['THESIS_TRUTH', { common: { thesisAssessment: { truth: old } } }],
    ['CONTROL_POSTURE', { common: { controlPosture: { truth: old } } }],
  ];
  for (const [code, overrides] of cases) {
    const decision = superviseBasisPosition(basisInput(overrides));
    assert.notEqual(decision.intent.kind, 'ADD_STAGE', `${code} cached FRESH must not authorize ADD`);
    assert.notEqual(decision.checks.find((item) => item.code === code)?.status, 'PASS', `${code} must be re-aged`);
  }
});

test('cached FRESH Basis aggregate, path, funding, and borrow truth is re-aged before ADD', () => {
  const old = forgedCachedFreshButOld('forged-old-basis');
  const cases = [
    ['BASIS_FACT_FRESHNESS', { truth: old }],
    ['BASIS_PATH', { convergencePath: basisFacts().convergencePath.map((item, index) => index === 1 ? { ...item, truth: old } : item) }],
    ['BASIS_FUNDING', { funding: { truth: old } }],
    ['BASIS_BORROW', { borrow: { truth: old } }],
  ];
  for (const [code, basis] of cases) {
    const decision = superviseBasisPosition(basisInput({ basis }));
    assert.notEqual(decision.intent.kind, 'ADD_STAGE', `${code} cached FRESH must not authorize ADD`);
    assert.notEqual(decision.checks.find((item) => item.code === code)?.status, 'PASS', `${code} must be re-aged`);
  }
});

test('cached FRESH Volume aggregate, calibration, and every nested signal truth is re-aged before ADD', () => {
  const old = forgedCachedFreshButOld('forged-old-volume');
  const cases = [
    ['VOLUME_FACT_FRESHNESS', { truth: old }],
    ['VOLUME_CALIBRATION_MODE', { calibrationTruth: old }],
    ['VOLUME_CONTINUATION', { continuation: signal('PRESENT', '0.9', { truth: old }) }],
    ['VOLUME_ACCELERATION', { acceleration: signal('PRESENT', '0.8', { truth: old }) }],
    ['VOLUME_EXHAUSTION', { exhaustion: signal('ABSENT', '0', { truth: old }) }],
    ['VOLUME_REVERSAL', { reversal: signal('ABSENT', '0', { truth: old }) }],
    ['VOLUME_CROWDING', { crowding: signal('ABSENT', '0', { truth: old }) }],
    ['VOLUME_FUNDING_CONTEXT', { funding: signal('UNKNOWN', null, { truth: old }) }],
    ['VOLUME_OPEN_INTEREST_CONTEXT', { openInterest: signal('UNKNOWN', null, { truth: old }) }],
  ];
  for (const [code, volume] of cases) {
    const decision = superviseVolumePosition(volumeInput({ volume }));
    assert.notEqual(decision.intent.kind, 'ADD_STAGE', `${code} cached FRESH must not authorize ADD`);
    assert.notEqual(decision.checks.find((item) => item.code === code)?.status, 'PASS', `${code} must be re-aged`);
  }
});

test('common policy rejects hostile decimals, units, timings, content drift, and valuation mismatch', () => {
  const hostilePolicies = [];
  for (const mutate of [
    (policy) => { policy.targetHedgeRatio = { ...policy.targetHedgeRatio, unit: 'USDT' }; },
    (policy) => { policy.maximumOneLegExposure = { ...policy.maximumOneLegExposure, unit: SUPERVISION_RATIO_UNIT }; },
    (policy) => { policy.maximumTotalGrossExposure = { ...policy.maximumTotalGrossExposure, value: '-1' }; },
    (policy) => { policy.maximumProjectedExitCost = { ...policy.maximumProjectedExitCost, value: '01' }; },
    (policy) => { policy.minimumExitCapacity = { ...policy.minimumExitCapacity, value: 'not-a-decimal' }; },
    (policy) => { policy.maximumOneLegDurationMs = { ...policy.maximumOneLegDurationMs, unit: SUPERVISION_COUNT_UNIT }; },
    (policy) => { policy.maximumOutstandingIntents = { ...policy.maximumOutstandingIntents, value: Number.MAX_SAFE_INTEGER + 1 }; },
    (policy) => { policy.reductionTargetExposure = { ...policy.reductionTargetExposure, minimum: '20', maximum: '10' }; },
  ]) {
    const policy = commonPolicy();
    mutate(policy);
    hostilePolicies.push(bindPolicyRevision(policy, deriveCommonSupervisionPolicyRevision));
  }
  const contentDrift = commonPolicy();
  contentDrift.maximumTotalGrossExposure = { ...contentDrift.maximumTotalGrossExposure, value: '9999' };
  hostilePolicies.push(contentDrift);
  for (const policy of hostilePolicies) {
    const decision = superviseBasisPosition(basisInput({ common: { policy } }));
    assert.notEqual(decision.intent.kind, 'ADD_STAGE');
    assert.equal(decision.checks.find((item) => item.code === 'POLICY_AUTHORITY').status, 'UNKNOWN');
  }

  const position = projectedPosition('BASIS');
  const wrongAssetPosition = { ...position, legs: position.legs.map((leg) => ({ ...leg, valuationAsset: 'USDC' })) };
  const wrongAsset = superviseBasisPosition(basisInput({ position: wrongAssetPosition }));
  assert.notEqual(wrongAsset.intent.kind, 'ADD_STAGE');
  assert.equal(wrongAsset.checks.find((item) => item.code === 'VALUATION_ASSET_BINDING').status, 'UNKNOWN');
});

test('Basis and Volume policies reject wrong-unit, negative, malformed, and content-drift bounds', () => {
  const badBasisPolicies = [];
  for (const mutate of [
    (policy) => { policy.maximumBorrowRate = { ...policy.maximumBorrowRate, unit: 'USDT' }; },
    (policy) => { policy.maximumHedgeDrift = { ...policy.maximumHedgeDrift, value: '-0.1' }; },
    (policy) => { policy.maximumLiquidityDeterioration = { ...policy.maximumLiquidityDeterioration, value: '1e2' }; },
    (policy) => { policy.requiredConvergingObservationsForAdd = { ...policy.requiredConvergingObservationsForAdd, unit: SUPERVISION_MILLISECONDS_UNIT }; },
  ]) {
    const policy = basisPolicy();
    mutate(policy);
    badBasisPolicies.push(bindPolicyRevision(policy, deriveBasisSupervisionPolicyRevision));
  }
  const driftedBasis = basisPolicy();
  driftedBasis.maximumAdverseBasisMove = { ...driftedBasis.maximumAdverseBasisMove, value: '0.9' };
  badBasisPolicies.push(driftedBasis);
  for (const policy of badBasisPolicies) {
    const decision = superviseBasisPosition(basisInput({ policy }));
    assert.notEqual(decision.intent.kind, 'ADD_STAGE');
    assert.equal(decision.checks.find((item) => item.code === 'BASIS_POLICY').status, 'UNKNOWN');
  }

  const badVolumePolicies = [];
  for (const mutate of [
    (policy) => { policy.minimumContinuationStrength = { ...policy.minimumContinuationStrength, unit: 'USDT' }; },
    (policy) => { policy.maximumCrowdingStrength = { ...policy.maximumCrowdingStrength, value: '-0.1' }; },
    (policy) => { policy.maximumReversalStrength = { ...policy.maximumReversalStrength, value: 'NaN' }; },
  ]) {
    const policy = volumePolicy();
    mutate(policy);
    badVolumePolicies.push(bindPolicyRevision(policy, deriveVolumeSupervisionPolicyRevision));
  }
  const driftedVolume = volumePolicy();
  driftedVolume.maximumExhaustionStrength = { ...driftedVolume.maximumExhaustionStrength, value: '0.99' };
  badVolumePolicies.push(driftedVolume);
  for (const policy of badVolumePolicies) {
    const decision = superviseVolumePosition(volumeInput({ policy }));
    assert.notEqual(decision.intent.kind, 'ADD_STAGE');
    assert.equal(decision.checks.find((item) => item.code === 'VOLUME_POLICY').status, 'UNKNOWN');
  }
});

test('ADD requires same-clock stages authorization bound to the incumbent plan, reservation, approval, and gates', () => {
  const hostile = [
    stageTransitionAuthorization({ evaluatedAtMs: NOW - 1 }),
    stageTransitionAuthorization({ planDigest: 'other-plan-digest' }),
    stageTransitionAuthorization({ reservationRevision: 99 }),
    stageTransitionAuthorization({ approvalId: 'other-approval' }),
    stageTransitionAuthorization({ requiredFutureGates: ['MULTI_LEG_RISK'] }),
    stageTransitionAuthorization({ reservationConsumption: '0100' }),
    {
      maximumAdditionalExposure: '100',
      maximumTotalExposure: '300',
      evidenceFresh: true,
      reservationAvailable: true,
      approvalCurrent: true,
      futureRiskRecheckRequired: true,
    },
  ];
  for (const nextStageAuthority of hostile) {
    const decision = superviseBasisPosition(basisInput({ common: { nextStageAuthority } }));
    assert.notEqual(decision.intent.kind, 'ADD_STAGE');
    assert.equal(decision.checks.find((item) => item.code === 'NEXT_STAGE_AUTHORITY').status, 'BREACH');
  }
  const bindingMismatch = superviseBasisPosition(basisInput({ common: {
    activeStageAuthority: { ...activeStageAuthority(), planRevision: 4 },
  } }));
  assert.notEqual(bindingMismatch.intent.kind, 'ADD_STAGE');
  assert.equal(bindingMismatch.checks.find((item) => item.code === 'NEXT_STAGE_AUTHORITY').status, 'BREACH');
});

test('stale truth blocks increases without hiding hedge, exit, or emergency recovery', () => {
  const old = forgedCachedFreshButOld('forged-old-recovery');
  const oneLeg = projectedPosition('BASIS', { legs: [leg('spot', 'LONG')], executionLifecycle: 'ONE_LEG_EXPOSED', oneLegSinceMs: NOW - 500 });
  const hedge = superviseBasisPosition(basisInput({ position: { ...oneLeg, truth: old } }));
  assert.equal(hedge.intent.kind, 'REQUEST_HEDGE');
  const exit = superviseBasisPosition(basisInput({ common: { thesisAssessment: { invalidated: true, truth: old } } }));
  assert.equal(exit.intent.kind, 'REQUEST_EXIT');
  const emergency = superviseBasisPosition(basisInput({ basis: { borrow: { availability: 'RECALLED', truth: old } } }));
  assert.equal(emergency.intent.kind, 'REQUEST_EMERGENCY_UNWIND');
});

test('invalid source identity or revision is rejected instead of being laundered into an intent', () => {
  const baseline = projectedPosition('BASIS');
  const rejectedPositions = [
    ['zero position revision', { ...baseline, revision: 0 }],
    ['fractional thesis revision', { ...baseline, thesis: { ...baseline.thesis, revision: 1.5 } }],
    ['non-canonical position ID', { ...baseline, id: ` ${baseline.id}` }],
    ['non-canonical thesis ID', { ...baseline, thesis: { ...baseline.thesis, id: ` ${baseline.thesis.id}` } }],
  ];
  for (const [label, position] of rejectedPositions) {
    assert.throws(
      () => superviseBasisPosition(basisInput({ position })),
      /supervision source binding invalid/,
      label,
    );
  }
});

test('malformed position state and adjacent projection facts fail closed without ADD or HOLD authority', () => {
  const baseline = projectedPosition('BASIS');
  const hostilePositions = [
    ['unknown position state', { ...baseline, state: 'FORGED_ACTIVE' }],
    ['unknown capital lifecycle', { ...baseline, capitalLifecycle: 'FORGED_ACTIVE' }],
    ['known but inconsistent lifecycle', { ...baseline, capitalLifecycle: 'READY_FOR_EXECUTION' }],
    ['non-canonical mandate ID', { ...baseline, mandateId: `${baseline.mandateId} ` }],
    ['missing proposal ID', { ...baseline, thesis: { ...baseline.thesis, proposalId: '' } }],
    ['future position open', { ...baseline, openedAtMs: NOW + 1 }],
    ['transition before position open', { ...baseline, lastTransitionAtMs: baseline.openedAtMs - 1 }],
    ['future one-leg timestamp', { ...baseline, oneLegSinceMs: NOW + 1 }],
    ['future thesis open', { ...baseline, thesis: { ...baseline.thesis, openedAtMs: NOW + 1 } }],
    ['invalid thesis horizons', { ...baseline, thesis: { ...baseline.thesis, expectedHorizonMs: 0, maximumHoldingHorizonMs: -1 } }],
    ['non-canonical thesis config revision', { ...baseline, thesis: { ...baseline.thesis, configRevision: ' strategy-cfg-1' } }],
  ];

  for (const [label, position] of hostilePositions) {
    const decision = superviseBasisPosition(basisInput({ position }));
    assert.equal(decision.intent.kind, 'NO_ACTION_UNKNOWN', label);
    assert.equal(decision.intent.riskEffect, 'NO_CHANGE', label);
    assert.equal(decision.intent.target.kind, 'UNKNOWN', label);
    assert.equal(decision.intent.stageTransitionAuthorization, null, label);
    assert.deepEqual(decision.intent.requiredFutureGates, [], label);
    assert.equal(decision.intent.sourcePositionRevision, baseline.revision, label);
    assert.equal(decision.intent.sourceThesisRevision, baseline.thesis.revision, label);
    assert.ok(decision.intent.why.includes('POSITION_PROJECTION_INVALID'), label);
    assert.ok(decision.intent.blockingFacts.includes('POSITION_BOUNDARY'), label);
    assert.equal(decision.checks.find((item) => item.code === 'POSITION_BOUNDARY')?.status, 'UNKNOWN', label);
  }
});

test('valid projector output still represents risk reduction for exposed capital', () => {
  const projected = projectedPosition('BASIS');
  const decision = superviseBasisPosition(basisInput({
    position: projected,
    common: { market: { availableDepth: '10' } },
  }));
  assert.equal(decision.checks.some((item) => item.code === 'POSITION_BOUNDARY'), false);
  assert.equal(decision.intent.kind, 'REDUCE');
  assert.equal(decision.intent.riskEffect, 'RISK_REDUCING');
  assert.equal(decision.intent.target.kind, 'TOTAL');
  assert.equal(decision.intent.target.quoteNotional, '100');
});

test('malformed common position geometry becomes typed unknown instead of crashing supervision', () => {
  const baseline = projectedPosition('BASIS');
  const hostilePositions = [
    { ...baseline, totalGrossExposure: 'not-decimal' },
    { ...baseline, netDirectionalExposure: 'NaN' },
    { ...baseline, hedgeRatio: '01' },
    { ...baseline, oneLegExposure: '-1' },
    { ...baseline, legs: [{ ...baseline.legs[0], quoteExposure: 'not-decimal' }, baseline.legs[1]] },
    { ...baseline, legs: [{ ...baseline.legs[0], quantity: '-1' }, baseline.legs[1]] },
    { ...baseline, totalGrossExposure: '201' },
  ];
  for (const position of hostilePositions) {
    const decision = superviseBasisPosition(basisInput({ position }));
    assert.equal(decision.intent.kind, 'NO_ACTION_UNKNOWN');
    assert.equal(decision.intent.target.kind, 'UNKNOWN');
    assert.equal(decision.intent.stageTransitionAuthorization, null);
    assert.equal(decision.checks.find((item) => item.code === 'POSITION_BOUNDARY')?.status, 'UNKNOWN');
  }
});

test('malformed common market, cost, thesis, control, and action-cost facts freeze safely', () => {
  const candidates = [];
  for (const [field, value] of [
    ['executableSpreadCost', 'not-decimal'],
    ['availableDepth', '-1'],
    ['exitCapacity', '01'],
    ['projectedExitCost', 'NaN'],
  ]) candidates.push(basisInput({ common: { market: { [field]: value } } }));
  candidates.push(basisInput({ common: { market: { truth: { completeness: 'COMPLETE' } } } }));
  candidates.push(basisInput({ common: { costs: { accruedKnownCost: 'not-decimal' } } }));
  candidates.push(basisInput({ common: { costs: { projectedAdditionalCost: '-1' } } }));
  candidates.push(basisInput({ common: { thesisAssessment: { invalidated: 'false' } } }));
  candidates.push(basisInput({ common: { thesisAssessment: { targetReached: 0 } } }));
  candidates.push(basisInput({ common: { thesisAssessment: { supportingEvidenceIds: [' padded-evidence'] } } }));
  candidates.push(basisInput({ common: { controlPosture: { posture: 'FORGED_OPEN' } } }));
  const malformedWaitCost = basisInput();
  malformedWaitCost.common.economicCostOfWaiting = 'not-decimal';
  candidates.push(malformedWaitCost);
  const malformedActCost = basisInput();
  malformedActCost.common.expectedCostOfActing = '-1';
  candidates.push(malformedActCost);
  const malformedExpectedLegs = basisInput();
  malformedExpectedLegs.common.expectedLegs = [{ instrumentId: 'spot', side: 'SIDEWAYS' }];
  candidates.push(malformedExpectedLegs);

  for (const candidate of candidates) {
    const decision = superviseBasisPosition(candidate);
    assert.equal(decision.intent.kind, 'FREEZE_NEW_ACTIONS');
    assert.equal(decision.intent.riskEffect, 'NO_CHANGE');
    assert.equal(decision.intent.stageTransitionAuthorization, null);
    if (candidate.common.economicCostOfWaiting === 'not-decimal') assert.equal(decision.intent.economicCostOfWaiting, null);
    if (candidate.common.expectedCostOfActing === '-1') assert.equal(decision.intent.expectedCostOfActing, null);
  }
});

test('malformed noncritical facts do not suppress a separately proven urgent reduction', () => {
  const exit = superviseBasisPosition(basisInput({ common: {
    market: { executableSpreadCost: 'not-decimal' },
    thesisAssessment: { invalidated: true },
  } }));
  assert.equal(exit.intent.kind, 'REQUEST_EXIT');
  assert.equal(exit.intent.riskEffect, 'RISK_REDUCING');
  assert.equal(exit.intent.stageTransitionAuthorization, null);

  const reduce = superviseBasisPosition(basisInput({ common: {
    market: { executableSpreadCost: 'not-decimal', availableDepth: '10' },
  } }));
  assert.equal(reduce.intent.kind, 'REDUCE');
  assert.equal(reduce.intent.riskEffect, 'RISK_REDUCING');
});

test('supervision module exposes decisions only and no execution methods', async () => {
  const mod = await import('../../../dist/capitalFoundation/supervision/index.js');
  assert.equal(typeof mod.superviseBasisPosition, 'function');
  assert.equal(typeof mod.superviseVolumePosition, 'function');
  assert.deepEqual(Object.keys(mod).filter((name) => /execute|order|borrow|repay|fetch|riskgate/i.test(name)), []);
});
