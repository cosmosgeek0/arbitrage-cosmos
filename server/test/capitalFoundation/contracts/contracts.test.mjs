import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPITAL_LIFECYCLE_STATES,
  CAPITAL_TRUTH_STATES,
  ECONOMIC_COMPONENT_KINDS,
  POSITION_ACTION_INTENTS,
  absoluteExactDecimal,
  actionRiskEffect,
  addExactDecimals,
  asStrategyProposalId,
  assessCapitalTruth,
  canTransitionCapitalLifecycle,
  canTransitionCapitalStage,
  capitalDigest,
  compareExactDecimals,
  deriveActionIntentId,
  deriveActivePositionId,
  deriveAllocationDecisionId,
  deriveCapitalCheckpointId,
  deriveCapitalCorrelation,
  deriveCapitalConfigRevision,
  deriveCapitalMandateId,
  deriveCapitalReservationId,
  deriveExecutionCorrelationReferenceId,
  deriveOpportunityConsiderationId,
  deriveOperatorApprovalId,
  derivePositionThesisId,
  deriveReconciliationReferenceId,
  deriveStagedPlanId,
  divideExactDecimals,
  isExactDecimal,
  multiplyExactDecimals,
  negateExactDecimal,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  policyBoundIsValid,
  postureAllowsRiskIncrease,
  projectFoundationRiskVerdict,
  subtractExactDecimals,
  sumExactDecimals,
  truthAllowsNewExposure,
  transitionCapitalLifecycle,
  transitionCapitalStage,
  validateCapitalJsonValue,
  validateEconomicAttribution,
  validateEconomicComponent,
  validatePositionActionIntent,
  weakestCapitalTruth,
} from '../../../dist/capitalFoundation/contracts/index.js';
import * as decimalSurface from '../../../dist/capitalFoundation/contracts/decimal.js';
import {
  canonicalJson,
  deriveRiskVerdict,
} from '../../../dist/foundation/contracts/index.js';

const NOW = 1_800_000_000_000;

function source(overrides = {}) {
  return {
    sourceTimeMs: NOW - 100,
    receivedAtMs: NOW - 90,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId: 'capital.contract.test',
    ...overrides,
  };
}

function component(overrides = {}) {
  return {
    id: 'economic-1',
    kind: 'TRADING_COMMISSIONS',
    status: 'KNOWN',
    amount: '-1.25',
    estimateRange: null,
    valuationAsset: 'USDT',
    observedAtMs: NOW,
    sourceIds: ['fill-1'],
    reasonCodes: [],
    strategy: 'BASIS',
    opportunityId: 'opportunity-1',
    configRevision: 'cfg-test',
    stage: 'PROBE',
    symbol: 'BTCUSDT',
    legId: 'spot',
    correlationId: 'cor-test',
    ...overrides,
  };
}

test('exact decimal canonicalization rejects exponent, padding, and non-string financial values', () => {
  assert.equal(normalizeExactDecimal('+00012.3400'), '12.34');
  assert.equal(normalizeExactDecimal('-000.000'), '0');
  assert.throws(() => normalizeExactDecimal('1e-8'), /plain base-10/);
  assert.throws(() => normalizeExactDecimal(' 1'), /unpadded/);
  assert.throws(() => normalizeExactDecimal(1), /string/);
  assert.equal(isExactDecimal('0.0001'), true);
  assert.equal(isExactDecimal('NaN'), false);
});

test('exact decimal signed add/subtract/multiply are algebraically exact', () => {
  assert.equal(addExactDecimals('9007199254740993.01', '0.99'), '9007199254740994');
  assert.equal(subtractExactDecimals('0.1', '0.3'), '-0.2');
  assert.equal(multiplyExactDecimals('-12.5', '0.08'), '-1');
  assert.equal(sumExactDecimals(['0.1', '0.2', '-0.3', '100000000000000000000']), '100000000000000000000');
});

test('exact decimal division has explicit conservative truncation', () => {
  assert.equal(divideExactDecimals('1', '3', 8), '0.33333333');
  assert.equal(divideExactDecimals('10', '4', 0), '2');
  assert.equal(divideExactDecimals('-2', '3', 4), '-0.6666');
  assert.throws(() => divideExactDecimals('1', '0', 8), /division by zero/);
});

