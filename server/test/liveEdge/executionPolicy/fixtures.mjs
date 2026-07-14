import {
  addPolicyDecimals,
  deriveExecutionPolicyActionIdentity,
  deriveExecutionPolicyCandidateIdentity,
  deriveExecutionPolicyDistributionRevision,
  evaluateExecutionPolicy,
} from '../../../dist/liveEdge/adapters/executionPolicy/index.js';

export const T0 = 1_783_920_000_000;

const OWNER_REVISIONS = Object.freeze({
  authorizationRevision: 'authorization-revision:l08:001',
  mandateRevision: 'mandate-revision:l08:001',
  capitalReservationRevision: 'capital-reservation-revision:l08:001',
  riskVerdictRevision: 'risk-verdict-revision:l08:001',
  stagedPlanRevision: 'staged-plan-revision:l08:001',
  operatorApprovalRevision: 'operator-approval-revision:l08:001',
});

function clone(value) {
  return structuredClone(value);
}

export function rehashAction(action) {
  const {
    actionId: _actionId,
    actionRevision: _actionRevision,
    ...material
  } = clone(action);
  return { ...material, ...deriveExecutionPolicyActionIdentity(material) };
}

export function makeAction(overrides = {}) {
  const kind = overrides.kind ?? 'PLACE';
  const dependsOnActualFillLegId = overrides.dependsOnActualFillLegId ?? null;
  const quantitySource = overrides.quantitySource ?? (kind === 'CANCEL'
    ? null
    : kind === 'REPLACE_AFTER_CONFIRMED_CANCEL'
      ? 'CONFIRMED_REMAINDER_AFTER_CANCEL'
      : kind === 'RECOVER'
        ? 'RISK_REDUCING_RECOVERY_EVIDENCE'
        : dependsOnActualFillLegId === null
          ? 'AUTHORIZED_FILTERED_QUANTITY'
          : 'ACTUAL_FILL_OF_LEG');
  const exposureEffect = overrides.exposureEffect ?? (kind === 'CANCEL'
    ? 'NO_EXPOSURE_EFFECT'
    : kind === 'RECOVER'
      ? 'RISK_REDUCING_ONLY'
      : 'MAY_OPEN_WITHIN_AUTHORIZATION');
  return rehashAction({
    schema: 'EXECUTION_POLICY_ACTION_V1',
    step: 0,
    kind,
    legId: 'leg-spot',
    orderType: 'LIMIT',
    timeInForce: 'GTC',
    quantity: '1',
    quantitySource,
    price: '100',
    targetActionId: null,
    dependsOnActualFillLegId,
    requiresConfirmedCancelActionId: null,
    exposureEffect,
    recoveryEvidenceRevision: kind === 'RECOVER' ? 'recovery-revision:l08:001' : null,
    targetExposureRevision: kind === 'RECOVER' ? 'current-position-revision:l08:001' : null,
    deadlineOffsetMs: 2_000,
    ambiguityPosture: 'RECONCILE_ONLY',
    ...clone(overrides),
  });
}

export function makeScenario(overrides = {}) {
  const lossQuote = overrides.lossQuote ?? '1';
  return {
    scenarioId: 'scenario-full',
    probabilityPpm: 900_000,
    fills: [
      { legId: 'leg-spot', filledQuantity: '1' },
      { legId: 'leg-perp', filledQuantity: '1' },
    ],
    feeOrRebateQuote: '0',
    adverseSelectionQuote: lossQuote,
    opportunityDecayQuote: '0',
    cancelRaceQuote: '0',
    unhedgedLossQuote: '0',
    recoveryCostQuote: '0',
    lossQuote,
    fillLatencyMs: 500,
    maxNakedQuantity: '0',
    maxNakedNotionalQuote: '0',
    maxNakedDurationMs: 0,
    ambiguity: 'NONE',
    ...clone(overrides),
  };
}

export function rehashCandidate(candidate) {
  const {
    candidateId: _candidateId,
    candidateRevision: _candidateRevision,
    ...material
  } = clone(candidate);
  const {
    distributionRevision: _distributionRevision,
    ...distributionMaterial
  } = material.distribution;
  material.distribution = {
    ...distributionMaterial,
    distributionRevision: deriveExecutionPolicyDistributionRevision(distributionMaterial),
  };
  return { ...material, ...deriveExecutionPolicyCandidateIdentity(material) };
}

