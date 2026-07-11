import {
  assessCapitalTruth,
} from '../../../dist/capitalFoundation/contracts/index.js';
import {
  createOperatorApprovalState,
  deriveApprovalPolicyDigest,
} from '../../../dist/capitalFoundation/approvals/index.js';
import {
  buildCapitalMandate,
  buildStagedPlan,
  createStagedPlanConfiguration,
} from '../../../dist/capitalFoundation/stages/index.js';
import {
  derivePlanId,
} from '../../../dist/foundation/contracts/index.js';
import {
  deriveRiskIntentDigest,
} from '../../../dist/foundation/risk/index.js';

export const NOW = 1_900_000_000_000;
const UTC_DAY_MS = 86_400_000;
const DAY_START = Math.floor(NOW / UTC_DAY_MS) * UTC_DAY_MS;
const DAY_END = DAY_START + UTC_DAY_MS;
export const SYMBOL = 'BTCUSDT';
export const ACCOUNT = 'synthetic-validation-account';
const INCREASE_GATES = ['OPERATOR_APPROVAL', 'MULTI_LEG_RISK', 'FRESH_ACCOUNT_TRUTH', 'FRESH_MARKET_EVIDENCE'];

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function stamp(sourceId, overrides = {}) {
  return {
    sourceTimeMs: NOW - 10,
    receivedAtMs: NOW - 5,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId,
    ...overrides,
  };
}

function capitalTruth(sourceId) {
  return assessCapitalTruth({
    source: stamp(sourceId),
    evaluatedAtMs: NOW,
    requiredValuePresent: true,
    revision: `${sourceId}-r1`,
  });
}

function stagedStep(stage, sequence, amounts, nextStage) {
  const increasing = stage === 'CONFIRM' || stage === 'ADD';
  return {
    stage,
    sequence,
    maximumAdditionalExposure: amounts[0],
    maximumTotalExposure: amounts[1],
    reservationConsumption: amounts[2],
    prerequisites: increasing
      ? [{ code: `${stage}_EVIDENCE`, required: true, evidenceMaximumAgeMs: 1_000, detail: 'synthetic validation evidence' }]
      : [],
    economicThesisConditions: increasing ? [`${stage}_THESIS`] : [],
    invalidationConditions: increasing ? [`${stage}_INVALID`] : [],
    maximumTimeInStageMs: 60_000,
    requiredApprovalActions: stage === 'CONFIRM' ? ['OPEN'] : stage === 'ADD' ? ['ADD'] : [],
    requiredFutureGates: increasing ? INCREASE_GATES : [],
    liquidityRequirement: increasing ? '1000' : null,
    maximumNakedLegAmount: increasing ? '5' : '0',
    maximumNakedLegDurationMs: increasing ? 5_000 : 0,
    stopAddingConditions: increasing ? [`${stage}_STOP`] : [],
    allowedNextStages: nextStage === null ? [] : [nextStage],
    reductionConditions: stage === 'REDUCE' ? ['REDUCTION_REQUIRED'] : [],
    cancellableBeforeEntry: true,
    nextStageConditions: nextStage === null ? [] : [{ targetStage: nextStage, conditions: [`${stage}_TO_${nextStage}`] }],
    skipConditions: stage === 'OBSERVE'
      ? [{ targetStage: 'CONFIRM', skippedStages: ['PROBE'], conditions: ['PROBE_NOT_REQUIRED'] }]
      : [],
    unenteredCancellationConditions: ['PROPOSAL_EXPIRED'],
  };
}