test('exact decimal division permits bounded internal scale beyond the public digit bound', () => {
  const oneE74 = `0.${'0'.repeat(73)}1`;
  const oneE95 = `0.${'0'.repeat(94)}1`;
  assert.equal(divideExactDecimals('1', oneE74, 24), `1${'0'.repeat(74)}`);
  assert.equal(divideExactDecimals('1', oneE95, 24), `1${'0'.repeat(95)}`);
});

test('exact decimal division still rejects a final result beyond 96 digits', () => {
  assert.throws(
    () => divideExactDecimals(`1${'0'.repeat(95)}`, '0.1', 24),
    /exact decimal exceeds 96 digits/,
  );
});

test('exact decimal runtime public surface and bounds remain frozen', () => {
  assert.deepEqual(Object.keys(decimalSurface).sort(), [
    'MAX_DIVISION_SCALE',
    'MAX_EXACT_DECIMAL_DIGITS',
    'absoluteExactDecimal',
    'addExactDecimals',
    'compareExactDecimals',
    'divideExactDecimals',
    'isExactDecimal',
    'isExactNegative',
    'isExactPositive',
    'isExactZero',
    'maximumExactDecimal',
    'minimumExactDecimal',
    'multiplyExactDecimals',
    'negateExactDecimal',
    'normalizeExactDecimal',
    'normalizeNonNegativeExactDecimal',
    'subtractExactDecimals',
    'sumExactDecimals',
  ]);
  assert.equal(decimalSurface.MAX_EXACT_DECIMAL_DIGITS, 96);
  assert.equal(decimalSurface.MAX_DIVISION_SCALE, 24);
});

test('exact decimal comparison is numeric rather than lexicographic', () => {
  assert.equal(compareExactDecimals('10', '9'), 1);
  assert.equal(compareExactDecimals('-10', '-9'), -1);
  assert.equal(compareExactDecimals('1.000', '1'), 0);
  assert.equal(negateExactDecimal('-5.2'), '5.2');
  assert.equal(absoluteExactDecimal('-5.2'), '5.2');
  assert.throws(() => normalizeNonNegativeExactDecimal('-0.01'), /non-negative/);
});

test('all required branded capital identities derive deterministically', () => {
  const input = { proposalId: 'bp_1', revision: 2, nowMs: NOW };
  const ids = [
    deriveOpportunityConsiderationId(input),
    deriveCapitalMandateId(input),
    deriveAllocationDecisionId(input),
    deriveCapitalReservationId(input),
    deriveStagedPlanId(input),
    deriveOperatorApprovalId(input),
    derivePositionThesisId(input),
    deriveActivePositionId(input),
    deriveActionIntentId(input),
    deriveExecutionCorrelationReferenceId(input),
    deriveReconciliationReferenceId(input),
    deriveCapitalCheckpointId(input),
  ];
  assert.equal(new Set(ids).size, ids.length, 'identity namespaces must not collide');
  assert.deepEqual(ids, [
    deriveOpportunityConsiderationId(input),
    deriveCapitalMandateId(input),
    deriveAllocationDecisionId(input),
    deriveCapitalReservationId(input),
    deriveStagedPlanId(input),
    deriveOperatorApprovalId(input),
    derivePositionThesisId(input),
    deriveActivePositionId(input),
    deriveActionIntentId(input),
    deriveExecutionCorrelationReferenceId(input),
    deriveReconciliationReferenceId(input),
    deriveCapitalCheckpointId(input),
  ]);
});

test('canonical identity and digest ignore object insertion order but preserve array order', () => {
  assert.equal(capitalDigest({ b: 2, a: 1 }), capitalDigest({ a: 1, b: 2 }));
  assert.notEqual(capitalDigest({ a: [1, 2] }), capitalDigest({ a: [2, 1] }));
  assert.equal(deriveCapitalConfigRevision('budget', { max: '10', min: '1' }), deriveCapitalConfigRevision('budget', { min: '1', max: '10' }));
});

