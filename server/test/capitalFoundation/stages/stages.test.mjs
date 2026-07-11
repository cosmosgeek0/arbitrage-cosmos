import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCapitalMandate,
  buildStagedPlan,
  createStagedPlanConfiguration,
  evaluateStageTransition,
  isStagedPlanConfigurationEffective,
  reviseCapitalMandate,
  reviseStagedPlan,
  validateGovernedStages,
  validateStagedPlanConfiguration,
} from '../../../dist/capitalFoundation/stages/index.js';
import { assessCapitalTruth, capitalDigest } from '../../../dist/capitalFoundation/contracts/index.js';

const NOW = 1_800_000_000_000;
const GATES = ['OPERATOR_APPROVAL', 'MULTI_LEG_RISK', 'FRESH_ACCOUNT_TRUTH', 'FRESH_MARKET_EVIDENCE'];

function exactBound(value, maximum = value) {
  return { value, minimum: '0', maximum, unit: 'USDT' };
}

function integerBound(value, maximum = value) {
  return { value, minimum: 1, maximum, unit: 'MILLISECONDS' };
}

function config(overrides = {}) {
  return createStagedPlanConfiguration({
    sourceId: 'capital-policy-test',
    issuedAtMs: NOW - 1_000,
    effectiveFromMs: NOW - 500,
    effectiveUntilMs: NOW + 1_000_000,
    maximumPlanExposure: exactBound('100', '200'),
    maximumPlanDurationMs: integerBound(600_000, 1_000_000),
    maximumStageDurationMs: integerBound(60_000, 120_000),
    maximumEvidenceAgeMs: integerBound(1_000, 5_000),
    maximumNakedLegAmount: exactBound('5', '10'),
    maximumNakedLegDurationMs: integerBound(5_000, 10_000),
    ...overrides,
  });
}

function step(stage, sequence, overrides = {}) {
  const next = ({ OBSERVE: 'CONFIRM', CONFIRM: 'ADD', ADD: 'HOLD', HOLD: 'REDUCE', REDUCE: 'EXIT' })[stage];
  const increasing = stage === 'CONFIRM' || stage === 'ADD';
  const amounts = stage === 'CONFIRM'
    ? ['40', '40', '40']
    : stage === 'ADD'
      ? ['60', '100', '60']
      : stage === 'HOLD'
        ? ['0', '100', '0']
        : stage === 'REDUCE'
          ? ['0', '40', '0']
          : ['0', '0', '0'];
  return {
    stage,
    sequence,
    maximumAdditionalExposure: amounts[0],
    maximumTotalExposure: amounts[1],
    reservationConsumption: amounts[2],
    prerequisites: increasing ? [{ code: `${stage}_EVIDENCE`, required: true, evidenceMaximumAgeMs: 1_000, detail: 'fresh thesis evidence' }] : [],
    economicThesisConditions: increasing ? [`${stage}-thesis`] : [],
    invalidationConditions: increasing ? [`${stage}-invalid`] : [],
    maximumTimeInStageMs: 60_000,
    requiredApprovalActions: stage === 'CONFIRM' ? ['OPEN'] : stage === 'ADD' ? ['ADD'] : [],
    requiredFutureGates: increasing ? GATES : [],
    liquidityRequirement: increasing ? '1000' : null,
    maximumNakedLegAmount: increasing ? '5' : '0',
    maximumNakedLegDurationMs: increasing ? 5_000 : 0,
    stopAddingConditions: increasing ? [`${stage}-stop`] : [],
    allowedNextStages: next ? [next] : [],
    reductionConditions: stage === 'REDUCE' ? ['target-reached'] : [],
    cancellableBeforeEntry: true,
    nextStageConditions: next ? [{ targetStage: next, conditions: [`${stage}-to-${next}`] }] : [],
    skipConditions: stage === 'OBSERVE' ? [{ targetStage: 'CONFIRM', skippedStages: ['PROBE'], conditions: ['probe-not-required'] }] : [],
    unenteredCancellationConditions: ['proposal-expired'],
    ...overrides,
  };
}