function buildCapitalBundle() {
  const configuration = createStagedPlanConfiguration({
    sourceId: 'system-integration.synthetic-capital-policy',
    issuedAtMs: NOW - 2_000,
    effectiveFromMs: NOW - 1_000,
    effectiveUntilMs: NOW + 500_000,
    maximumPlanExposure: { value: '100', minimum: '0', maximum: '200', unit: 'USDT' },
    maximumPlanDurationMs: { value: 300_000, minimum: 1, maximum: 500_000, unit: 'MILLISECONDS' },
    maximumStageDurationMs: { value: 60_000, minimum: 1, maximum: 120_000, unit: 'MILLISECONDS' },
    maximumEvidenceAgeMs: { value: 1_000, minimum: 1, maximum: 5_000, unit: 'MILLISECONDS' },
    maximumNakedLegAmount: { value: '5', minimum: '0', maximum: '10', unit: 'USDT' },
    maximumNakedLegDurationMs: { value: 5_000, minimum: 1, maximum: 10_000, unit: 'MILLISECONDS' },
  });
  const reservation = {
    id: 'reservation-system-validate',
    allocationDecisionId: 'allocation-system-validate',
    considerationId: 'consideration-system-validate',
    amount: '100',
    consumedAmount: '0',
    valuationAsset: 'USDT',
    state: 'ACTIVE',
    createdAtMs: NOW - 500,
    expiresAtMs: NOW + 300_000,
    releasedAtMs: null,
    revision: 1,
    idempotencyKey: 'capital-owner-reservation',
  };
  const stages = [
    stagedStep('OBSERVE', 0, ['0', '0', '0'], 'CONFIRM'),
    stagedStep('CONFIRM', 1, ['40', '40', '40'], 'ADD'),
    stagedStep('ADD', 2, ['60', '100', '60'], 'HOLD'),
    stagedStep('HOLD', 3, ['0', '100', '0'], 'REDUCE'),
    stagedStep('REDUCE', 4, ['0', '40', '0'], 'EXIT'),
    stagedStep('EXIT', 5, ['0', '0', '0'], null),
  ];
  const planResult = buildStagedPlan({
    reservation,
    proposalIntakeDigest: 'proposal-intake-system-validate',
    valuationAsset: 'USDT',
    configuration,
    stages,
    activeStage: 'OBSERVE',
    createdAtMs: NOW,
    expiresAtMs: NOW + 200_000,
    correlationId: 'capital-plan-system-validate',
  });
  if (!planResult.ok) throw new Error(`fixture staged plan failed: ${planResult.failure.code}`);
  const stagedPlan = planResult.value;
  const sourceProposal = {
    sourceProposalId: 'basis-proposal-system-validate',
    canonicalProposalId: 'cprop_system_validate',
    sourceCorrelationId: 'basis-correlation-system-validate',
    strategy: 'BASIS',
    symbol: SYMBOL,
    direction: 'long_spot_short_perp',
    sourceLifecycle: 'open',
    sourceRevision: null,
    sourceConfigRevision: 'cfg_basis_system_validate',
    createdAtMs: NOW - 1_000,
    updatedAtMs: NOW - 100,
    expiresAtMs: NOW + 150_000,
    intakeDigest: stagedPlan.proposalIntakeDigest,
  };
  const consideration = {
    id: reservation.considerationId,
    proposal: sourceProposal,
    economics: { valuationAsset: 'USDT' },
    evidenceTruth: 'COMPLETE',
    truth: capitalTruth('capital.synthetic-consideration'),
    evaluatedAtMs: NOW,
    mode: 'MANUAL_ARMED',
    status: 'ELIGIBLE',
  };
  const mandateResult = buildCapitalMandate({
    consideration,
    allocationDecisionId: reservation.allocationDecisionId,
    reservation,
    plan: stagedPlan,
    configuration,
    targetMaximumExposure: '100',
    createdAtMs: NOW,
    expiresAtMs: NOW + 100_000,
    correlationId: 'capital-mandate-system-validate',
  });
  if (!mandateResult.ok) throw new Error(`fixture mandate failed: ${mandateResult.failure.code}`);
  const mandate = mandateResult.value;

  const policySemantics = {
    authority: {
      sourceId: 'system-integration.synthetic-approval-policy',
      issuedAtMs: NOW - 2_000,
      effectiveFromMs: NOW - 1_000,
      effectiveUntilMs: NOW + 50_000,
    },
    configRevision: mandate.configRevision,
    strategy: 'BASIS',
    symbols: [SYMBOL],
    instruments: [`${SYMBOL}:SPOT`, `${SYMBOL}:PERP`],
    allowedActionClasses: ['OPEN'],
    maximumNotional: '100',
    valuationAsset: 'USDT',
    stageLimits: [{ stage: 'OBSERVE', maximumExposure: '100' }],
  };
  const approvalPolicy = {
    ...policySemantics,
    authority: {
      ...policySemantics.authority,
      revision: deriveApprovalPolicyDigest(policySemantics),
    },
  };
  const approval = {
    id: 'approval-system-validate',
    operatorIdentityReference: 'operator:synthetic-validator',
    proposalId: sourceProposal.sourceProposalId,
    proposalRevision: sourceProposal.sourceRevision,
    proposalIntakeDigest: mandate.proposalIntakeDigest,
    mandateId: mandate.id,
    mandateRevision: mandate.revision,
    mandateDigest: mandate.digest,
    stagedPlanId: stagedPlan.id,
    stagedPlanRevision: stagedPlan.revision,
    stagedPlanDigest: stagedPlan.digest,
    strategy: 'BASIS',
    symbols: [SYMBOL],
    instruments: approvalPolicy.instruments,
    allowedActionClasses: ['OPEN'],
    maximumNotional: '100',
    valuationAsset: 'USDT',
    mode: 'VALIDATE_ONLY',
    configRevision: mandate.configRevision,
    issuedAtMs: NOW - 100,
    expiresAtMs: NOW + 10_000,
    revokedAtMs: null,
    revocationReasonReference: null,
    stageLimits: approvalPolicy.stageLimits,
    reasonReference: 'synthetic-validation-scenario',
    useScopeKey: `validate:${stagedPlan.id}:${stagedPlan.digest}`,
  };
  const approvalState = createOperatorApprovalState(approval, approvalPolicy);
  return {
    reservation,
    stagedPlan,
    mandate,
    approval,
    approvalState,
    approvalPolicy,
    controlPosture: {
      posture: 'OPEN',
      truth: capitalTruth('capital.synthetic-control'),
      revision: 'control-synthetic-r1',
      reasonCodes: [],
    },
    approvalObservedAt: stamp('capital.synthetic-approval-store'),
    reservationDialect: {
      owner: 'CAPITAL_SUPERVISION',
      considerationMode: 'MANUAL_ARMED',
      source: 'OWNER_SUPPLIED_PREBUILT',
      syntheticOnly: true,
      executionAuthority: 'NONE',
    },
    sourceProposal,
  };
}