test('capital identity and transition correlation boundaries reject whitespace aliases', () => {
  assert.equal(asStrategyProposalId('proposal:lowercase:1'), 'proposal:lowercase:1');
  assert.throws(() => asStrategyProposalId(' proposal:lowercase:1'), /canonical non-empty/);
  assert.equal(typeof deriveCapitalCorrelation('contracts', 'lowercase:key:1'), 'string');
  assert.throws(() => deriveCapitalCorrelation(' contracts', 'lowercase:key:1'), /canonical non-empty/);
  assert.throws(() => deriveCapitalCorrelation('contracts', 'lowercase:key:1 '), /canonical non-empty/);
  assert.throws(() => transitionCapitalLifecycle('OBSERVED', 'ELIGIBLE', {
    nowMs: NOW,
    correlationId: ' lifecycle:alias',
  }), /correlation ID/);
  assert.throws(() => transitionCapitalStage('OBSERVE', 'PROBE', {
    nowMs: NOW,
    correlationId: 'stage:alias ',
    adversePriceMoveIsSoleReason: false,
    approvalValidated: false,
    freshEvidence: true,
    reservationAvailable: true,
    futureRiskRecheckRequired: true,
  }), /correlation ID/);
});

test('fresh complete source truth permits new exposure', () => {
  const truth = assessCapitalTruth({ source: source(), evaluatedAtMs: NOW, requiredValuePresent: true });
  assert.equal(truth.completeness, 'COMPLETE');
  assert.equal(truthAllowsNewExposure(truth), true);
  assert.equal(truth.freshness.state, 'FRESH');
});

test('partial source truth remains partial and blocks new exposure', () => {
  const truth = assessCapitalTruth({ source: source({ completeness: 'PARTIAL' }), evaluatedAtMs: NOW, requiredValuePresent: true });
  assert.equal(truth.completeness, 'PARTIAL');
  assert.equal(truthAllowsNewExposure(truth), false);
});

test('stale source truth remains stale and blocks new exposure', () => {
  const truth = assessCapitalTruth({ source: source({ sourceTimeMs: NOW - 1_001 }), evaluatedAtMs: NOW, requiredValuePresent: true });
  assert.equal(truth.completeness, 'STALE');
  assert.equal(truthAllowsNewExposure(truth), false);
});

test('missing and divergent truth never become zero or complete', () => {
  const missing = assessCapitalTruth({ source: source(), evaluatedAtMs: NOW, requiredValuePresent: false });
  const divergent = assessCapitalTruth({ source: source(), evaluatedAtMs: NOW, requiredValuePresent: true, divergent: true });
  assert.equal(missing.completeness, 'UNKNOWN');
  assert.equal(divergent.completeness, 'DIVERGENT');
  assert.equal(weakestCapitalTruth(['COMPLETE', 'PARTIAL', 'STALE', 'UNKNOWN', 'DIVERGENT']), 'DIVERGENT');
});

test('capital truth vocabulary is complete and ordered for conservative aggregation', () => {
  assert.deepEqual(CAPITAL_TRUTH_STATES, ['COMPLETE', 'PARTIAL', 'STALE', 'UNKNOWN', 'DIVERGENT']);
  assert.throws(() => weakestCapitalTruth([]), /at least one/);
});

test('capital lifecycle contains every required state and blocks illegal jumps', () => {
  for (const required of ['OBSERVED', 'ELIGIBLE', 'RESERVED', 'AWAITING_APPROVAL', 'AWAITING_RISK', 'READY_FOR_EXECUTION', 'PARTIALLY_EXPOSED', 'RECOVERY_REQUIRED', 'CLOSED', 'UNKNOWN']) {
    assert.ok(CAPITAL_LIFECYCLE_STATES.includes(required), `missing lifecycle state ${required}`);
  }
  assert.equal(canTransitionCapitalLifecycle('OBSERVED', 'ELIGIBLE'), true);
  assert.equal(canTransitionCapitalLifecycle('OBSERVED', 'ACTIVE'), false);
  assert.equal(canTransitionCapitalLifecycle('RECOVERY_REQUIRED', 'EXITING'), true);
  assert.equal(canTransitionCapitalLifecycle('CLOSED', 'ACTIVE'), false);
});

test('stage transitions require ordered exposure authority and allow explicit risk reduction', () => {
  assert.equal(canTransitionCapitalStage('OBSERVE', 'PROBE'), true);
  assert.equal(canTransitionCapitalStage('OBSERVE', 'ADD'), false);
  assert.equal(canTransitionCapitalStage('CONFIRM', 'ADD'), true);
  assert.equal(canTransitionCapitalStage('PROBE', 'EXIT'), true);
  assert.equal(canTransitionCapitalStage('EXIT', 'HOLD'), false);
});