function stages() {
  return ['OBSERVE', 'CONFIRM', 'ADD', 'HOLD', 'REDUCE', 'EXIT'].map((name, index) => step(name, index));
}

function reservation(overrides = {}) {
  return {
    id: 'cres-stage-test',
    allocationDecisionId: 'calloc-stage-test',
    considerationId: 'cop-stage-test',
    amount: '100',
    consumedAmount: '0',
    valuationAsset: 'USDT',
    state: 'ACTIVE',
    createdAtMs: NOW - 1_000,
    expiresAtMs: NOW + 600_000,
    releasedAtMs: null,
    revision: 1,
    idempotencyKey: 'reservation-stage-test',
    ...overrides,
  };
}

function makePlan(overrides = {}) {
  const { activeStage = 'CONFIRM', ...freshOverrides } = overrides;
  const built = buildStagedPlan({
    reservation: reservation(),
    proposalIntakeDigest: 'proposal-digest-v1',
    valuationAsset: 'USDT',
    configuration: config(),
    stages: stages(),
    activeStage: 'OBSERVE',
    createdAtMs: NOW,
    expiresAtMs: NOW + 300_000,
    correlationId: 'cor-stage-build',
    ...freshOverrides,
  });
  if (!built.ok || activeStage === 'OBSERVE') return built;
  const { digest: _freshDigest, ...freshSemantic } = built.value;
  const advancedSemantic = Object.freeze({ ...freshSemantic, activeStage });
  return Object.freeze({
    ok: true,
    value: Object.freeze({ ...advancedSemantic, digest: capitalDigest(advancedSemantic) }),
  });
}

function approvalUseScopeKey(plan, from = plan.activeStage, to = 'ADD') {
  return `stage:${plan.id}:${plan.revision}:${plan.digest}:${from}->${to}`;
}

function approval(plan, overrides = {}) {
  return {
    validated: true,
    approvalId: 'approval-stage-test',
    approvalRevision: 1,
    mode: 'MANUAL_ARMED',
    validatedAtMs: NOW,
    expiresAtMs: NOW + 10_000,
    revokedAtMs: null,
    useScopeKey: approvalUseScopeKey(plan),
    actionClass: 'ADD',
    stage: 'ADD',
    stagedPlanId: plan.id,
    stagedPlanRevision: plan.revision,
    stagedPlanDigest: plan.digest,
    configRevision: plan.configRevision,
    allowedActionClasses: ['ADD'],
    maximumAdditionalExposure: '60',
    maximumTotalExposure: '100',
    ...overrides,
  };
}

function transition(plan, overrides = {}) {
  return evaluateStageTransition({
    plan,
    configuration: config(),
    to: 'ADD',
    stageEnteredAtMs: NOW - 100,
    nowMs: NOW,
    correlationId: 'cor-stage-transition',
    currentTotalExposure: '40',
    requestedAdditionalExposure: '60',
    reservation: reservation(),
    reservationValidatedAtMs: NOW,
    evidence: [{ code: 'ADD_EVIDENCE', observedAtMs: NOW - 100, available: true }],
    satisfiedThesisConditions: ['ADD-thesis'],
    triggeredInvalidationConditions: [],
    triggeredStopAddingConditions: [],
    satisfiedTransitionConditions: ['CONFIRM-to-ADD'],
    availableLiquidityDepth: '1000',
    proposedNakedLegAmount: '5',
    proposedNakedLegDurationMs: 5_000,
    approval: approval(plan),
    futureRiskRecheck: {
      required: true,
      owner: 'FOUNDATION_MULTI_LEG_RISK',
      stagedPlanId: plan.id,
      stagedPlanRevision: plan.revision,
      stagedPlanDigest: plan.digest,
    },
    adversePriceMoveIsSoleReason: false,
    ...overrides,
  });
}