function filter(venue) {
  return {
    venue,
    symbol: SYMBOL,
    minPrice: 1,
    maxPrice: 1_000_000,
    tickSize: 0.1,
    minQty: 0.1,
    maxQty: 100,
    stepSize: 0.1,
    minNotionalUsd: 5,
    maxNotionalUsd: 10_000,
    observedAt: stamp(
      venue === 'BINANCE_SPOT' ? 'binance.spot.filters' : 'binance.usdm.filters',
    ),
  };
}

function riskIntentDigest(canonicalProposal) {
  const planId = derivePlanId({ canonicalProposalId: canonicalProposal.canonicalId, attempt: 0 });
  return deriveRiskIntentDigest({
    planId,
    accountId: ACCOUNT,
    proposalRef: canonicalProposal.canonicalId,
    riskClass: 'RISK_INCREASING',
    legs: [
      {
        legKey: 'SPOT_BUY', venue: 'BINANCE_SPOT', symbol: SYMBOL,
        positionBucket: 'SPOT_CASH', side: 'BUY', intendedPrice: 100, intendedQty: 1,
        requiredPermission: 'SPOT', estimatedRequiredMarginUsd: 0,
      },
      {
        legKey: 'PERP_SELL', venue: 'BINANCE_USDM', symbol: SYMBOL,
        positionBucket: 'USDM_ONE_WAY', side: 'SELL', intendedPrice: 100, intendedQty: 1,
        requiredPermission: 'FUTURES', estimatedRequiredMarginUsd: 100,
      },
    ],
    declaredMaxNakedDurationMs: 1_000,
    estimatedRequiredMarginUsd: 100,
    requiredBorrowUsd: 0,
  });
}