test('typed lifecycle transition rejects approval bypass and validate-only execution readiness', () => {
  const base = {
    nowMs: NOW,
    correlationId: 'cor-transition',
  };
  const skip = transitionCapitalLifecycle('PLANNED', 'AWAITING_RISK', base);
  assert.equal(skip.ok, false);
  assert.equal(skip.failure.code, 'ILLEGAL_CAPITAL_LIFECYCLE_TRANSITION');
  const awaitingRisk = transitionCapitalLifecycle('AWAITING_APPROVAL', 'AWAITING_RISK', base);
  assert.equal(awaitingRisk.ok, false);
  assert.equal(awaitingRisk.failure.code, 'APPROVAL_LANE_TRANSITION_REQUIRED');
  const ready = transitionCapitalLifecycle('AWAITING_RISK', 'READY_FOR_EXECUTION', base);
  assert.equal(ready.ok, false);
  assert.equal(ready.failure.code, 'FOUNDATION_EXECUTION_TRANSITION_REQUIRED');
  const local = transitionCapitalLifecycle('OBSERVED', 'ELIGIBLE', base);
  assert.equal(local.ok, true);
  assert.equal(local.value.authority, 'NONE');
  assert.equal(local.value.executionReady, false);
  assert.deepEqual(Object.keys(local.value).sort(), [
    'authority', 'correlationId', 'executionReady', 'from', 'to', 'transitionedAtMs',
  ]);
});

test('typed stage transition rejects averaging down and missing ADD authority', () => {
  const base = {
    nowMs: NOW,
    correlationId: 'cor-stage',
    freshEvidence: true,
    reservationAvailable: true,
    approvalValidated: true,
    futureRiskRecheckRequired: true,
    adversePriceMoveIsSoleReason: false,
  };
  const averagingDown = transitionCapitalStage('CONFIRM', 'ADD', { ...base, adversePriceMoveIsSoleReason: true });
  assert.equal(averagingDown.ok, false);
  assert.equal(averagingDown.failure.code, 'AVERAGING_DOWN_FORBIDDEN');
  const stale = transitionCapitalStage('CONFIRM', 'ADD', { ...base, freshEvidence: false });
  assert.equal(stale.ok, false);
  assert.equal(stale.failure.code, 'FRESH_EVIDENCE_REQUIRED');
  const callerAsserted = transitionCapitalStage('CONFIRM', 'ADD', base);
  assert.equal(callerAsserted.ok, true);
  assert.equal(callerAsserted.value.authority, 'NONE');
  assert.equal(callerAsserted.value.executionReady, false);
  assert.deepEqual(Object.keys(callerAsserted.value).sort(), [
    'authority', 'correlationId', 'executionReady', 'from', 'to', 'transitionedAtMs',
  ]);
  assert.equal(transitionCapitalStage('CONFIRM', 'REDUCE', { ...base, freshEvidence: false }).ok, true);
});

test('economic component vocabulary includes every required attribution family', () => {
  for (const required of ['MARK_TO_MARKET_LEG_PNL', 'REALIZED_LEG_PNL', 'BASIS_CONVERGENCE_DIVERGENCE', 'DIRECTIONAL_CONTRIBUTION', 'FUNDING', 'BORROW_INTEREST_AND_FEES', 'TRADING_COMMISSIONS', 'ENTRY_SPREAD_COST', 'EXIT_SPREAD_COST', 'ESTIMATED_SLIPPAGE', 'REALIZED_SLIPPAGE', 'EXECUTION_SHORTFALL', 'ONE_LEG_EXPOSURE', 'CONVERSION_VALUATION', 'OPERATIONAL_RECOVERY_COST', 'RESIDUAL_UNEXPLAINED']) {
    assert.ok(ECONOMIC_COMPONENT_KINDS.includes(required), `missing economics component ${required}`);
  }
});