test('configuration is content-addressed, bounded, and half-open in effective time', () => {
  const a = config();
  const b = config();
  assert.equal(a.authority.revision, b.authority.revision);
  assert.deepEqual(validateStagedPlanConfiguration(a), []);
  assert.equal(isStagedPlanConfigurationEffective(a, NOW), true);
  assert.equal(isStagedPlanConfigurationEffective(a, a.authority.effectiveUntilMs), false);
  assert.throws(() => config({ maximumPlanDurationMs: integerBound(10, 5) }), /OUT_OF_BOUNDS|RANGE_INVERTED/);
  const forged = { ...a, authority: { ...a.authority, revision: 'cfg_forged' } };
  assert.ok(validateStagedPlanConfiguration(forged).includes('CONFIG_REVISION_DIGEST_MISMATCH'));
});

test('stage policy requires explicit canonical skip, exact evidence, authority, risk, liquidity, naked-leg, and cancellation envelopes', () => {
  assert.deepEqual(validateGovernedStages(stages(), config(), '100'), []);
  const noSkip = stages().map((item) => item.stage === 'OBSERVE' ? { ...item, skipConditions: [] } : item);
  assert.ok(validateGovernedStages(noSkip, config(), '100').includes('EXPLICIT_SKIP_CONDITION_MISSING'));
  const noRisk = stages().map((item) => item.stage === 'ADD' ? { ...item, requiredFutureGates: ['OPERATOR_APPROVAL'] } : item);
  assert.ok(validateGovernedStages(noRisk, config(), '100').includes('INCREASE_FUTURE_GATE_MISSING'));
  const floatMoney = stages().map((item) => item.stage === 'ADD' ? { ...item, maximumAdditionalExposure: 60 } : item);
  assert.ok(validateGovernedStages(floatMoney, config(), '100').some((code) => code.includes('MAXIMUMADDITIONALEXPOSURE')));
});

test('plan IDs and digests are deterministic while array-set input order is canonicalized', () => {
  const first = makePlan();
  assert.equal(first.ok, true);
  const shuffled = stages().map((item) => item.stage === 'ADD'
    ? { ...item, requiredFutureGates: [...item.requiredFutureGates].reverse(), invalidationConditions: ['ADD-invalid'] }
    : item);
  const second = makePlan({ stages: shuffled });
  assert.equal(second.ok, true);
  assert.equal(first.value.id, second.value.id);
  assert.equal(first.value.digest, second.value.digest);
  assert.equal(first.value.remainingReservedAmount, '100');
  assert.ok(Object.isFrozen(first.value));
});

test('a fresh public plan must start OBSERVE while revision retains the current active stage', () => {
  const rejected = buildStagedPlan({
    reservation: reservation(),
    proposalIntakeDigest: 'proposal-digest-v1',
    valuationAsset: 'USDT',
    configuration: config(),
    stages: stages(),
    activeStage: 'CONFIRM',
    createdAtMs: NOW,
    expiresAtMs: NOW + 300_000,
    correlationId: 'cor-fresh-confirm',
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.failure.code, 'INITIAL_STAGE_MUST_BE_OBSERVE');
  const fresh = makePlan({ activeStage: 'OBSERVE' });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.value.activeStage, 'OBSERVE');
});

test('reservation overcommit and invalid plan/config effective windows fail closed', () => {
  const over = makePlan({ reservation: reservation({ amount: '99' }) });
  assert.equal(over.ok, false);
  assert.equal(over.failure.code, 'STAGE_RESERVATION_OVERCOMMITTED');
  const late = makePlan({ createdAtMs: NOW + 2_000_000, expiresAtMs: NOW + 2_000_100 });
  assert.equal(late.ok, false);
  assert.equal(late.failure.code, 'CONFIG_NOT_EFFECTIVE');
  const wrongValuation = makePlan({ valuationAsset: 'BTC' });
  assert.equal(wrongValuation.ok, false);
  assert.equal(wrongValuation.failure.code, 'PLAN_BINDING_INVALID');
});