export function makeCandidate(options = {}) {
  const {
    successLossQuote = '1',
    tailLossQuote = '8',
    scenarios,
    distribution: distributionOverrides = {},
    actions,
    failureTransitions,
    ...candidateOverrides
  } = clone(options);
  const posture = candidateOverrides.posture ?? 'PASSIVE';
  const sequenceMode = candidateOverrides.sequenceMode ?? 'ORDERED';
  const timeInForce = posture === 'PASSIVE' ? 'GTC' : 'IOC';
  const candidateActions = actions ?? [
    makeAction({ timeInForce, price: '100' }),
    makeAction({
      step: 1,
      legId: 'leg-perp',
      timeInForce,
      price: '99',
      dependsOnActualFillLegId: sequenceMode === 'ORDERED' ? 'leg-spot' : null,
    }),
  ];
  const candidateScenarios = scenarios ?? [
    makeScenario({ scenarioId: 'scenario-full', lossQuote: successLossQuote }),
    makeScenario({
      scenarioId: 'scenario-tail',
      probabilityPpm: 100_000,
      fills: [
        { legId: 'leg-spot', filledQuantity: '0' },
        { legId: 'leg-perp', filledQuantity: '0' },
      ],
      lossQuote: tailLossQuote,
      adverseSelectionQuote: tailLossQuote,
    }),
  ];
  const transitions = failureTransitions ?? (sequenceMode === 'ORDERED'
    ? {
        onTimeout: 'RECONCILE_ONLY',
        onDisconnect: 'RECONCILE_ONLY',
        onHttp5xx: 'RECONCILE_ONLY',
        onCancelAmbiguity: 'RECONCILE_ONLY',
        onFirstLegReject: 'STOP_NO_NEW_EXPOSURE',
        onFirstLegPartial: 'WAIT_FOR_ACTUAL_FILL',
        onFirstLegTimeout: 'RECONCILE_ONLY',
        onConcurrentImbalance: 'NOT_APPLICABLE',
      }
    : {
        onTimeout: 'RECONCILE_ONLY',
        onDisconnect: 'RECONCILE_ONLY',
        onHttp5xx: 'RECONCILE_ONLY',
        onCancelAmbiguity: 'RECONCILE_ONLY',
        onFirstLegReject: 'NOT_APPLICABLE',
        onFirstLegPartial: 'NOT_APPLICABLE',
        onFirstLegTimeout: 'NOT_APPLICABLE',
        onConcurrentImbalance: 'STOP_NO_NEW_EXPOSURE',
      });
  const distributionMaterial = {
    schema: 'EXECUTION_POLICY_DISTRIBUTION_V1',
    modelRevision: 'exchange-twin-model:l07:001',
    calibrationRevision: 'exchange-twin-calibration:l07:001',
    lineageExchangeTwinRevision: 'exchange-twin-outcome:l07:001',
    state: 'CALIBRATED',
    sampleCount: 100,
    minimumRequiredSampleCount: 2,
    quoteAsset: 'USDT',
    observedAtMs: T0 - 1_000,
    validUntilMs: T0 + 60_000,
    scenarios: candidateScenarios,
    ...distributionOverrides,
  };
  const candidate = {
    schema: 'LIVE_EDGE_EXECUTION_POLICY_CANDIDATE_V1',
    posture,
    sequenceMode,
    ...OWNER_REVISIONS,
    expiresAtMs: T0 + 60_000,
    actions: candidateActions,
    failureTransitions: transitions,
    legFailureTransitions: [
      {
        legId: 'leg-spot',
        onReject: 'STOP_NO_NEW_EXPOSURE',
        onPartial: 'WAIT_FOR_ACTUAL_FILL',
        onTimeout: 'RECONCILE_ONLY',
        onAmbiguity: 'RECONCILE_ONLY',
      },
      {
        legId: 'leg-perp',
        onReject: 'STOP_NO_NEW_EXPOSURE',
        onPartial: 'WAIT_FOR_ACTUAL_FILL',
        onTimeout: 'RECONCILE_ONLY',
        onAmbiguity: 'RECONCILE_ONLY',
      },
    ],
    distribution: distributionMaterial,
    ...candidateOverrides,
  };
  return rehashCandidate(candidate);
}