test('missing economics is null, never zero, and estimates require a range', () => {
  assert.deepEqual(validateEconomicComponent(component()), []);
  assert.deepEqual(validateEconomicComponent(component({ status: 'MISSING', amount: '0' })), ['ABSENT_STATUS_MUST_NOT_HAVE_AMOUNT']);
  assert.deepEqual(validateEconomicComponent(component({ status: 'MISSING', amount: null })), []);
  assert.deepEqual(validateEconomicComponent(component({ status: 'ESTIMATED', amount: '-1', estimateRange: null })), ['ESTIMATED_REQUIRES_RANGE']);
});

test('economics rejects malformed decimals, reversed ranges, and mixed valuation assets', () => {
  assert.deepEqual(validateEconomicComponent(component({ amount: '1.00' })), ['AMOUNT_DECIMAL_NOT_CANONICAL']);
  assert.deepEqual(validateEconomicComponent(component({
    status: 'ESTIMATED',
    amount: '5',
    estimateRange: { low: '6', high: '4' },
  })), ['ESTIMATE_RANGE_REVERSED', 'ESTIMATE_AMOUNT_OUTSIDE_RANGE']);
  const mixed = validateEconomicAttribution({
    components: [component(), component({ id: 'economic-2', valuationAsset: 'USD' })],
    valuationAsset: 'USDT',
    netKnown: '-2.5',
    netEstimatedRange: null,
    completeness: 'DIVERGENT',
    accountingIdentityProven: false,
    includedComponentIds: ['economic-1', 'economic-2'],
    missingComponentKinds: [],
    divergentReasons: ['MIXED_VALUATION_ASSET'],
    evaluatedAtMs: NOW,
  });
  assert.deepEqual(mixed, ['MIXED_VALUATION_ASSET_economic-2']);
});

test('every action kind has an explicit risk effect', () => {
  assert.deepEqual(POSITION_ACTION_INTENTS.map((kind) => [kind, actionRiskEffect(kind)]), [
    ['HOLD', 'NO_CHANGE'],
    ['ADD_STAGE', 'RISK_INCREASING'],
    ['REDUCE', 'RISK_REDUCING'],
    ['REQUEST_HEDGE', 'RISK_REDUCING'],
    ['REQUEST_EXIT', 'RISK_REDUCING'],
    ['REQUEST_EMERGENCY_UNWIND', 'RISK_REDUCING'],
    ['FREEZE_NEW_ACTIONS', 'NO_CHANGE'],
    ['NO_ACTION_UNKNOWN', 'NO_CHANGE'],
  ]);
});

test('hostile action intent cannot lie about risk effect or invent an unknown target as zero', () => {
  assert.deepEqual(validatePositionActionIntent({
    kind: 'ADD_STAGE',
    riskEffect: 'RISK_REDUCING',
    target: { kind: 'TOTAL', quoteNotional: '10', valuationAsset: 'USDT' },
  }), ['RISK_EFFECT_MISMATCH']);
  assert.deepEqual(validatePositionActionIntent({
    kind: 'NO_ACTION_UNKNOWN',
    riskEffect: 'NO_CHANGE',
    target: { kind: 'UNKNOWN', valuationAsset: 'USDT', reasonCodes: ['POSITION_TRUTH_UNKNOWN'] },
  }), []);
  assert.deepEqual(validatePositionActionIntent({
    kind: 'NO_ACTION_UNKNOWN',
    riskEffect: 'NO_CHANGE',
    target: { kind: 'TOTAL', quoteNotional: '0', valuationAsset: 'USDT' },
  }), ['UNKNOWN_ACTION_REQUIRES_UNKNOWN_TARGET']);
  assert.deepEqual(validatePositionActionIntent({
    kind: 'ADD_STAGE',
    riskEffect: 'RISK_INCREASING',
    target: { kind: 'TOTAL', quoteNotional: '-1', valuationAsset: 'USDT' },
  }), ['TOTAL_TARGET_MUST_BE_NON_NEGATIVE']);
});

test('unknown or stale control posture blocks increases while reduction policy remains separate', () => {
  const freshTruth = assessCapitalTruth({ source: source(), evaluatedAtMs: NOW, requiredValuePresent: true });
  const staleTruth = assessCapitalTruth({ source: source({ sourceTimeMs: NOW - 5_000 }), evaluatedAtMs: NOW, requiredValuePresent: true });
  assert.equal(postureAllowsRiskIncrease({ posture: 'OPEN', truth: freshTruth, revision: 'control-1', reasonCodes: [] }), true);
  assert.equal(postureAllowsRiskIncrease({ posture: 'OPEN', truth: staleTruth, revision: 'control-1', reasonCodes: ['STALE'] }), false);
  assert.equal(postureAllowsRiskIncrease({ posture: 'UNKNOWN', truth: freshTruth, revision: null, reasonCodes: ['MISSING'] }), false);
  assert.equal(postureAllowsRiskIncrease({ posture: 'KILL_NEW_EXPOSURE', truth: freshTruth, revision: 'control-2', reasonCodes: ['KILL'] }), false);
});