test('ADD rejects adverse price as sole reason and every missing current authority input', () => {
  const built = makePlan();
  assert.equal(built.ok, true);
  const plan = built.value;
  const cases = [
    [{ adversePriceMoveIsSoleReason: true }, 'AVERAGING_DOWN_FORBIDDEN'],
    [{ evidence: [{ code: 'ADD_EVIDENCE', observedAtMs: NOW - 1_001, available: true }] }, 'FRESH_EVIDENCE_REQUIRED'],
    [{ reservation: reservation({ consumedAmount: '40.001', revision: 2 }) }, 'RESERVATION_REQUIRED'],
    [{ approval: null }, 'SCOPED_APPROVAL_REQUIRED'],
    [{ futureRiskRecheck: null }, 'FUTURE_RISK_RECHECK_REQUIRED'],
    [{ availableLiquidityDepth: '999.999' }, 'LIQUIDITY_DEPTH_INSUFFICIENT'],
    [{ proposedNakedLegAmount: '5.0001' }, 'NAKED_LEG_LIMIT_EXCEEDED'],
    [{ triggeredInvalidationConditions: ['ADD-invalid'] }, 'THESIS_INVALIDATED'],
    [{ triggeredStopAddingConditions: ['ADD-stop'] }, 'STOP_ADD_TRIGGERED'],
  ];
  for (const [override, code] of cases) {
    const result = transition(plan, override);
    assert.equal(result.ok, false, code);
    assert.equal(result.failure.code, code);
  }
});

test('authorized ADD is only authorized for external risk evaluation and never execution-ready', () => {
  const built = makePlan();
  const result = transition(built.value);
  assert.equal(result.ok, true);
  assert.equal(result.value.authorizedForExternalRiskEvaluation, true);
  assert.equal(result.value.executionReady, false);
  assert.equal(result.value.reservationConsumption, '60');
  assert.equal(result.value.planDigest, built.value.digest);
  assert.equal(result.value.reservationRevision, 1);
  assert.equal(result.value.approvalId, 'approval-stage-test');
});