function buildRiskEvidence(canonicalProposal) {
  const intentDigest = riskIntentDigest(canonicalProposal);
  return {
    killSwitch: {
      accountId: ACCOUNT,
      engaged: false,
      observedAt: stamp('control.synthetic-kill-switch'),
      reason: null,
    },
    market: {
      legs: [
        {
          legKey: 'SPOT_BUY', venue: 'BINANCE_SPOT', symbol: SYMBOL, referencePrice: 100,
          observedAt: stamp('binance.spot.book'), spreadPct: 0.05, topDepthUsd: 10_000,
          filters: filter('BINANCE_SPOT'),
        },
        {
          legKey: 'PERP_SELL', venue: 'BINANCE_USDM', symbol: SYMBOL, referencePrice: 100,
          observedAt: stamp('binance.usdm.book'), spreadPct: 0.05, topDepthUsd: 10_000,
          filters: filter('BINANCE_USDM'),
        },
      ],
      edgeIntentDigest: intentDigest,
      netEdgePct: 0.5,
      estimatedCostPct: 0.1,
      estimatedSlippagePct: 0.05,
      edgeObservedAt: stamp('strategy.synthetic-edge'),
    },
    account: {
      accountId: ACCOUNT,
      permissions: {
        accountId: ACCOUNT, spot: true, margin: true, futures: true,
        observedAt: stamp('account.synthetic-permissions'),
      },
      spotInventory: [{
        accountId: ACCOUNT, symbol: SYMBOL, availableBaseQty: 10, availableQuoteUsd: 10_000,
        observedAt: stamp('account.synthetic-inventory'),
      }],
      exposures: {
        accountId: ACCOUNT,
        positionMode: 'ONE_WAY',
        positions: [],
        observedAt: stamp('account.synthetic-exposures'),
      },
      marginHeadrooms: [{
        accountId: ACCOUNT, positionBucket: 'USDM_ONE_WAY', scopeSymbol: null, availableMarginUsd: 1_000,
        observedAt: stamp('account.synthetic-margin'),
      }],
      liquidations: [{
        legKey: 'PERP_SELL', accountId: ACCOUNT, venue: 'BINANCE_USDM', symbol: SYMBOL,
        intentDigest, projectedSignedBaseQty: -1, markPrice: 100, liquidationPrice: 150,
        observedAt: stamp('risk.synthetic-liquidation'),
      }],
      dailyRealizedLossUsd: 0,
      dailyTradedNotionalUsd: 0,
      dailyPeriodStartMs: DAY_START,
      dailyPeriodEndMs: DAY_END,
      dailyStatsObservedAt: stamp('ledger.synthetic-daily'),
      openOrders: { total: 0, perSymbol: {}, observedAt: stamp('account.synthetic-open-orders') },
    },
    borrow: null,
    existingPlans: { accountId: ACCOUNT, plans: [], observedAt: stamp('coordinator.synthetic-registry') },
    cooldown: { accountId: ACCOUNT, symbols: [SYMBOL], lastEntryAtMs: null, observedAt: stamp('coordinator.synthetic-cooldown') },
    policy: {
      verdictTtlMs: 5_000,
      minEvidenceAuthority: 'SYNTHETIC_TEST',
      maxSpotPerpSkewMs: 50,
      minLegNotionalUsd: 10,
      maxLegNotionalUsd: 200,
      maxGrossNotionalUsd: 400,
      maxHedgeRatioDeviationPct: 1,
      maxResidualDeltaUsd: 1,
      maxNakedDurationMs: 5_000,
      minNetEdgePct: 0.2,
      maxSpreadPct: 0.1,
      minTopDepthUsd: 1_000,
      maxSlippagePct: 0.1,
      marginHeadroomBufferPct: 10,
      minLiquidationDistancePct: 20,
      maxLiquidationReferenceDriftPct: 1,
      maxBorrowHourlyRatePct: 0.5,
      maxDailyLossUsd: 1_000,
      maxDailyNotionalUsd: 10_000,
      maxOpenOrdersPerSymbol: 5,
      maxTotalOpenOrders: 10,
      cooldownMs: 1_000,
    },
  };
}