test('policy bounds compare exact decimals and reject out-of-bound values', () => {
  assert.equal(policyBoundIsValid({ value: '10', minimum: '9', maximum: '11', unit: 'USDT' }), true);
  assert.equal(policyBoundIsValid({ value: '8.999', minimum: '9', maximum: '11', unit: 'USDT' }), false);
  assert.equal(policyBoundIsValid({ value: '100', minimum: '9', maximum: '11', unit: 'USDT' }), false);
});

test('bound external risk verdict remains Foundation-owned and fail-closed', () => {
  const verdict = deriveRiskVerdict({
    evaluatedAt: NOW,
    ttlMs: 500,
    checks: [{
      code: 'ACCOUNT_TRUTH',
      status: 'UNKNOWN',
      blocking: true,
      detail: 'account source missing',
      observed: null,
      limit: null,
      evidenceTimestamp: null,
    }],
  });
  assert.equal(verdict.allowed, false);
  assert.deepEqual(verdict.blockingCodes, ['ACCOUNT_TRUTH']);
  assert.equal(Object.isFrozen(verdict), true);
  const projection = projectFoundationRiskVerdict(verdict);
  assert.equal(projection.allowed, false);
  assert.deepEqual(projection.omittedFields, ['checks.observed', 'checks.limit']);
  assert.equal('observed' in projection.checks[0], false);
  assert.equal('limit' in projection.checks[0], false);
});

test('capital JSON payload guard rejects every numeric payload and cyclic state', () => {
  assert.deepEqual(validateCapitalJsonValue({ amount: '10.25', revision: '2', active: true }), []);
  assert.deepEqual(validateCapitalJsonValue({ amount: 10.25 }), ['$.amount:NUMBER_REQUIRES_STRING_ENCODING']);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.deepEqual(validateCapitalJsonValue(cyclic), ['$.self:CYCLIC_VALUE']);
});

test('mandate and approval authority samples bind proposal, plan, config, revision, and digest', () => {
  const stagedPlanId = deriveStagedPlanId({ reservation: 'cres-1' });
  const mandate = {
    id: deriveCapitalMandateId({ intake: 'intake-digest', plan: stagedPlanId, revision: 3 }),
    revision: 3,
    digest: 'mandate-digest',
    proposalIntakeDigest: 'intake-digest',
    stagedPlanId,
    stagedPlanRevision: 2,
    stagedPlanDigest: 'plan-digest',
    configRevision: deriveCapitalConfigRevision('budget', { gross: '1000' }),
  };
  const approval = {
    id: deriveOperatorApprovalId({ mandateId: mandate.id, revision: mandate.revision }),
    proposalIntakeDigest: mandate.proposalIntakeDigest,
    mandateId: mandate.id,
    mandateRevision: mandate.revision,
    mandateDigest: mandate.digest,
    stagedPlanId: mandate.stagedPlanId,
    stagedPlanRevision: mandate.stagedPlanRevision,
    stagedPlanDigest: mandate.stagedPlanDigest,
    configRevision: mandate.configRevision,
  };
  const serialized = canonicalJson({ approval, mandate });
  assert.equal(serialized.includes('intake-digest'), true);
  assert.equal(serialized.includes('plan-digest'), true);
  assert.equal(serialized, canonicalJson(JSON.parse(serialized)));
});

test('canonical serialization of contract-shaped output is byte equivalent on replay', () => {
  const output = {
    lifecycle: 'AWAITING_RISK',
    mandateId: deriveCapitalMandateId({ proposal: 'bp_1', revision: 1 }),
    requested: normalizeNonNegativeExactDecimal('00100.5000'),
    truth: 'COMPLETE',
  };
  const first = canonicalJson(output);
  const second = canonicalJson(JSON.parse(first));
  assert.equal(first, second);
});