test('changed plan content cannot reuse an old digest, approval, or risk binding', () => {
  const built = makePlan();
  const forged = {
    ...built.value,
    stages: built.value.stages.map((item) => item.stage === 'ADD'
      ? { ...item, maximumAdditionalExposure: '1000', maximumTotalExposure: '1040', reservationConsumption: '0' }
      : item),
  };
  const result = transition(forged, {
    requestedAdditionalExposure: '1000',
    approval: approval(forged, { maximumAdditionalExposure: '1000', maximumTotalExposure: '1040' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'STAGED_PLAN_INTEGRITY_INVALID');
});

test('ADD evidence duplicates are canonical when identical and fail closed when divergent regardless of order', () => {
  const plan = makePlan().value;
  const fresh = { code: 'ADD_EVIDENCE', observedAtMs: NOW - 100, available: true };
  const stale = { code: 'ADD_EVIDENCE', observedAtMs: NOW - 2_000, available: true };
  assert.equal(transition(plan, { evidence: [fresh, { ...fresh }] }).ok, true);
  for (const evidence of [[fresh, stale], [stale, fresh]]) {
    const result = transition(plan, { evidence });
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, 'EVIDENCE_OBSERVATIONS_DIVERGENT');
  }
});

test('source-stage duration, not target-stage duration, bounds an increasing transition', () => {
  const shortConfirm = stages().map((item) => item.stage === 'CONFIRM' ? { ...item, maximumTimeInStageMs: 1_000 } : item);
  const plan = makePlan({ stages: shortConfirm }).value;
  const result = transition(plan, { stageEnteredAtMs: NOW - 1_001 });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'STAGE_TIME_LIMIT_EXCEEDED');
});

test('ADD requires a same-clock MANUAL_ARMED approval with current identity, revision, scope, action, and revocation state', () => {
  const plan = makePlan().value;
  const cases = [
    { mode: 'VALIDATE_ONLY' },
    { validatedAtMs: NOW - 1 },
    { expiresAtMs: NOW },
    { revokedAtMs: NOW - 1 },
    { approvalId: '' },
    { approvalRevision: 0 },
    { useScopeKey: 'unrelated-use' },
    { actionClass: 'OPEN' },
    { stage: 'CONFIRM' },
  ];
  for (const hostile of cases) {
    const result = transition(plan, { approval: approval(plan, hostile) });
    assert.equal(result.ok, false, JSON.stringify(hostile));
    assert.equal(result.failure.code, 'SCOPED_APPROVAL_REQUIRED', JSON.stringify(hostile));
  }
});

test('ADD binds the current active reservation identity, consideration, unit, revision, state, expiry, and exact availability', () => {
  const plan = makePlan().value;
  const cases = [
    { id: 'other-reservation' },
    { considerationId: 'other-consideration' },
    { valuationAsset: 'BTC' },
    { revision: 0 },
    { state: 'RELEASED', releasedAtMs: NOW - 1 },
    { expiresAtMs: NOW },
    { consumedAmount: '40.001', revision: 2 },
  ];
  for (const hostile of cases) {
    const result = transition(plan, { reservation: reservation(hostile) });
    assert.equal(result.ok, false, JSON.stringify(hostile));
    assert.equal(result.failure.code, 'RESERVATION_REQUIRED', JSON.stringify(hostile));
  }
  const staleValidation = transition(plan, { reservationValidatedAtMs: NOW - 1 });
  assert.equal(staleValidation.ok, false);
  assert.equal(staleValidation.failure.code, 'RESERVATION_REQUIRED');
});

test('explicit skip conditions must be satisfied before OBSERVE can skip PROBE for CONFIRM', () => {
  const plan = makePlan({ activeStage: 'OBSERVE' }).value;
  const input = {
    plan,
    configuration: config(),
    to: 'CONFIRM',
    stageEnteredAtMs: NOW - 100,
    nowMs: NOW,
    correlationId: 'cor-observe-confirm',
    currentTotalExposure: '0',
    requestedAdditionalExposure: '40',
    reservation: reservation(),
    reservationValidatedAtMs: NOW,
    evidence: [{ code: 'CONFIRM_EVIDENCE', observedAtMs: NOW - 100, available: true }],
    satisfiedThesisConditions: ['CONFIRM-thesis'],
    triggeredInvalidationConditions: [],
    triggeredStopAddingConditions: [],
    satisfiedTransitionConditions: ['OBSERVE-to-CONFIRM'],
    availableLiquidityDepth: '1000',
    proposedNakedLegAmount: '5',
    proposedNakedLegDurationMs: 5_000,
    approval: approval(plan, {
      useScopeKey: approvalUseScopeKey(plan, 'OBSERVE', 'CONFIRM'),
      actionClass: 'OPEN',
      stage: 'CONFIRM',
      allowedActionClasses: ['OPEN'],
      maximumAdditionalExposure: '40',
      maximumTotalExposure: '40',
    }),
    futureRiskRecheck: {
      required: true,
      owner: 'FOUNDATION_MULTI_LEG_RISK',
      stagedPlanId: plan.id,
      stagedPlanRevision: plan.revision,
      stagedPlanDigest: plan.digest,
    },
    adversePriceMoveIsSoleReason: false,
  };
  const missing = evaluateStageTransition(input);
  assert.equal(missing.ok, false);
  assert.equal(missing.failure.code, 'SKIP_CONDITION_UNSATISFIED');
  const authorized = evaluateStageTransition({ ...input, satisfiedTransitionConditions: ['OBSERVE-to-CONFIRM', 'probe-not-required'] });
  assert.equal(authorized.ok, true);
});

test('risk-reducing transition remains available without fresh ADD evidence or approval', () => {
  const built = makePlan({ activeStage: 'HOLD' });
  assert.equal(built.ok, true);
  const result = evaluateStageTransition({
    plan: built.value,
    configuration: config(),
    to: 'REDUCE',
    stageEnteredAtMs: NOW - 100_000,
    nowMs: NOW,
    correlationId: 'cor-reduce',
    currentTotalExposure: '100',
    requestedAdditionalExposure: '0',
    reservation: null,
    reservationValidatedAtMs: null,
    evidence: [],
    satisfiedThesisConditions: [],
    triggeredInvalidationConditions: [],
    triggeredStopAddingConditions: [],
    satisfiedTransitionConditions: ['HOLD-to-REDUCE'],
    availableLiquidityDepth: null,
    proposedNakedLegAmount: '0',
    proposedNakedLegDurationMs: 0,
    approval: null,
    futureRiskRecheck: null,
    adversePriceMoveIsSoleReason: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.authorizedForExternalRiskEvaluation, false);
  assert.equal(result.value.executionReady, false);
});

test('expired plan and released reservation do not suppress a valid risk-reducing REDUCE transition', () => {
  const built = makePlan({ activeStage: 'HOLD' });
  const result = evaluateStageTransition({
    plan: built.value,
    configuration: config(),
    to: 'REDUCE',
    stageEnteredAtMs: NOW,
    nowMs: NOW + 300_001,
    correlationId: 'cor-expired-reduce',
    currentTotalExposure: '100',
    requestedAdditionalExposure: '0',
    reservation: reservation({ state: 'RELEASED', releasedAtMs: NOW + 10, revision: 2 }),
    reservationValidatedAtMs: null,
    evidence: [
      { code: 'IGNORED', observedAtMs: NOW, available: true },
      { code: 'IGNORED', observedAtMs: NOW - 1, available: false },
    ],
    satisfiedThesisConditions: [],
    triggeredInvalidationConditions: [],
    triggeredStopAddingConditions: [],
    satisfiedTransitionConditions: ['HOLD-to-REDUCE'],
    availableLiquidityDepth: null,
    proposedNakedLegAmount: '0',
    proposedNakedLegDurationMs: 0,
    approval: null,
    futureRiskRecheck: null,
    adversePriceMoveIsSoleReason: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.reservationId, null);
  assert.equal(result.value.approvalId, null);
});

test('plan revision preserves identity, freezes completed stages, cancels future stages, and changes revision/digest/config binding', () => {
  const built = makePlan();
  assert.equal(built.ok, true);
  const nextConfig = config({ maximumPlanExposure: exactBound('120', '200') });
  const revised = reviseStagedPlan({
    current: built.value,
    currentConfiguration: config(),
    reservation: reservation(),
    configuration: nextConfig,
    stages: stages(),
    activeStage: 'CONFIRM',
    expiresAtMs: NOW + 290_000,
    correlationId: 'cor-plan-revise',
    completedStages: ['OBSERVE'],
    currentTotalExposure: '40',
    revisedAtMs: NOW + 100,
  });
  assert.equal(revised.ok, true);
  assert.equal(revised.value.plan.id, built.value.id);
  assert.equal(revised.value.plan.revision, 2);
  assert.equal(revised.value.plan.activeStage, 'CONFIRM');
  assert.notEqual(revised.value.plan.digest, built.value.digest);
  assert.equal(revised.value.plan.configRevision, nextConfig.authority.revision);
  assert.deepEqual(revised.value.cancelledUnenteredStages, ['ADD', 'HOLD', 'REDUCE', 'EXIT']);
  const rewrittenPast = stages().map((item) => item.stage === 'OBSERVE' ? { ...item, maximumTimeInStageMs: 59_999 } : item);
  const rejected = reviseStagedPlan({
    current: built.value, currentConfiguration: config(), reservation: reservation(), configuration: config(), stages: rewrittenPast,
    activeStage: 'CONFIRM', expiresAtMs: NOW + 290_000, correlationId: 'cor-past', completedStages: ['OBSERVE'],
    currentTotalExposure: '40', revisedAtMs: NOW + 100,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.failure.code, 'COMPLETED_STAGE_IMMUTABLE');
});

test('a non-cancellable unentered stage blocks plan replacement', () => {
  const initialStages = stages().map((item) => item.stage === 'ADD' ? { ...item, cancellableBeforeEntry: false } : item);
  const built = makePlan({ stages: initialStages });
  assert.equal(built.ok, true);
  const result = reviseStagedPlan({
    current: built.value, currentConfiguration: config(), reservation: reservation(), configuration: config(), stages: stages(), activeStage: 'CONFIRM',
    expiresAtMs: NOW + 290_000, correlationId: 'cor-no-cancel', completedStages: ['OBSERVE'], currentTotalExposure: '40', revisedAtMs: NOW + 100,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'FUTURE_STAGE_NOT_CANCELLABLE');
});

test('plan revision requires the complete prior-stage prefix and rejects a forged current digest', () => {
  const built = makePlan();
  const base = {
    current: built.value,
    currentConfiguration: config(),
    reservation: reservation(),
    configuration: config(),
    stages: stages(),
    activeStage: 'CONFIRM',
    expiresAtMs: NOW + 290_000,
    correlationId: 'cor-completed-prefix',
    currentTotalExposure: '40',
    revisedAtMs: NOW + 100,
  };
  const missing = reviseStagedPlan({ ...base, completedStages: [] });
  assert.equal(missing.ok, false);
  assert.equal(missing.failure.code, 'COMPLETED_STAGE_SET_INVALID');
  const forged = reviseStagedPlan({ ...base, current: { ...built.value, activeStage: 'ADD' }, activeStage: 'ADD', completedStages: ['OBSERVE', 'CONFIRM'] });
  assert.equal(forged.ok, false);
  assert.equal(forged.failure.code, 'CURRENT_PLAN_INTEGRITY_INVALID');
});

function consideration(overrides = {}) {
  const evaluatedAtMs = overrides.evaluatedAtMs ?? NOW;
  const truth = overrides.truth ?? assessCapitalTruth({
    source: {
      sourceTimeMs: NOW - 100,
      receivedAtMs: NOW - 90,
      maxAgeMs: 1_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceId: 'capital.opportunity.test',
    },
    evaluatedAtMs,
    requiredValuePresent: true,
    revision: 'opportunity-truth-r1',
  });
  return {
    id: 'cop-stage-test',
    proposal: { intakeDigest: 'proposal-digest-v1', expiresAtMs: NOW + 500_000 },
    economics: { valuationAsset: 'USDT' },
    truth,
    evidenceTruth: 'COMPLETE',
    evaluatedAtMs,
    mode: 'MANUAL_ARMED',
    status: 'ELIGIBLE',
    ...overrides,
  };
}

test('mandate binds proposal intake, reservation, staged plan revision/digest and config revision deterministically', () => {
  const built = makePlan();
  const input = {
    consideration: consideration(), allocationDecisionId: 'calloc-stage-test', reservation: reservation(), plan: built.value,
    configuration: config(), targetMaximumExposure: '100', createdAtMs: NOW, expiresAtMs: NOW + 250_000, correlationId: 'cor-mandate',
  };
  const first = buildCapitalMandate(input);
  const second = buildCapitalMandate(input);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.value.id, second.value.id);
  assert.equal(first.value.digest, second.value.digest);
  assert.equal(first.value.proposalIntakeDigest, 'proposal-digest-v1');
  assert.equal(first.value.stagedPlanDigest, built.value.digest);
  assert.equal(first.value.configRevision, built.value.configRevision);
  assert.equal(first.value.approvalId, null);
  assert.equal(first.value.riskDecision, null);
});

test('mandate revision requires a newer bound plan and clears all old authority', () => {
  const built = makePlan();
  const mandate = buildCapitalMandate({
    consideration: consideration(), allocationDecisionId: 'calloc-stage-test', reservation: reservation(), plan: built.value,
    configuration: config(), targetMaximumExposure: '100', createdAtMs: NOW, expiresAtMs: NOW + 250_000, correlationId: 'cor-mandate',
  });
  const planRevision = reviseStagedPlan({
    current: built.value, currentConfiguration: config(), reservation: reservation(), configuration: config(), stages: stages(), activeStage: 'CONFIRM',
    expiresAtMs: NOW + 280_000, correlationId: 'cor-plan-revision', completedStages: ['OBSERVE'], currentTotalExposure: '40', revisedAtMs: NOW + 100,
  });
  const currentWithAuthority = { ...mandate.value, approvalId: 'old-approval', riskDecision: { old: true } };
  const { digest: _oldDigest, ...currentSemantic } = currentWithAuthority;
  const revised = reviseCapitalMandate({
    current: { ...currentSemantic, digest: capitalDigest(currentSemantic) },
    plan: planRevision.value.plan,
    configuration: config(),
    proposalIntakeDigest: 'proposal-digest-v1',
    targetMaximumExposure: '100',
    revisedAtMs: NOW + 101,
    expiresAtMs: NOW + 240_000,
    correlationId: 'cor-mandate-revision',
  });
  assert.equal(revised.ok, true);
  assert.equal(revised.value.id, mandate.value.id);
  assert.equal(revised.value.revision, 2);
  assert.equal(revised.value.approvalId, null);
  assert.equal(revised.value.riskDecision, null);
  assert.equal(revised.value.stagedPlanRevision, 2);
  assert.notEqual(revised.value.digest, mandate.value.digest);
});

test('mandate rejects stale proposal digest, advisory authority, and ambiguous target maximum', () => {
  const built = makePlan();
  const base = {
    consideration: consideration(), allocationDecisionId: 'calloc-stage-test', reservation: reservation(), plan: built.value,
    configuration: config(), targetMaximumExposure: '100', createdAtMs: NOW, expiresAtMs: NOW + 250_000, correlationId: 'cor-bad-mandate',
  };
  assert.equal(buildCapitalMandate({ ...base, consideration: consideration({ mode: 'ADVISORY' }) }).failure.code, 'CONSIDERATION_NOT_MANDATE_ELIGIBLE');
  assert.equal(buildCapitalMandate({ ...base, consideration: consideration({ proposal: { intakeDigest: 'changed', expiresAtMs: NOW + 500_000 } }) }).failure.code, 'PROPOSAL_INTAKE_DIGEST_MISMATCH');
  assert.equal(buildCapitalMandate({ ...base, targetMaximumExposure: '99' }).failure.code, 'MANDATE_TARGET_MUST_EQUAL_PLAN_MAXIMUM');
});

test('mandate re-ages consideration truth and rejects a stale eligibility decision', () => {
  const built = makePlan();
  const result = buildCapitalMandate({
    consideration: consideration(),
    allocationDecisionId: 'calloc-stage-test',
    reservation: reservation(),
    plan: built.value,
    configuration: config(),
    targetMaximumExposure: '100',
    createdAtMs: NOW + 2_000,
    expiresAtMs: NOW + 250_000,
    correlationId: 'cor-stale-consideration',
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'CONSIDERATION_TRUTH_NOT_CURRENT');
});

test('mandate rejects cross-opportunity, valuation, reservation-revision, and forged-plan bindings', () => {
  const built = makePlan();
  const base = {
    consideration: consideration(),
    allocationDecisionId: 'calloc-stage-test',
    reservation: reservation(),
    plan: built.value,
    configuration: config(),
    targetMaximumExposure: '100',
    createdAtMs: NOW,
    expiresAtMs: NOW + 250_000,
    correlationId: 'cor-hostile-mandate',
  };
  const cases = [
    { reservation: reservation({ considerationId: 'other-consideration' }) },
    { reservation: reservation({ valuationAsset: 'BTC' }) },
    { reservation: reservation({ revision: 2 }) },
    { consideration: consideration({ economics: { valuationAsset: 'BTC' } }) },
    { plan: { ...built.value, remainingReservedAmount: '99' } },
  ];
  for (const hostile of cases) {
    const result = buildCapitalMandate({ ...base, ...hostile });
    assert.equal(result.ok, false, JSON.stringify(Object.keys(hostile)));
    assert.ok(['MANDATE_RESERVATION_BINDING_INVALID', 'MANDATE_PLAN_INTEGRITY_INVALID'].includes(result.failure.code));
  }
});