function reconciliationEvidence() {
  const historyMetadata = {
    sourceId: 'reconciliation.synthetic-fixture',
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceTimeMs: NOW,
    receivedAtMs: NOW,
    maxAgeMs: 5_000,
    coverageStartMs: NOW,
    coverageEndMs: NOW,
  };
  return {
    orders: { metadata: { ...historyMetadata }, records: [] },
    fills: { metadata: { ...historyMetadata }, records: [] },
    positions: {
      metadata: { ...historyMetadata, coverageStartMs: null, coverageEndMs: null },
      records: [
        { venue: 'BINANCE_SPOT', symbol: SYMBOL, positionSide: 'NET', quantity: 0, baselineQuantity: 0, observedAtMs: NOW },
        { venue: 'BINANCE_USDM', symbol: SYMBOL, positionSide: 'BOTH', quantity: 0, baselineQuantity: 0, observedAtMs: NOW },
      ],
    },
  };
}

export function buildValidateOnlyInput() {
  const capital = buildCapitalBundle();
  const canonicalProposal = {
    kind: 'PROPOSAL',
    canonicalId: capital.sourceProposal.canonicalProposalId,
    source: 'BASIS',
    sourceId: capital.sourceProposal.sourceProposalId,
    symbol: SYMBOL,
    direction: capital.sourceProposal.direction,
    lifecycle: 'OPEN',
    sourceLifecycle: 'open',
    observedAt: stamp('foundation.synthetic-basis-proposal'),
    expiresAtMs: capital.sourceProposal.expiresAtMs,
    sourceLocalRank: 0,
    netEdgePct: 0.5,
    confidence: 0.9,
    borrowState: 'not_needed',
    evidence: { synthetic: true },
    rejectionReasons: [],
    configVersion: capital.sourceProposal.sourceConfigRevision,
  };
  return {
    requestedMode: 'VALIDATE_ONLY',
    nowMs: NOW,
    correlationId: capital.sourceProposal.sourceCorrelationId,
    canonicalProposal,
    capital: {
      sourceProposal: capital.sourceProposal,
      reservation: capital.reservation,
      stagedPlan: capital.stagedPlan,
      mandate: capital.mandate,
      approval: capital.approval,
      approvalState: capital.approvalState,
      approvalPolicy: capital.approvalPolicy,
      controlPosture: capital.controlPosture,
      approvalObservedAt: capital.approvalObservedAt,
      reservationDialect: capital.reservationDialect,
    },
    approvalUse: {
      actionClass: 'OPEN',
      stage: 'OBSERVE',
      instrumentIds: [...capital.approval.instruments],
      idempotencyKey: 'approval-use-system-validate',
    },
    executionTerms: {
      accountId: ACCOUNT,
      attempt: 0,
      maxNakedDurationMs: 1_000,
      spot: { intendedPrice: 100, quantity: 1, quoteNotional: '100', estimatedRequiredMarginUsd: 0 },
      perpetual: { intendedPrice: 100, quantity: 1, quoteNotional: '100', estimatedRequiredMarginUsd: 100 },
      estimatedRequiredMarginUsd: 100,
      requiredBorrowUsd: 0,
    },
    riskEvidence: buildRiskEvidence(canonicalProposal),
    supervision: null,
    reconciliationEvidence: reconciliationEvidence(),
    reconciliationPolicy: { quantityTolerance: 1e-9, normalizedHedgeTolerance: 1e-9 },
  };
}

export function replaceCapitalApproval(input, patch) {
  const approval = { ...input.capital.approval, ...patch };
  input.capital.approval = approval;
  input.capital.approvalState = createOperatorApprovalState(
    approval,
    input.capital.approvalPolicy,
  );
  return input;
}