export function makeExecutionPolicyInput(options = {}) {
  const authorityOptions = clone(options.authority ?? {});
  const convenienceKeys = {
    authorizedMaxQuantity: 'maxQuantity',
    authorizedMaxNotionalQuote: 'maxNotionalQuote',
    authorizedMaxNakedQuantity: 'maxNakedQuantity',
    authorizedMaxNakedNotionalQuote: 'maxNakedNotionalQuote',
    authorizedMaxNakedDurationMs: 'maxNakedDurationMs',
    authorizedMaxRecoveryCostQuote: 'maxRecoveryCostQuote',
    authorizedMaxScenarioLossQuote: 'maxScenarioLossQuote',
    authorizedMaxTailLossQuote: 'maxTailLossQuote',
    cvarConfidencePpm: 'cvarConfidencePpm',
    minimumCompletionPpm: 'minimumCompletionPpm',
  };
  const sharedConstraintOverrides = {};
  for (const [convenience, field] of Object.entries(convenienceKeys)) {
    if (Object.hasOwn(authorityOptions, convenience)) {
      sharedConstraintOverrides[field] = authorityOptions[convenience];
      delete authorityOptions[convenience];
    }
  }
  const nestedConstraintOverrides = {
    mandateConstraints: authorityOptions.mandateConstraints ?? {},
    capitalConstraints: authorityOptions.capitalConstraints ?? {},
    riskConstraints: authorityOptions.riskConstraints ?? {},
    approvalConstraints: authorityOptions.approvalConstraints ?? {},
  };
  for (const key of Object.keys(nestedConstraintOverrides)) delete authorityOptions[key];
  const constraint = (owner, ownerRevision, overrides) => ({
    owner,
    ownerRevision,
    maxQuantity: '1',
    maxNotionalQuote: '100',
    maxNakedQuantity: '1',
    maxNakedNotionalQuote: '100',
    maxNakedDurationMs: 5_000,
    maxRecoveryCostQuote: '10',
    maxScenarioLossQuote: '100',
    maxTailLossQuote: '20',
    cvarConfidencePpm: 950_000,
    minimumCompletionPpm: 800_000,
    ...sharedConstraintOverrides,
    ...clone(overrides),
  });
  const authority = {
    state: 'AUTHORIZED',
    intentId: 'intent:l08:001',
    intentRevision: 'intent-revision:l08:001',
    externalPlanId: 'external-plan:l08:001',
    correlationId: 'correlation:l08:001',
    authorizationRevision: OWNER_REVISIONS.authorizationRevision,
    mandateId: 'mandate:l08:001',
    mandateRevision: OWNER_REVISIONS.mandateRevision,
    capitalReservationId: 'capital-reservation:l08:001',
    capitalReservationRevision: OWNER_REVISIONS.capitalReservationRevision,
    stagedPlanId: 'staged-plan:l08:001',
    stagedPlanRevision: OWNER_REVISIONS.stagedPlanRevision,
    operatorApprovalId: 'operator-approval:l08:001',
    operatorApprovalRevision: OWNER_REVISIONS.operatorApprovalRevision,
    riskVerdictId: 'risk-verdict:l08:001',
    riskVerdictRevision: OWNER_REVISIONS.riskVerdictRevision,
    capitalAuthority: 'CAPITAL_FOUNDATION',
    riskAuthority: 'FOUNDATION',
    riskAllowed: true,
    killOrRevokeActive: false,
    observedAtMs: T0 - 1_000,
    validUntilMs: T0 + 60_000,
    mandateConstraints: constraint('MANDATE', OWNER_REVISIONS.mandateRevision, nestedConstraintOverrides.mandateConstraints),
    capitalConstraints: constraint('CAPITAL_FOUNDATION', OWNER_REVISIONS.capitalReservationRevision, nestedConstraintOverrides.capitalConstraints),
    riskConstraints: constraint('FOUNDATION_RISK', OWNER_REVISIONS.riskVerdictRevision, nestedConstraintOverrides.riskConstraints),
    approvalConstraints: constraint('OPERATOR_APPROVAL', OWNER_REVISIONS.operatorApprovalRevision, nestedConstraintOverrides.approvalConstraints),
    ...authorityOptions,
  };
  const dependencyDefaults = [
    'INSTRUMENT_FILTER',
    'BOOK',
    'COST',
    'MODEL',
    'CALIBRATION',
    'EXCHANGE_TWIN',
    'CURRENT_ORDERS',
    'CURRENT_POSITION',
    'CURRENT_LIABILITY',
    'RECOVERY',
  ].map((kind) => ({
    kind,
    revision: kind === 'MODEL'
      ? 'exchange-twin-model:l07:001'
      : kind === 'CALIBRATION'
        ? 'exchange-twin-calibration:l07:001'
        : kind === 'EXCHANGE_TWIN'
          ? 'exchange-twin-outcome:l07:001'
          : `${kind.toLowerCase().replaceAll('_', '-')}-revision:l08:001`,
    state: 'AVAILABLE',
    observedAtMs: T0 - 1_000,
    validUntilMs: T0 + 60_000,
  }));
  const legs = options.legs ?? [
    {
      legId: 'leg-spot',
      instrumentRevision: 'spot-instrument-revision:l04:001',
      filterRevision: 'spot-filter-revision:l04:001',
      l04SizingRevision: 'spot-sizing-revision:l04:001',
      l04SourceEvidenceRevision: 'spot-source-evidence-revision:l04:001',
      l04SnapshotRevision: 'spot-snapshot-revision:l04:001',
      l04PreflightState: 'PASS',
      allowedOrderTypes: ['LIMIT', 'MARKET'],
      allowedTimeInForce: ['FOK', 'GTC', 'IOC'],
      product: 'USD_M_PERPETUAL',
      accountRealmId: 'realm-spot',
      symbol: 'ETHUSDT',
      baseAsset: 'ETH',
      quoteAsset: 'USDT',
      side: 'BUY',
      reduceOnly: false,
      requestedQuantity: '1',
      filteredQuantity: '1',
      authorizedLimitPrice: '100',
      filteredNotionalQuote: '100',
    },
    {
      legId: 'leg-perp',
      instrumentRevision: 'perp-instrument-revision:l04:001',
      filterRevision: 'perp-filter-revision:l04:001',
      l04SizingRevision: 'perp-sizing-revision:l04:001',
      l04SourceEvidenceRevision: 'perp-source-evidence-revision:l04:001',
      l04SnapshotRevision: 'perp-snapshot-revision:l04:001',
      l04PreflightState: 'PASS',
      allowedOrderTypes: ['LIMIT', 'MARKET'],
      allowedTimeInForce: ['FOK', 'GTC', 'IOC'],
      product: 'USD_M_PERPETUAL',
      accountRealmId: 'realm-perp',
      symbol: 'ETHUSDT',
      baseAsset: 'ETH',
      quoteAsset: 'USDT',
      side: 'SELL',
      reduceOnly: false,
      requestedQuantity: '1',
      filteredQuantity: '1',
      authorizedLimitPrice: '99',
      filteredNotionalQuote: '99',
    },
  ];
  const candidates = options.candidates ?? [makeCandidate({
    authorizationRevision: authority.authorizationRevision,
    mandateRevision: authority.mandateRevision,
    capitalReservationRevision: authority.capitalReservationRevision,
    riskVerdictRevision: authority.riskVerdictRevision,
  })];
  return {
    schema: 'LIVE_EDGE_EXECUTION_POLICY_INPUT_V1',
    policyRequestId: 'policy-request:l08:001',
    policyVersion: 'execution-policy:v1',
    evaluatedAtMs: T0,
    authority,
    dependencies: clone(options.dependencies ?? dependencyDefaults),
    legs: clone(legs),
    candidates: clone(candidates),
  };
}

export function addScenarioCosts(...values) {
  return values.reduce((total, value) => addPolicyDecimals(total, value), '0');
}

export function assertDefaultFixturePlans() {
  const decision = evaluateExecutionPolicy(makeExecutionPolicyInput());
  if (decision.disposition !== 'PLANNED') {
    throw new Error(`default L08 fixture did not plan: ${decision.reasonCodes.join(',')}`);
  }
  return decision;
}