export function replaceApprovalConfigRevision(input, configRevision) {
  const authoritySemantics = {
    sourceId: input.capital.approvalPolicy.authority.sourceId,
    issuedAtMs: input.capital.approvalPolicy.authority.issuedAtMs,
    effectiveFromMs: input.capital.approvalPolicy.authority.effectiveFromMs,
    effectiveUntilMs: input.capital.approvalPolicy.authority.effectiveUntilMs,
  };
  const policySemantics = {
    ...input.capital.approvalPolicy,
    authority: authoritySemantics,
    configRevision,
  };
  const approvalPolicy = {
    ...policySemantics,
    authority: {
      ...authoritySemantics,
      revision: deriveApprovalPolicyDigest(policySemantics),
    },
  };
  const approval = { ...input.capital.approval, configRevision };
  input.capital.approvalPolicy = approvalPolicy;
  input.capital.approval = approval;
  input.capital.approvalState = createOperatorApprovalState(approval, approvalPolicy);
  return input;
}

export function refreshSyntheticRiskIntentBindings(input) {
  const planId = derivePlanId({
    canonicalProposalId: input.canonicalProposal.canonicalId,
    attempt: input.executionTerms.attempt,
  });
  const digest = deriveRiskIntentDigest({
    planId,
    accountId: input.executionTerms.accountId,
    proposalRef: input.canonicalProposal.canonicalId,
    riskClass: 'RISK_INCREASING',
    legs: [
      {
        legKey: 'SPOT_BUY', venue: 'BINANCE_SPOT', symbol: input.canonicalProposal.symbol,
        positionBucket: 'SPOT_CASH', side: 'BUY',
        intendedPrice: input.executionTerms.spot.intendedPrice,
        intendedQty: input.executionTerms.spot.quantity,
        requiredPermission: 'SPOT',
        estimatedRequiredMarginUsd: input.executionTerms.spot.estimatedRequiredMarginUsd,
      },
      {
        legKey: 'PERP_SELL', venue: 'BINANCE_USDM', symbol: input.canonicalProposal.symbol,
        positionBucket: 'USDM_ONE_WAY', side: 'SELL',
        intendedPrice: input.executionTerms.perpetual.intendedPrice,
        intendedQty: input.executionTerms.perpetual.quantity,
        requiredPermission: 'FUTURES',
        estimatedRequiredMarginUsd: input.executionTerms.perpetual.estimatedRequiredMarginUsd,
      },
    ],
    declaredMaxNakedDurationMs: input.executionTerms.maxNakedDurationMs,
    estimatedRequiredMarginUsd: input.executionTerms.estimatedRequiredMarginUsd,
    requiredBorrowUsd: input.executionTerms.requiredBorrowUsd,
  });
  input.riskEvidence.market.edgeIntentDigest = digest;
  for (const projection of input.riskEvidence.account.liquidations) projection.intentDigest = digest;
  return digest;
}

export class InMemoryValidateOnlyPersistence {
  constructor() {
    this.records = new Map();
    this.calls = [];
    this.approvalStates = new Map();
  }

  async loadValidateOnlyApprovalState(approvalId) {
    return this.approvalStates.get(approvalId) ?? null;
  }

  async persistValidateOnly(record) {
    this.calls.push(record.recordId);
    const prior = this.records.get(record.recordId);
    const bytes = JSON.stringify(record);
    if (prior !== undefined && JSON.stringify(prior) !== bytes) throw new Error('idempotency conflict');
    if (record.approvalState !== null && record.ownerInvocations.approvalUseReductions > 0) {
      const incoming = record.approvalState;
      const latest = this.approvalStates.get(record.approvalId);
      if (latest !== undefined) {
        if (incoming.revision < latest.revision) throw new Error('stale approval state');
        if (incoming.revision === latest.revision && JSON.stringify(incoming) !== JSON.stringify(latest)) {
          throw new Error('approval state compare-and-set conflict');
        }
      }
      this.approvalStates.set(record.approvalId, incoming);
    }
    if (prior === undefined) this.records.set(record.recordId, record);
    return { persistenceId: `memory:${record.recordId}` };
  }
}
